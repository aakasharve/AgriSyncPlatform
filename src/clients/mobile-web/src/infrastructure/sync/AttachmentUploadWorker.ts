import { systemClock } from '../../core/domain/services/Clock';
import { getAuthSession } from '../storage/AuthTokenStore';
import { agriSyncClient, type AttachmentDto } from '../api/AgriSyncClient';
import { type DeviceFilesService, webDeviceFilesService } from '../device/DeviceFilesService';
import { getDatabase, type AttachmentRecord, type UploadQueueItem } from '../storage/DexieDatabase';
import { enqueueCreateAttachmentMutation } from './AttachmentMutationQueue';
import { backgroundSyncWorker } from './BackgroundSyncWorker';

const MAX_RETRY_COUNT = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const WORKER_INTERVAL_MS = 10000;
const QUEUE_BATCH_LIMIT = 5;

type UploadQueueItemWithId = UploadQueueItem & { autoId: number };

function normalizeEntityType(value?: string): string {
    if (!value || value.trim().length === 0) {
        return 'Farm';
    }

    return value.trim();
}

function normalizeAttachmentStatus(status?: string): AttachmentRecord['status'] {
    if (!status) {
        return 'uploaded';
    }

    switch (status.trim().toLowerCase()) {
        case 'finalized':
        case 'uploaded':
            return 'uploaded';
        case 'uploading':
            return 'uploading';
        case 'failed':
            return 'failed';
        default:
            return 'pending';
    }
}

export class AttachmentUploadWorker {
    private static instance: AttachmentUploadWorker;
    private readonly intervalMs: number;
    private timerId: number | null = null;
    private isRunning = false;
    private cycleInProgress = false;
    private readonly filesService: DeviceFilesService;

    private constructor(
        filesService: DeviceFilesService = webDeviceFilesService,
        intervalMs: number = WORKER_INTERVAL_MS,
    ) {
        this.filesService = filesService;
        this.intervalMs = intervalMs;
    }

    static getInstance(): AttachmentUploadWorker {
        if (!AttachmentUploadWorker.instance) {
            AttachmentUploadWorker.instance = new AttachmentUploadWorker();
        }

        return AttachmentUploadWorker.instance;
    }

    start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        void this.safeRunCycle();

