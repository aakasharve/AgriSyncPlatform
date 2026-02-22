import { getAuthSession } from '../api/AuthTokenStore';
import { agriSyncClient } from '../api/AgriSyncClient';
import { createDeviceServices, type DeviceServices } from '../device';
import { getDatabase, type AttachmentRecord, type UploadQueueItem } from '../storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';

const MAX_RETRY_COUNT = 5;
const BASE_BACKOFF_MS = 10000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function computeBackoffMs(retryCount: number): number {
    if (retryCount <= 0) {
        return 0;
    }

    return Math.min(BASE_BACKOFF_MS * (2 ** (retryCount - 1)), MAX_BACKOFF_MS);
}

function shouldAttemptUpload(item: UploadQueueItem, nowMs: number): boolean {
    if (item.status === 'pending') {
        return true;
    }

    if (item.status !== 'failed') {
        return false;
    }

    if (item.retryCount >= MAX_RETRY_COUNT) {
        return false;
    }

    if (!item.lastAttemptAt) {
        return true;
    }

    const lastAttemptMs = Date.parse(item.lastAttemptAt);
    if (Number.isNaN(lastAttemptMs)) {
        return true;
    }

    return nowMs - lastAttemptMs >= computeBackoffMs(item.retryCount);
}

export class AttachmentUploadWorker {
    private static instance: AttachmentUploadWorker;
    private readonly intervalMs = 15000;
    private timerId: number | null = null;
    private isRunning = false;
    private cycleInProgress = false;
    private readonly deviceServices: DeviceServices;

    private constructor(deviceServices: DeviceServices) {
        this.deviceServices = deviceServices;
    }

    static getInstance(): AttachmentUploadWorker {
        if (!AttachmentUploadWorker.instance) {
            AttachmentUploadWorker.instance = new AttachmentUploadWorker(createDeviceServices());
        }

        return AttachmentUploadWorker.instance;
    }

    start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.safeRunCycle();

        this.timerId = window.setInterval(() => {
            this.safeRunCycle();
        }, this.intervalMs);

        window.addEventListener('online', this.handleOnline);
    }

    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.timerId !== null) {
            window.clearInterval(this.timerId);
            this.timerId = null;
        }

        window.removeEventListener('online', this.handleOnline);
    }

    async triggerNow(): Promise<void> {
        await this.safeRunCycle();
    }

    private handleOnline = () => {
        this.safeRunCycle();
    };

    private async safeRunCycle(): Promise<void> {
        if (!this.isRunning || this.cycleInProgress) {
            return;
        }

        if (!getAuthSession()) {
            return;
        }

        if (!navigator.onLine) {
            return;
        }

        this.cycleInProgress = true;
        try {
            await this.processPendingUploads();
        } catch (error) {
            console.error('[AttachmentUploadWorker] Upload cycle failed', error);
        } finally {
            this.cycleInProgress = false;
        }
    }

    private async processPendingUploads(): Promise<void> {
        const db = getDatabase();
        const candidates = await db.uploadQueue
            .where('status')
            .anyOf(['pending', 'failed'])
            .limit(20)
            .toArray();

        if (candidates.length === 0) {
            return;
        }

        const nowMs = Date.now();
        for (const item of candidates) {
            if (!item.autoId) {
                continue;
            }

            if (!shouldAttemptUpload(item, nowMs)) {
                continue;
            }

            await this.processSingleUpload(item);
        }
    }

    private async processSingleUpload(item: UploadQueueItem): Promise<void> {
        const db = getDatabase();
        const nowIso = systemClock.nowISO();

        await db.uploadQueue.update(item.autoId as number, {
            status: 'uploading',
            updatedAt: nowIso,
        });

        const attachment = await db.attachments.get(item.attachmentId);
        if (!attachment) {
            await this.failQueueItem(item, 'Attachment record not found.');
            return;
        }

        try {
            const uploadBlob = await this.readAttachmentBlob(attachment);
            const serverAttachmentId = await this.ensureServerAttachment(attachment);

            await agriSyncClient.uploadAttachmentFile(
                serverAttachmentId,
                uploadBlob,
                attachment.fileName);

            const metadata = await agriSyncClient.getAttachmentMetadata(serverAttachmentId);
            const finalizedAtUtc = metadata.finalizedAtUtc ?? systemClock.nowISO();
            await db.attachments.update(attachment.id, {
                status: 'finalized',
                serverAttachmentId,
                storagePath: metadata.storagePath,
                uploadedByUserId: metadata.uploadedByUserId,
                finalizedAtUtc,
                updatedAt: systemClock.nowISO(),
                lastError: undefined,
            });

            await db.uploadQueue.update(item.autoId as number, {
                status: 'completed',
                updatedAt: systemClock.nowISO(),
                lastAttemptAt: nowIso,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Attachment upload failed.';
            await this.failQueueItem(item, message);
            await db.attachments.update(attachment.id, {
                status: 'failed',
                updatedAt: systemClock.nowISO(),
                lastError: message,
            });
        }
    }

    private async readAttachmentBlob(attachment: AttachmentRecord): Promise<Blob> {
        const data = await this.deviceServices.files.readFile(attachment.localPath);
        return new Blob([data], { type: attachment.mimeType || 'application/octet-stream' });
    }

    private async ensureServerAttachment(attachment: AttachmentRecord): Promise<string> {
        if (attachment.serverAttachmentId) {
            return attachment.serverAttachmentId;
        }

        const created = await agriSyncClient.createAttachment({
            farmId: attachment.farmId,
            originalFileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            linkedEntityId: attachment.linkedEntityId,
            linkedEntityType: attachment.linkedEntityType,
        });

        const serverAttachmentId = created.attachment.id;
        const db = getDatabase();
        await db.attachments.update(attachment.id, {
            serverAttachmentId,
            status: 'uploading',
            storagePath: created.attachment.storagePath,
            updatedAt: systemClock.nowISO(),
            lastError: undefined,
        });

        return serverAttachmentId;
    }

    private async failQueueItem(item: UploadQueueItem, errorMessage: string): Promise<void> {
        const db = getDatabase();
        await db.uploadQueue.update(item.autoId as number, {
            status: 'failed',
            retryCount: item.retryCount + 1,
            lastAttemptAt: systemClock.nowISO(),
            updatedAt: systemClock.nowISO(),
        });

        console.error('[AttachmentUploadWorker] Upload failed', {
            attachmentId: item.attachmentId,
            errorMessage,
        });
    }
}

export const attachmentUploadWorker = AttachmentUploadWorker.getInstance();
