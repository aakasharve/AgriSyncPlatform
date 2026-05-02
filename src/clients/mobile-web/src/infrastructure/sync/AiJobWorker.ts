import { systemClock } from '../../core/domain/services/Clock';
import { getAuthSession } from '../storage/AuthTokenStore';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getDatabase, type PendingAiJobRecord } from '../storage/DexieDatabase';
import { isVoiceDoomLoopDetectorEnabled } from '../../app/featureFlags';
import { recordAiFailureSignature } from './AiDoomLoopDetector';

const MAX_RETRIES = 5;
const BATCH_LIMIT = 10;
const AI_JOB_TOAST_EVENT = 'agrisync:toast';
const PERMANENT_FAILURE_MESSAGE_MR = 'कार्य प्रक्रिया अयशस्वी — पुन्हा प्रयत्न करा';

type PendingAiJobWithId = PendingAiJobRecord & { id: number };

function toPendingJobWithId(record: PendingAiJobRecord): PendingAiJobWithId | null {
    if (record.id === undefined) {
        return null;
    }

    return record as PendingAiJobWithId;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    return 'AI job processing failed.';
}

function emitPermanentFailureToast(): void {
    window.dispatchEvent(new CustomEvent(AI_JOB_TOAST_EVENT, {
        detail: {
            message: PERMANENT_FAILURE_MESSAGE_MR,
            type: 'error',
        },
    }));
}

export class AiJobWorker {
    static async run(): Promise<void> {
        if (!navigator.onLine || !getAuthSession()) {
            return;
        }

        const db = getDatabase();
        const pendingJobs = await db.pendingAiJobs
            .where('status')
            .anyOf('pending', 'failed')
            .filter(job => !job.nextRetryAfterMs || job.nextRetryAfterMs <= Date.now())
            .toArray();

        const jobsToProcess = pendingJobs
            .map(toPendingJobWithId)
            .filter((job): job is PendingAiJobWithId => job !== null)
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
            .slice(0, BATCH_LIMIT);

        for (const job of jobsToProcess) {
            if (!navigator.onLine) {
                return;
            }

            await this.processJob(job);
        }
    }

    private static async processJob(job: PendingAiJobWithId): Promise<void> {
        const db = getDatabase();
        const processingAt = systemClock.nowISO();

        await db.pendingAiJobs.update(job.id, {
            status: 'processing',
            updatedAt: processingAt,
            lastError: undefined,
            nextRetryAfterMs: undefined,
        });
        await this.updateVoiceClipStatus(job, 'parsing');

        try {
            await this.executeJob(job);

            await db.pendingAiJobs.update(job.id, {
                status: 'completed',
                updatedAt: systemClock.nowISO(),
                lastError: undefined,
                nextRetryAfterMs: undefined,
            });
            await this.updateVoiceClipStatus(job, 'parsed');
        } catch (error) {
            const nextRetryCount = job.retryCount + 1;
            const doomLoopDecision = recordAiFailureSignature(job, error);
            const isDoomLoop = isVoiceDoomLoopDetectorEnabled() && doomLoopDecision.shouldStop;
            const isPermanentFailure = isDoomLoop || nextRetryCount >= MAX_RETRIES;
            const backoffMs = Math.min(1000 * Math.pow(2, nextRetryCount), 60000);
            const nextRetryAfterMs = Date.now() + backoffMs;
            const errorMessage = getErrorMessage(error);

            await db.pendingAiJobs.update(job.id, {
                status: isPermanentFailure ? 'failed_permanent' : 'failed',
                retryCount: nextRetryCount,
                updatedAt: systemClock.nowISO(),
                lastError: isDoomLoop && doomLoopDecision.reason
                    ? `${errorMessage} (${doomLoopDecision.reason})`
                    : errorMessage,
                nextRetryAfterMs: isPermanentFailure ? undefined : nextRetryAfterMs,
                attemptSignatures: doomLoopDecision.attemptSignatures,
            });
            await this.updateVoiceClipStatus(job, 'failed', errorMessage);

            console.error(JSON.stringify({
                level: 'error',
                component: 'AiJobWorker',
                jobId: job.id,
                message: 'AI job failed',
                errorClass: doomLoopDecision.errorClass,
                doomLoopStopped: isDoomLoop,
                error: error instanceof Error
                    ? { message: error.message, stack: error.stack }
                    : String(error),
                timestamp: new Date().toISOString(),
            }));

            if (isPermanentFailure) {
                emitPermanentFailureToast();
            }
        }
    }

    private static async updateVoiceClipStatus(
        job: PendingAiJobWithId,
        status: 'parsing' | 'parsed' | 'failed',
        lastError?: string,
    ): Promise<void> {
        const clipId = job.context.idempotencyKey;
        if (!clipId) {
            return;
        }

        const db = getDatabase();
        await db.voiceClips.update(clipId, {
            status,
            updatedAt: systemClock.nowISO(),
            lastError,
        });
    }

    private static async executeJob(job: PendingAiJobWithId): Promise<void> {
        const { context } = job;

        const farmId = context.farmId?.trim();
        if (!farmId) {
            throw new Error('Missing farmId in pending AI job context.');
        }

        const parseContext = context.parseContext ?? {};

        if (job.operationType === 'voice_parse') {
            if (context.operation === 'text') {
                const transcript = context.textTranscript?.trim();
                if (!transcript) {
                    throw new Error('Missing text transcript for queued text voice parse.');
                }

                await agriSyncClient.parseTextLog(
                    transcript,
                    parseContext,
                    farmId,
                    {
                        plotId: context.plotId,
                        cropCycleId: context.cropCycleId,
                        idempotencyKey: context.idempotencyKey,
                        requestPayloadHash: context.requestPayloadHash,
                        inputSpeechDurationMs: context.inputSpeechDurationMs,
                        inputRawDurationMs: context.inputRawDurationMs,
                        segmentMetadataJson: context.segmentMetadataJson,
                    },
                );
                return;
            }

            if (!job.inputBlob) {
                throw new Error('Missing audio blob for queued voice parse job.');
            }

            await agriSyncClient.parseVoiceLog(
                job.inputBlob,
                job.inputMimeType ?? 'audio/webm',
                parseContext,
                farmId,
                {
                    plotId: context.plotId,
                    cropCycleId: context.cropCycleId,
                    idempotencyKey: context.idempotencyKey,
                    requestPayloadHash: context.requestPayloadHash,
                    inputSpeechDurationMs: context.inputSpeechDurationMs,
                    inputRawDurationMs: context.inputRawDurationMs,
                    segmentMetadataJson: context.segmentMetadataJson,
                },
            );
            return;
        }

        if (!job.inputBlob) {
            throw new Error('Missing input blob for queued AI extraction job.');
        }

        if (job.operationType === 'receipt_extract') {
            await agriSyncClient.extractReceipt(
                job.inputBlob,
                job.inputMimeType ?? 'image/jpeg',
                farmId,
                context.idempotencyKey,
            );
            return;
        }

        if (job.operationType === 'patti_extract') {
            const cropName = context.cropName?.trim();
            if (!cropName) {
                throw new Error('Missing cropName for queued patti extract job.');
            }

            await agriSyncClient.extractPatti(
                job.inputBlob,
                job.inputMimeType ?? 'image/jpeg',
                cropName,
                farmId,
                context.idempotencyKey,
            );
            return;
        }

        throw new Error(`Unsupported AI operation '${job.operationType}'.`);
    }
}
