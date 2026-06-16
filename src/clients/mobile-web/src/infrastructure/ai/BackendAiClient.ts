import { VoiceInput, VoiceParseResult, VoiceParserPort } from '../../application/ports';
import { AgriLogResponse, CropProfile, FarmerProfile } from '../../types';
import { LogScope } from '../../domain/types/log.types';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getAuthSession } from '../storage/AuthTokenStore';
import { getDatabase, type PendingAiJobContext, type VoiceClipStatus } from '../storage/DexieDatabase';
import { IdempotencyKeyFactory } from './IdempotencyKeyFactory';
import { annotateFieldConfidencesWithBuckets } from '../../domain/ai/contracts/FieldConfidence';
import { AgriLogResponseSchema } from '../../domain/ai/contracts/AgriLogResponseSchema';
import { computeProcessingVoiceClipExpiry, purgeExpiredProcessingVoiceClips } from '../voice/VoiceClipRetention';
import { resolveApiBaseUrl } from '../api/transport';
import { parseStreamConsumer } from './ParseStreamConsumer';
import type { ParseStreamEvent } from '../../domain/ai/contracts/ParseStreamEvent';
// spec: voice-diary-e2e-2026-05-17 (D.15) — internal pass-throughs to the
// dedicated voice-diary API client. Other call sites should import the
// `voiceDiaryApiClient` module directly; these methods exist so the
// AI-job-worker hook (D.16) can flow the archive call through the
// VoiceClipRetention extension without spreading a second API surface.
import {
    persistRetainedVoiceClip as persistRetainedVoiceClipApi,
    getVoiceDiaryByRange as getVoiceDiaryByRangeApi,
    getVoiceDiaryById as getVoiceDiaryByIdApi,
    type PersistVoiceClipRetainedRequest,
    type PersistVoiceClipRetainedResponse,
    type VoiceDiaryListItem,
    type VoiceDiaryByIdResult,
} from '../voiceDiary/voiceDiaryApiClient';
import {
    safeTrim,
    normalizeSuggestedAction,
    normalizeDriftedParsedLog,
    resolveFarmIdFromCache,
    base64ToBlob,
    resolveUserIdFromSession,
    estimateAudioDurationMs,
    buildVoiceSessionMetadataJson,
    type VoiceUploadMaterial,
} from './BackendAiClient.helpers';

// Re-exported for the existing __tests__/safeTrim.test.ts import path.
export { safeTrim } from './BackendAiClient.helpers';

