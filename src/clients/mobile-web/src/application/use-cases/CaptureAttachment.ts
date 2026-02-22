import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { createDeviceServices } from '../../infrastructure/device';
import { attachmentUploadWorker } from '../../infrastructure/sync/AttachmentUploadWorker';
import { getDatabase, type AttachmentRecord } from '../../infrastructure/storage/DexieDatabase';

export type AttachmentCaptureSource = 'camera' | 'gallery' | 'file';

export interface CaptureAttachmentInput {
    source: AttachmentCaptureSource;
    farmId: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
    accept?: string[];
}

export interface CaptureAttachmentResult {
    attachment: AttachmentRecord;
}

interface LocalCapture {
    localPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
}

const deviceServices = createDeviceServices();

function extensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'application/pdf') return 'pdf';

    const [, subtype] = normalized.split('/');
    return subtype && subtype.length > 0 ? subtype : 'bin';
}

async function capture(source: AttachmentCaptureSource, accept?: string[]): Promise<LocalCapture> {
    if (source === 'camera') {
        const photo = await deviceServices.camera.capturePhoto();
        return {
            localPath: photo.localPath,
            fileName: `capture_${Date.now()}.${extensionFromMimeType(photo.mimeType)}`,
            mimeType: photo.mimeType,
            sizeBytes: photo.sizeBytes,
        };
    }

    if (source === 'gallery') {
        const photo = await deviceServices.camera.pickFromGallery();
        return {
            localPath: photo.localPath,
            fileName: `gallery_${Date.now()}.${extensionFromMimeType(photo.mimeType)}`,
            mimeType: photo.mimeType,
            sizeBytes: photo.sizeBytes,
        };
    }

    const file = await deviceServices.files.pickFile(accept);
    return {
        localPath: file.localPath,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
    };
}

async function persistLocalPath(captureResult: LocalCapture): Promise<string> {
    if (!captureResult.localPath.startsWith('blob:') && !captureResult.localPath.startsWith('http')) {
        return captureResult.localPath;
    }

    try {
        const data = await deviceServices.files.readFile(captureResult.localPath);
        return await deviceServices.files.saveFile({
            fileName: `${idGenerator.generate()}_${captureResult.fileName}`,
            data,
            mimeType: captureResult.mimeType,
            directory: 'cache',
        });
    } catch {
        return captureResult.localPath;
    }
}

export async function captureAttachment(input: CaptureAttachmentInput): Promise<CaptureAttachmentResult> {
    const captured = await capture(input.source, input.accept);
    const localPath = await persistLocalPath(captured);
    const now = systemClock.nowISO();
    const attachmentId = idGenerator.generate();

    const attachment: AttachmentRecord = {
        id: attachmentId,
        farmId: input.farmId,
        linkedEntityId: input.linkedEntityId,
        linkedEntityType: input.linkedEntityType,
        localPath,
        status: 'pending',
        fileName: captured.fileName,
        mimeType: captured.mimeType,
        sizeBytes: captured.sizeBytes,
        createdAtUtc: now,
        updatedAt: now,
    };

    const db = getDatabase();
    await db.transaction('rw', [db.attachments, db.uploadQueue], async () => {
        await db.attachments.put(attachment);
        await db.uploadQueue.add({
            attachmentId,
            status: 'pending',
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        });
    });

    void attachmentUploadWorker.triggerNow();
    return { attachment };
}
