import { systemClock } from '../../core/domain/services/Clock';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import {
    type DeviceCameraService,
    type CaptureResult,
    webDeviceCameraService,
} from '../../infrastructure/device/DeviceCameraService';
import {
    type DeviceFilesService,
    type FilePickResult,
    webDeviceFilesService,
} from '../../infrastructure/device/DeviceFilesService';
import { getDatabase, type AttachmentRecord, type UploadQueueItem } from '../../infrastructure/storage/DexieDatabase';
import { enqueueCreateAttachmentMutation } from '../../infrastructure/sync/AttachmentMutationQueue';
import { emitProofAttached } from '../../core/telemetry/eventEmitters';

export type AttachmentCaptureSource = 'camera' | 'gallery' | 'file';

export interface CaptureAttachmentInput {
    source: AttachmentCaptureSource;
    farmId: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    attachmentId?: string;
    file?: Blob;
    fileName?: string;
    mimeType?: string;
}

export interface CaptureAttachmentDependencies {
    cameraService?: DeviceCameraService;
    filesService?: DeviceFilesService;
}

interface CapturedFilePayload {
    blob: Blob;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
}

function extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'application/pdf':
            return '.pdf';
        default:
            return '';
    }
}

function resolveFileName(source: AttachmentCaptureSource, mimeType: string, suggestedFileName?: string): string {
    if (suggestedFileName && suggestedFileName.trim().length > 0) {
        return suggestedFileName.trim();
    }

    const suffix = extensionFromMimeType(mimeType) || '.bin';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${source}-attachment-${timestamp}${suffix}`;
}

function resolveMimeType(blob: Blob, fallback?: string): string {
    if (fallback && fallback.trim().length > 0) {
        return fallback.trim();
    }

    if (blob.type && blob.type.trim().length > 0) {
        return blob.type;
    }

    return 'application/octet-stream';
}

function fromCameraCapture(source: AttachmentCaptureSource, result: CaptureResult): CapturedFilePayload {
    const mimeType = resolveMimeType(result.file, result.mimeType);
    return {
        blob: result.file,
        fileName: resolveFileName(source, mimeType, result.fileName),
        mimeType,
        sizeBytes: result.sizeBytes,
    };
}

function fromFilePick(result: FilePickResult): CapturedFilePayload {
    const mimeType = resolveMimeType(result.file, result.mimeType);
    return {
        blob: result.file,
        fileName: resolveFileName('file', mimeType, result.fileName),
        mimeType,
        sizeBytes: result.sizeBytes,
    };
}

function fromProvidedFile(source: AttachmentCaptureSource, input: CaptureAttachmentInput): CapturedFilePayload {
    const blob = input.file as Blob;
    const mimeType = resolveMimeType(blob, input.mimeType);
    const directName = blob instanceof File ? blob.name : undefined;

    return {
        blob,
        fileName: resolveFileName(source, mimeType, input.fileName ?? directName),
        mimeType,
        sizeBytes: blob.size,
    };
}

async function captureBySource(
    input: CaptureAttachmentInput,
    cameraService: DeviceCameraService,
    filesService: DeviceFilesService,
): Promise<CapturedFilePayload> {
    if (input.source === 'camera') {
        const result = await cameraService.capturePhoto();
        return fromCameraCapture(input.source, result);
    }

    if (input.source === 'gallery') {
        const result = await cameraService.pickFromGallery();
        return fromCameraCapture(input.source, result);
    }

    if (input.file) {
        return fromProvidedFile(input.source, input);
    }

    const picked = await filesService.pickFile(['image/*', 'application/pdf']);
    return fromFilePick(picked);
}

export async function captureAttachment(
    input: CaptureAttachmentInput,
    dependencies: CaptureAttachmentDependencies = {},
): Promise<AttachmentRecord> {
    const farmId = input.farmId?.trim();
    if (!farmId) {
        throw new Error('captureAttachment requires a farmId.');
    }

    const cameraService = dependencies.cameraService ?? webDeviceCameraService;
    const filesService = dependencies.filesService ?? webDeviceFilesService;

    const captured = await captureBySource(input, cameraService, filesService);
    const localPath = await filesService.saveFile({
        fileName: captured.fileName,
        data: captured.blob,
        mimeType: captured.mimeType,
        directory: 'cache',
    });

    const nowIso = systemClock.nowISO();
    const attachmentId = input.attachmentId?.trim() || idGenerator.generate();
    const linkedEntityId = input.linkedEntityId?.trim() || farmId;
    const linkedEntityType = input.linkedEntityType?.trim() || 'Farm';

    const attachmentRecord: AttachmentRecord = {
        id: attachmentId,
        farmId,
        linkedEntityId,
        linkedEntityType,
        localPath,
        originalFileName: captured.fileName,
        mimeType: captured.mimeType,
        sizeBytes: captured.sizeBytes,
        status: 'pending',
        createdAt: nowIso,
        updatedAt: nowIso,
        retryCount: 0,
    };

    const queueItem: UploadQueueItem = {
        attachmentId,
        status: 'pending',
        retryCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    const db = getDatabase();
    await db.transaction('rw', [db.attachments, db.uploadQueue], async () => {
        await db.attachments.put(attachmentRecord);
        await db.uploadQueue.add(queueItem);
    });

    try {
        await enqueueCreateAttachmentMutation(attachmentRecord);
    } catch (error) {
        console.warn('[CaptureAttachment] Failed to queue create_attachment mutation; upload worker will retry.', error);
    }

    // DWC v2 §2.8 — emit proof.attached. Plan §2.8 places this inside
    // features/attachments/<attach handler>; the actual attach handler
    // lives here (application/use-cases) because there is no thin
    // hook wrapper in features/attachments. The emit is deferred to the
    // end of the use case so it only fires after the local Dexie write
    // succeeded. The Zod schema requires logId to be a UUID; if the
    // attachment is linked to a non-UUID entity (rare seed/preview path)
    // safeParse will silently drop the event at the emitter.
    const photoLikeMime = captured.mimeType.startsWith('image/');
    const audioLikeMime = captured.mimeType.startsWith('audio/');
    const proofType = audioLikeMime ? 'voice' : photoLikeMime ? 'photo' : 'gps';
    emitProofAttached({
        farmId,
        logId: linkedEntityId,
        type: proofType,
        sizeBytes: captured.sizeBytes,
    });

    return attachmentRecord;
}