export class BackendAiClient implements VoiceParserPort {
    async parseInput(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string }
    ): Promise<VoiceParseResult> {
        try {
            if (input.type === 'audio' && (!input.data || input.data.length === 0)) {
                return {
                    success: false,
                    error: 'No audio data captured',
                };
            }

            const farmId = await resolveFarmIdFromCache();
            if (!farmId) {
                return {
                    success: false,
                    error: 'No farm context available for AI parsing.',
                };
            }

            const userId = resolveUserIdFromSession();
            const context = this.buildContext(scope, crops, profile, options);

            if (!navigator.onLine) {
                await this.enqueueOfflineVoiceJob(input, farmId, userId, context, scope);
                return {
                    success: false,
                    error: 'Saved locally. Will process when connected.',
                };
            }

            const apiResult = input.type === 'audio'
                ? await this.submitVoiceAudioInput(input, farmId, userId, context, scope)
                : await this.submitVoiceTextInput(input, farmId, userId, context, scope);

            const confidenceScore = Number(apiResult.confidence || 0);
            const fieldConfidences = annotateFieldConfidencesWithBuckets(apiResult.fieldConfidences ?? {});
            const lowConfidenceFields = Object.entries(fieldConfidences)
                .filter(([, confidence]) => {
                    const level = confidence?.level;
                    return typeof level === 'string' && level.toLowerCase() === 'low';
                })
                .map(([field]) => field);
            const suggestedAction = normalizeSuggestedAction(apiResult.suggestedAction);

            // DATA_PRINCIPLE_SPINE 02.6 — strict Zod validation at the
            // wire boundary. The shallow `isAgriLogResponse` typeof check
            // accepted any object with the eight expected array keys,
            // letting hallucinated fields and off-canon enum values
            // (e.g. `categoryId: "made_up"`) corrupt the trust ledger
            // silently. The schema below enforces:
            //   - `.strict()` at the top level (unknown keys rejected)
            //   - canonical 13-code `categoryId` on activity expenses
            //   - typed enums for dayOutcome / labour.type / etc.
            //   - YYYY-MM-DD date-keys and ISO-8601 timestamps
            // Anything that fails throws synchronously and the caller
            // surfaces a parse error rather than persisting drift.
            const parseResult = AgriLogResponseSchema.safeParse(apiResult.parsedLog);
            // We cast back to the structural `AgriLogResponse` from
            // log.types.ts because that interface (with its concrete
            // event-event union shapes) is what the rest of the app
            // consumes. The schema and the TS interface are kept in
            // lockstep by the AgriLogResponseSchema header invariant.
            let parsedLog: AgriLogResponse;
            if (parseResult.success) {
                parsedLog = parseResult.data as unknown as AgriLogResponse;
            } else {
                // ROBUSTNESS_2026-06-10 (Option A): the server parsed the log fine,
                // but its legacy-prompt shape fails the strict schema (missing event
                // ids, scalar confidence, extra _meta keys). Don't discard a usable
                // parse — log the drift for telemetry and normalize the raw payload so
                // it renders on the confirm screen (the human review is the integrity
                // gate). Proper schema/prompt contract alignment tracked as follow-up B.
                console.warn(
                    '[voice-parse] AgriLogResponse schema drift — using normalized raw parse instead of discarding.',
                    parseResult.error?.issues,
                );
                parsedLog = normalizeDriftedParsedLog(apiResult.parsedLog) as unknown as AgriLogResponse;
            }
            const inferredTranscript = typeof parsedLog?.fullTranscript === 'string'
                ? parsedLog.fullTranscript
                : (input.type === 'text' ? input.content : undefined);

            return {
                success: true,
                data: parsedLog,
                confidenceAssessment: {
                    fieldConfidences,
                    suggestedAction,
                    averageScore: confidenceScore,
                    hasLowConfidenceFields: lowConfidenceFields.length > 0,
                    lowConfidenceFields,
                },
                provenance: {
                    source: 'ai',
                    model: apiResult.modelUsed,
                    // DATA_PRINCIPLE_SPINE sub-phase 01.6 — spine-honest alias.
                    // Kept alongside `model` for back-compat with pre-spine readers.
                    modelVersion: apiResult.modelUsed,
                    promptVersion: apiResult.promptVersion,
                    promptContentHash: apiResult.promptContentHash ?? undefined,
                    appVersion: apiResult.appVersion ?? undefined,
                    sourceAiJobId: apiResult.sourceAiJobId ?? undefined,
                    rawInputRef: apiResult.rawInputRef ?? null,
                    providerUsed: apiResult.providerUsed,
                    fallbackUsed: apiResult.fallbackUsed,
                    timestamp: new Date().toISOString(),
                    processingTimeMs: apiResult.latencyMs,
                    confidenceScore,
                    validation: {
                        stage: 'infrastructure_parser',
                        outcome: (apiResult.validationOutcome || '').toLowerCase().includes('fail') ? 'fail' : 'pass',
                    },
                    rawTranscript: inferredTranscript,
                },
                rawTranscript: inferredTranscript,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error && error.message
                    ? error.message
                    : 'Failed to parse voice input.',
            };
        }
    }

    /**
     * VOICE_LATENCY_PIPELINE_V2 Phase 3 — streaming parse path.
     *
     * Calls `POST /shramsafal/ai/parse-voice-stream` and yields typed
     * events as they arrive. Honors the silent-fallback contract
     * (handoff §100-110, plan §7 acceptance criterion 7): on any error
     * before the first event arrives — offline, non-2xx, missing farm,
     * non-text/event-stream response, network throw — transparently
     * delegates to the non-streaming `parseInput` path and synthesizes
     * a single terminal `complete` (or `error`) event so the consumer
     * sees a unified contract regardless of which path executed.
     *
     * Audio inputs always silent-fallback today: the streaming endpoint
     * accepts only `transcript`. STT-then-stream is a future phase.
     */
    parseInputStream(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string; scenarioId?: string },
    ): AsyncIterable<ParseStreamEvent> {
        return this.streamOrFallback(input, scope, crops, profile, options);
    }

    private async *streamOrFallback(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string; scenarioId?: string },
    ): AsyncIterable<ParseStreamEvent> {
        const fallback = (): AsyncIterable<ParseStreamEvent> =>
            this.fallbackToBatch(input, scope, crops, profile, options);

        if (input.type !== 'text' || !navigator.onLine) {
            yield* fallback();
            return;
        }

        const transcript = safeTrim(input.content, 'input.content');
        if (!transcript) {
            yield* fallback();
            return;
        }

        // voice-live-captions-banner-2026-06-10 — prod backend SHA 016374f1
        // made /shramsafal/ai/parse-voice-stream establish a tenant scope from
        // a `farmId` field on the request body (matching the batch
        // /ai/voice-parse contract). Resolve it the same way the batch path
        // does (SessionStore → me-context → pull cache → dayLedgers). Without a
        // resolvable farm there's no tenant to scope to, so degrade to the
        // batch path (which surfaces the same "No farm context" error rather
        // than a confusing 500 from the stream).
        const farmId = await resolveFarmIdFromCache();
        if (!farmId) {
            yield* fallback();
            return;
        }

        let response: Response;
        try {
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix —
            // text inputs typically have no MediaRecorder moment, but
            // useVoiceRecorder.processInput may forward a transcript
            // produced by an upstream STT step where the original
            // audio's recordedAtUtc IS known. We tunnel it through
            // VoiceInput via a runtime cast so the streaming POST can
            // include it on the JSON body without breaking the
            // VoiceInput compile-time union (text variant has no
            // recordedAtUtc declared today; adding one would force a
            // shape diff across every text-only callsite).
            const recordedAtUtc = (input as { recordedAtUtc?: string }).recordedAtUtc;
            response = await this.fetchParseVoiceStream(transcript, scope, crops, profile, {
                ...options,
                recordedAtUtc,
                farmId,
            });
        } catch {
            yield* fallback();
            return;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.toLowerCase().includes('text/event-stream') || !response.body) {
            // Drain and discard so the connection releases promptly.
            await response.body?.cancel().catch(() => undefined);
            yield* fallback();
            return;
        }

        // voice-sarvam-live-captions-2026-06-11 — bulletproof fallback.
        // The streaming parse-voice-stream call is only a "success" when it
        // delivers a terminal `complete` event carrying a payload. ANY other
        // terminus — a terminal `error` event, a stream that breaks mid-flight,
        // or a stream that simply ends without ever emitting `complete` (no
        // terminal event) — means NO log would be created on this path. In
        // every such case we MUST fall back to the proven batch /voice-parse
        // path so a log is always created. We buffer the streamed events and
        // only flush them to the consumer once we have seen the terminal
        // `complete`; if the stream terminates any other way, we discard the
        // partial events and yield the batch fallback instead. This keeps the
        // founder rule "voice can NEVER break" — a streaming failure can never
        // leave the user with no log.
        const buffered: ParseStreamEvent[] = [];
        let sawComplete = false;
        try {
            for await (const event of parseStreamConsumer(response)) {
                buffered.push(event);
                if (event.type === 'complete') {
                    sawComplete = true;
                }
            }
        } catch {
            // Stream broke mid-flight (network drop, malformed framing, etc).
            // Treat exactly like "no terminal complete" → batch fallback below.
        }

        if (sawComplete) {
            // Happy path: flush the streamed events (text chunks +
            // field_complete arrivals + the terminal complete) to the
            // consumer so the wizard still sees live field arrivals.
            yield* buffered;
            return;
        }

        // No terminal `complete` — terminal error, mid-flight break, or a
        // stream that ended without completing. Discard the partial events
        // (a half-arrived stream is unusable for committing a draft) and run
        // the guaranteed batch fallback so a log is always created.
        yield* fallback();
    }

    private async fetchParseVoiceStream(
        transcript: string,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string; scenarioId?: string; recordedAtUtc?: string; farmId?: string },
    ): Promise<Response> {
        const baseUrl = resolveApiBaseUrl();
        const session = getAuthSession();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
        };
        if (session?.accessToken) {
            headers.Authorization = `Bearer ${session.accessToken}`;
        }

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — JSON
        // body field `recordedAt` aligns with the backend
        // ParseVoiceStreamRequest.RecordedAt property. When omitted
        // the structurer prompt falls back to "unknown" per contract.
        // voice-live-captions-banner-2026-06-10 — `farmId` lets the endpoint
        // establish the caller's tenant scope (prod SHA 016374f1) so the
        // stream no longer 500s on the DB read.
        const body = JSON.stringify({
            transcript,
            farmId: options?.farmId,
            context: this.buildContext(scope, crops, profile, options),
            scenarioId: options?.scenarioId,
            recordedAt: options?.recordedAtUtc,
        });

        return fetch(`${baseUrl}/shramsafal/ai/parse-voice-stream`, {
            method: 'POST',
            headers,
            body,
        });
    }

    private async *fallbackToBatch(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string },
    ): AsyncIterable<ParseStreamEvent> {
        const result = await this.parseInput(input, scope, crops, profile, options);
        if (result.success && result.data) {
            yield {
                type: 'complete',
                payload: result.data,
                promptVersion: result.provenance?.promptVersion,
                modelMs: result.provenance?.processingTimeMs,
            };
            return;
        }
        yield {
            type: 'error',
            error: result.error ?? 'Voice parse failed.',
        };
    }

    private async submitVoiceAudioInput(
        input: Extract<VoiceInput, { type: 'audio' }>,
        farmId: string,
        userId: string,
        parseContext: object,
        scope: LogScope,
    ) {
        const material = await this.resolveVoiceUploadMaterial(input, farmId, userId);
        await this.persistProcessingVoiceClip(material, farmId, scope, 'parsing');

        try {
            const result = await agriSyncClient.parseVoiceLog(
                material.audioBlob,
                material.mimeType,
                parseContext,
                farmId,
                {
                    plotId: scope.selectedPlotIds[0],
                    cropCycleId: undefined,
                    idempotencyKey: material.idempotencyKey,
                    requestPayloadHash: material.requestPayloadHash,
                    inputSpeechDurationMs: material.inputSpeechDurationMs,
                    inputRawDurationMs: material.inputRawDurationMs,
                    segmentMetadataJson: material.segmentMetadataJson,
                    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder
                    // fix (Option B): forward to the multipart
                    // `recorded_at` form field so the structurer prompt
                    // anchors temporal cues to the recording moment.
                    recordedAtUtc: material.recordedAtUtc,
                },
            );
            await this.persistProcessingVoiceClip(material, farmId, scope, 'parsed');
            return result;
        } catch (error) {
            await this.persistProcessingVoiceClip(
                material,
                farmId,
                scope,
                'failed',
                undefined,
                error instanceof Error ? error.message : 'Voice parse failed.',
            );
            throw error;
        }
    }

    private async submitVoiceTextInput(
        input: Extract<VoiceInput, { type: 'text' }>,
        farmId: string,
        userId: string,
        parseContext: object,
        scope: LogScope,
    ) {
        const transcript = safeTrim(input.content, 'input.content');
        const requestPayloadHash = input.requestPayloadHash
            ?? await IdempotencyKeyFactory.hashString(transcript);

        const keyMaterial = input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey, deterministicSeed: '' }
            : await IdempotencyKeyFactory.buildOperationKey({
                userId,
                farmId,
                operation: 'text',
                contentHash: requestPayloadHash,
            });

        return agriSyncClient.parseTextLog(
            transcript,
            parseContext,
            farmId,
            {
                plotId: scope.selectedPlotIds[0],
                cropCycleId: undefined,
                idempotencyKey: keyMaterial.idempotencyKey,
                requestPayloadHash,
            },
        );
    }

    private async resolveVoiceUploadMaterial(
        input: Extract<VoiceInput, { type: 'audio' }>,
        farmId: string,
        userId: string,
    ): Promise<VoiceUploadMaterial> {
        const audioBlob = base64ToBlob(input.data, input.mimeType);
        const payloadHash = input.requestPayloadHash
            ?? input.contentHash
            ?? await IdempotencyKeyFactory.hashBlob(audioBlob);

        const sessionId = safeTrim(input.sessionId, 'sessionId') || payloadHash.slice(0, 24);
        const segmentIndex = Number.isFinite(input.segmentIndex) ? (input.segmentIndex as number) : 0;
        const keyMaterial = input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey, deterministicSeed: '' }
            : await IdempotencyKeyFactory.buildVoiceKey({
                userId,
                farmId,
                sessionId,
                segmentIndex,
                contentHash: payloadHash,
            });

        const inferredDurationMs = await estimateAudioDurationMs(audioBlob);
        const inputSpeechDurationMs = input.inputSpeechDurationMs ?? inferredDurationMs;
        const inputRawDurationMs = input.inputRawDurationMs ?? inputSpeechDurationMs ?? inferredDurationMs;
        const segmentMetadataJson = input.segmentMetadataJson
            ?? buildVoiceSessionMetadataJson({
                sessionId,
                farmId,
                inputSpeechDurationMs,
                inputRawDurationMs,
            });

        return {
            audioBlob,
            mimeType: input.mimeType,
            idempotencyKey: keyMaterial.idempotencyKey,
            requestPayloadHash: payloadHash,
            inputSpeechDurationMs,
            inputRawDurationMs,
            segmentMetadataJson,
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix —
            // forward the recorder-supplied recordedAtUtc straight
            // through. Missing (legacy/orphan clip / pre-fix recorder)
            // → omitted by parseVoiceLog and server falls back to null.
            recordedAtUtc: input.recordedAtUtc,
        };
    }

    private async enqueueOfflineVoiceJob(
        input: VoiceInput,
        farmId: string,
        userId: string,
        parseContext: object,
        scope: LogScope,
    ): Promise<void> {
        const db = getDatabase();
        const nowIso = new Date().toISOString();
        const baseContext: PendingAiJobContext = {
            farmId,
            userId,
            plotId: scope.selectedPlotIds[0],
            cropCycleId: undefined,
            parseContext,
        };

        if (input.type === 'audio') {
            const material = await this.resolveVoiceUploadMaterial(input, farmId, userId);
            const pendingJobId = await db.pendingAiJobs.add({
                operationType: 'voice_parse',
                inputBlob: material.audioBlob,
                inputMimeType: material.mimeType,
                context: {
                    ...baseContext,
                    operation: 'voice',
                    idempotencyKey: material.idempotencyKey,
                    requestPayloadHash: material.requestPayloadHash,
                    inputSpeechDurationMs: material.inputSpeechDurationMs,
                    inputRawDurationMs: material.inputRawDurationMs,
                    segmentMetadataJson: material.segmentMetadataJson,
                    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder
                    // fix — persist the recordedAtUtc onto the offline
                    // queue context so when the worker drains the
                    // queue (possibly hours later when connectivity
                    // returns) the original recording instant flows to
                    // the server, not the queue-drain wall clock.
                    recordedAtUtc: material.recordedAtUtc,
                },
                status: 'pending',
                createdAt: nowIso,
                updatedAt: nowIso,
                retryCount: 0,
            });
            await this.persistProcessingVoiceClip(material, farmId, scope, 'queued', pendingJobId);
            return;
        }

        const transcript = safeTrim(input.content, 'input.content');
        const requestPayloadHash = input.requestPayloadHash
            ?? await IdempotencyKeyFactory.hashString(transcript);
        const keyMaterial = input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey, deterministicSeed: '' }
            : await IdempotencyKeyFactory.buildOperationKey({
                userId,
                farmId,
                operation: 'text',
                contentHash: requestPayloadHash,
            });

        await db.pendingAiJobs.add({
            operationType: 'voice_parse',
            context: {
                ...baseContext,
                operation: 'text',
                textTranscript: transcript,
                idempotencyKey: keyMaterial.idempotencyKey,
                requestPayloadHash,
            },
            status: 'pending',
            createdAt: nowIso,
            updatedAt: nowIso,
            retryCount: 0,
        });
    }

    private async persistProcessingVoiceClip(
        material: VoiceUploadMaterial,
        farmId: string,
        scope: LogScope,
        status: VoiceClipStatus,
        pendingAiJobId?: number,
        lastError?: string,
    ): Promise<void> {
        const db = getDatabase();
        const nowIso = new Date().toISOString();
        const existing = await db.voiceClips.get(material.idempotencyKey);
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — prefer
        // the material.recordedAtUtc (from MediaRecorder.onstop) over
        // nowIso so the Dexie row's recordedAtUtc and the wire's
        // multipart `recorded_at` field stay in lockstep. Existing rows
        // win to keep idempotent re-persists stable.
        const recordedAtUtc = existing?.recordedAtUtc ?? material.recordedAtUtc ?? nowIso;

        await db.voiceClips.put({
            ...existing,
            id: material.idempotencyKey,
            farmId,
            plotId: scope.selectedPlotIds[0],
            cropCycleId: undefined,
            pendingAiJobId: pendingAiJobId ?? existing?.pendingAiJobId,
            recordedAtUtc,
            durationMs: material.inputSpeechDurationMs ?? material.inputRawDurationMs ?? existing?.durationMs,
            mimeType: material.mimeType,
            sizeBytes: material.audioBlob.size,
            localBlob: material.audioBlob,
            status,
            retentionPolicy: 'processing_30d',
            expiresAtUtc: existing?.expiresAtUtc ?? computeProcessingVoiceClipExpiry(recordedAtUtc),
            createdAt: existing?.createdAt ?? nowIso,
            updatedAt: nowIso,
            lastError,
        });

        await purgeExpiredProcessingVoiceClips();
    }

    // -------------------------------------------------------------------
    // VOICE DIARY E2E — retained-tier surface (D.15)
    //
    // Thin pass-throughs to `voiceDiaryApiClient.ts`. The dedicated
    // client module is the public surface for VoiceDiaryPage + the
    // archive worker in `VoiceClipRetention.ts`; these methods exist
    // so AI-pipeline callers (sync, observability, future re-seal
    // cascades) can re-use the same client without reaching across
    // module boundaries. They DO NOT introduce new business rules;
    // the consent gate lives 100% on the backend in
    // PersistVoiceClipRetainedHandler.
    // -------------------------------------------------------------------

    async persistRetainedVoiceClip(
        request: PersistVoiceClipRetainedRequest,
    ): Promise<PersistVoiceClipRetainedResponse> {
        return persistRetainedVoiceClipApi(request);
    }

    async getVoiceDiaryByRange(fromDate: string, toDate: string): Promise<VoiceDiaryListItem[]> {
        return getVoiceDiaryByRangeApi(fromDate, toDate);
    }

    async getVoiceDiaryById(clipId: string): Promise<VoiceDiaryByIdResult | null> {
        return getVoiceDiaryByIdApi(clipId);
    }

    private buildContext(
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string },
    ) {
        const selectedCropIds = new Set(scope.selectedCropIds);
        const selectedPlotIds = new Set(scope.selectedPlotIds);

        const availableCrops = crops.map(crop => ({
            id: crop.id,
            name: crop.name,
            plots: crop.plots.map(plot => ({
                id: plot.id,
                name: plot.name,
                infrastructure: {
                    irrigationMethod: plot.infrastructure?.irrigationMethod ?? null,
                    linkedMotorId: plot.infrastructure?.linkedMotorId ?? null,
                    dripDetails: {
                        flowRatePerHour: plot.infrastructure?.dripDetails?.flowRatePerHour ?? null,
                    },
                },
                irrigationPlan: {
                    durationMinutes: plot.irrigationPlan?.durationMinutes ?? null,
                },
            })),
        }));

        const selection = crops
            .filter(crop => selectedCropIds.has(crop.id))
            .map(crop => ({
                cropId: crop.id,
                cropName: crop.name,
                selectedPlotIds: crop.plots.filter(plot => selectedPlotIds.has(plot.id)).map(plot => plot.id),
                selectedPlotNames: crop.plots.filter(plot => selectedPlotIds.has(plot.id)).map(plot => plot.name),
            }));

        return {
            availableCrops,
            profile: {
                motors: profile.motors.map(motor => ({
                    id: motor.id,
                    name: motor.name,
                    hp: motor.hp,
                    linkedWaterSourceId: motor.linkedWaterSourceId,
                })),
                waterResources: profile.waterResources.map(resource => ({
                    id: resource.id,
                    name: resource.name,
                })),
                machineries: (profile.machineries || []).map(machine => ({
                    name: machine.name,
                    type: machine.type,
                    capacity: machine.capacity ? `${machine.capacity}` : null,
                })),
                ledgerDefaults: null,
            },
            farmContext: { selection },
            focusCategory: options?.focusCategory ?? null,
            vocabDb: null,
        };
    }
}