        this.timerId = window.setInterval(() => {
            void this.safeRunCycle();
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
        await this.safeRunCycle(true);
    }

    private handleOnline = () => {
        void this.safeRunCycle();
    };

    private async safeRunCycle(forceRun: boolean = false): Promise<void> {
        if ((!this.isRunning && !forceRun) || this.cycleInProgress) {
            return;
        }

        if (!getAuthSession() || !navigator.onLine) {
            return;
        }

        this.cycleInProgress = true;
        try {
            const queueItems = await this.getDueQueueItems();
            for (const item of queueItems) {
                await this.processQueueItem(item);
            }
        } catch (error) {
            console.error('[AttachmentUploadWorker] Upload cycle failed', error);
        } finally {
            this.cycleInProgress = false;
        }
    }

    private async getDueQueueItems(): Promise<UploadQueueItemWithId[]> {
        const db = getDatabase();
        const nowMs = systemClock.nowEpoch();
        const pending = await db.uploadQueue
            .where('status')
            .anyOf('pending', 'retry_wait')
            .toArray();

        return pending
            .filter(item => item.autoId !== undefined)
            .filter(item => this.isDue(item, nowMs))
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
            .slice(0, QUEUE_BATCH_LIMIT)
            .map(item => item as UploadQueueItemWithId);
    }

    private isDue(item: UploadQueueItem, nowMs: number): boolean {
        if (!item.nextAttemptAt) {
            return true;
        }

        const nextAttemptMs = Date.parse(item.nextAttemptAt);
        if (Number.isNaN(nextAttemptMs)) {
            return true;
        }

        return nextAttemptMs <= nowMs;
    }

    private async processQueueItem(queueItem: UploadQueueItemWithId): Promise<void> {
        const db = getDatabase();
        const nowIso = systemClock.nowISO();
        const attachment = await db.attachments.get(queueItem.attachmentId);

        if (!attachment) {
            await db.uploadQueue.update(queueItem.autoId, {
                status: 'failed',
                retryCount: MAX_RETRY_COUNT,
                lastAttemptAt: nowIso,
                nextAttemptAt: undefined,
                lastError: 'Attachment record not found.',
                updatedAt: nowIso,
            });
            return;
        }

        await db.transaction('rw', [db.uploadQueue, db.attachments], async () => {
            await db.uploadQueue.update(queueItem.autoId, {
                status: 'uploading',
                lastAttemptAt: nowIso,
                updatedAt: nowIso,
                lastError: undefined,
            });

            await db.attachments.update(attachment.id, {
                status: 'uploading',
                updatedAt: nowIso,
                lastError: undefined,
            });
        });

        try {
            const fileBlob = await this.filesService.readFile(attachment.localPath);
            let remoteAttachmentId = attachment.remoteAttachmentId;

            if (!remoteAttachmentId) {
                await enqueueCreateAttachmentMutation({
                    ...attachment,
                    linkedEntityType: normalizeEntityType(attachment.linkedEntityType),
                });
                remoteAttachmentId = attachment.id;
                await db.attachments.update(attachment.id, {
                    remoteAttachmentId,
                    updatedAt: systemClock.nowISO(),
                });
            }

            await backgroundSyncWorker.triggerNow();

            await agriSyncClient.uploadAttachmentFile(
                remoteAttachmentId,
                fileBlob,
                attachment.originalFileName,
                attachment.mimeType,
            );

            let metadata: AttachmentDto | null = null;
            try {
                metadata = await agriSyncClient.getAttachmentMetadata(remoteAttachmentId);
            } catch {
                metadata = null;
            }

            const completedAtIso = systemClock.nowISO();
            await db.transaction('rw', [db.uploadQueue, db.attachments], async () => {
                await db.attachments.put({
                    ...attachment,
                    remoteAttachmentId,
                    originalFileName: metadata?.fileName ?? attachment.originalFileName,
                    mimeType: metadata?.mimeType ?? attachment.mimeType,
                    sizeBytes: metadata?.sizeBytes ?? attachment.sizeBytes ?? fileBlob.size,
                    status: metadata ? normalizeAttachmentStatus(metadata.status) : 'uploaded',
                    uploadedAtUtc: metadata?.uploadedAtUtc ?? metadata?.finalizedAtUtc ?? completedAtIso,
                    finalizedAtUtc: metadata?.finalizedAtUtc ?? attachment.finalizedAtUtc,
                    retryCount: queueItem.retryCount,
                    lastError: undefined,
                    updatedAt: completedAtIso,
                });

                await db.uploadQueue.update(queueItem.autoId, {
                    status: 'completed',
                    updatedAt: completedAtIso,
                    nextAttemptAt: undefined,
                    lastError: undefined,
                });
            });
        } catch (error) {
            await this.scheduleRetry(queueItem, attachment, error);
        }
    }

    private async scheduleRetry(
        queueItem: UploadQueueItemWithId,
        attachment: AttachmentRecord,
        error: unknown,
    ): Promise<void> {
        const db = getDatabase();
        const errorMessage = error instanceof Error ? error.message : 'Attachment upload failed.';
        const nowIso = systemClock.nowISO();
        const nextRetryCount = queueItem.retryCount + 1;
        const shouldMarkFailed = nextRetryCount >= MAX_RETRY_COUNT;
        const nextAttemptAt = shouldMarkFailed
            ? undefined
            : new Date(Date.now() + this.computeBackoffMs(nextRetryCount)).toISOString();

        await db.transaction('rw', [db.uploadQueue, db.attachments], async () => {
            await db.uploadQueue.update(queueItem.autoId, {
                status: shouldMarkFailed ? 'failed' : 'retry_wait',
                retryCount: nextRetryCount,
                lastAttemptAt: nowIso,
                nextAttemptAt,
                lastError: errorMessage,
                updatedAt: nowIso,
            });

            await db.attachments.update(attachment.id, {
                status: shouldMarkFailed ? 'failed' : 'pending',
                retryCount: nextRetryCount,
                lastError: errorMessage,
                updatedAt: nowIso,
            });
        });
    }

    private computeBackoffMs(retryCount: number): number {
        const exponential = BASE_BACKOFF_MS * (2 ** Math.max(0, retryCount - 1));
        const withCap = Math.min(exponential, MAX_BACKOFF_MS);
        const jitterMs = Math.floor(Math.random() * 1000);
        return Math.min(withCap + jitterMs, MAX_BACKOFF_MS);
    }
}

export const attachmentUploadWorker = AttachmentUploadWorker.getInstance();
