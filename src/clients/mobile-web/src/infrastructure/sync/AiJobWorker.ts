import { systemClock } from '../../core/domain/services/Clock';
import { getAuthSession } from '../storage/AuthTokenStore';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getDatabase, type PendingAiJobRecord } from '../storage/DexieDatabase';
import { isVoiceDoomLoopDetectorEnabled } from '../../app/featureFlags';
import { recordAiFailureSignature } from './AiDoomLoopDetector';
// spec: voice-diary-e2e-2026-05-17 (D.16) — opportunistic retained-tier
// archive immediately after a successful AI parse. The function is a
// no-op when the user has not granted FullHistoryJournal.
import { archiveToRetainedTierIfConsented } from '../voice/VoiceClipRetention';
import { reclaimAbandonedAiJobs } from './abandonedStateRecovery';

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
    /**
     * P0.7 — re-entrancy guard, added WITH the reclaim below and load-bearing
     * for it. `run()` is called from more than one place and was free to
     * overlap with itself. Once a cycle reclaims `processing` rows, an
     * overlapping call would flip a job the first call is genuinely working on
     * back to `pending` and parse it a second time. The guard is what makes
     * "this worker holds nothing right now" true at the top of the cycle.
     */
    private static cycleInProgress = false;

    static async run(): Promise<void> {
        if (!navigator.onLine || !getAuthSession()) {
            return;
        }

        if (AiJobWorker.cycleInProgress) {
            return;
        }

        AiJobWorker.cycleInProgress = true;
        try {
            await AiJobWorker.runCycle();
        } finally {
            AiJobWorker.cycleInProgress = false;
        }
    }

    private static async runCycle(): Promise<void> {
        // P0.7 — reclaim jobs a killed session left in `processing`, before this
        // cycle takes anything in hand. Only `pendingAiJobs` — never the upload
        // tables, whose worker runs on an independent timer and may genuinely
        // hold a row right now.
        await reclaimAbandonedAiJobs();

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
            // KEEP THE ANSWER. `executeJob` used to await the parse and assign
            // it to nothing: the audio uploaded, the server read it, this row
            // was marked `completed`, and the farmer's spoken note produced
            // nothing he could ever see. Marking a job done while throwing away
            // the only thing it produced is the sharpest form of the dishonesty
            // this codebase is removing — a green tick over an empty hand.
            const payload = await this.executeJob(job);

            await db.pendingAiJobs.update(job.id, {
                status: 'completed',
                updatedAt: systemClock.nowISO(),
                lastError: undefined,
                nextRetryAfterMs: undefined,
                result: {
                    operationType: job.operationType,
                    receivedAtUtc: systemClock.nowISO(),
                    payload,
                },
            });
            await this.updateVoiceClipStatus(job, 'parsed');

            // spec: voice-diary-e2e-2026-05-17 (D.16) — opportunistic
            // retained-tier archive. The function reads FullHistoryJournal
            // consent and exits early when not granted, so this hook is
            // safe to call unconditionally on every successful voice parse.
            //
            // THE RESULT IS NO LONGER DISCARDED (founder ruling D9).
            //
            // This call site used to be `await archiveToRetainedTierIfConsented(clipId);`
            // — value dropped on the floor — under a comment saying errors were
            // "swallowed inside the function (logged only)", while that function's
            // own comment said observability was "owned by the caller (AiJobWorker
            // hook)". Both halves pointed at the other and neither reported
            // anything. A consenting farmer's clip could fail to reach the
            // permanent tier, the job would still tick green, and thirty days
            // later the clip left the Voice Diary with nothing anywhere
            // recording why.
            //
            // The failure now lands in `emitClientError` from inside the archive
            // function (the only place that knows WHY it failed). What is added
            // here is the other half the brief asks for: the JOB RECORD stops
            // over-claiming. `status` stays `completed` because the parse
            // genuinely succeeded and re-running this job to retry an archive
            // would re-run a paid AI call and re-upload the audio — strictly
            // worse than the defect. `retainedArchive` is what makes "parsed and
            // archived" distinguishable from "parsed, archive failed".
            const clipId = job.context.idempotencyKey;
            if (clipId && job.operationType === 'voice_parse' && job.context.operation !== 'text') {
                // `job.context.farmId` is passed so a `clip_row_missing` report is not
                // content-free: without it that branch has no row to read a farm from,
                // and the surface these render on is farm-scoped (review I1 note).
                const outcome = await archiveToRetainedTierIfConsented(clipId, job.context.farmId);
                await db.pendingAiJobs.update(job.id, {
                    retainedArchive: {
                        status: outcome.status,
                        ...(outcome.status === 'archived' ? {} : { reason: outcome.reason }),
                        ...('attempts' in outcome ? { attempts: outcome.attempts } : {}),
                        at: systemClock.nowISO(),
                    },
                });
            }
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

    private static async executeJob(job: PendingAiJobWithId): Promise<unknown> {
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

                return await agriSyncClient.parseTextLog(
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
                        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21
                        // founder fix — when the queued job was a
                        // text fallback that originally accompanied a
                        // voice clip (clarification answer flow), the
                        // upstream recorder's recordedAtUtc was
                        // persisted in context; replay it here so the
                        // server stamps the original capture instant.
                        recordedAtUtc: context.recordedAtUtc,
                    },
                );
                return;
            }

            if (!job.inputBlob) {
                throw new Error('Missing audio blob for queued voice parse job.');
            }

            return await agriSyncClient.parseVoiceLog(
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
                    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder
                    // fix (Option B): replay the recorded-time stamp
                    // from the offline-queued context so post-drain
                    // POSTs match the wire contract a real-time POST
                    // would have used. Critical for evening offline
                    // recordings drained the next morning.
                    recordedAtUtc: context.recordedAtUtc,
                },
            );
            return;
        }

        if (!job.inputBlob) {
            throw new Error('Missing input blob for queued AI extraction job.');
        }

        if (job.operationType === 'receipt_extract') {
            return await agriSyncClient.extractReceipt(
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

            return await agriSyncClient.extractPatti(
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
