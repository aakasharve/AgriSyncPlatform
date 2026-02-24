import { VoiceInput, VoiceParseResult, VoiceParserPort } from '../../application/ports';
import { CropProfile, FarmerProfile } from '../../types';
import { LogScope } from '../../domain/types/log.types';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getAuthSession } from '../api/AuthTokenStore';
import { getDatabase, type PendingAiJobContext } from '../storage/DexieDatabase';
import { IdempotencyKeyFactory } from './IdempotencyKeyFactory';

type VoiceUploadMaterial = {
    audioBlob: Blob;
    mimeType: string;
    idempotencyKey: string;
    requestPayloadHash: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    segmentMetadataJson?: string;
};

function normalizeSuggestedAction(action?: string): 'auto_confirm' | 'manual_review' | 'ask_clarification' {
    const normalized = (action || '').trim().toLowerCase();
    if (normalized === 'auto_confirm') return 'auto_confirm';
    if (normalized === 'ask_clarification') return 'ask_clarification';
    return 'manual_review';
}

async function resolveFarmIdFromCache(): Promise<string | undefined> {
    const db = getDatabase();

    const cachedPayload = await db.appMeta.get('shramsafal_last_pull_payload');
    const farms = (cachedPayload?.value as { farms?: Array<{ id?: string }> } | undefined)?.farms ?? [];
    const firstFarmId = farms.find(farm => typeof farm.id === 'string' && farm.id.length > 0)?.id;
    if (firstFarmId) {
        return firstFarmId;
    }

    const firstDayLedger = await db.dayLedgers.toCollection().first();
    return firstDayLedger?.farmId;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const normalized = base64.includes(',') ? base64.split(',')[1] : base64;
    const binaryString = atob(normalized);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

function resolveUserIdFromSession(): string {
    const session = getAuthSession();
    if (session?.userId && session.userId.trim().length > 0) {
        return session.userId.trim();
    }

    return 'unknown-user';
}

function getAudioContextCtor(): (new(...args: unknown[]) => AudioContext) | null {
    if (typeof AudioContext !== 'undefined') {
        return AudioContext;
    }

    const maybeWindow = typeof window !== 'undefined'
        ? (window as unknown as { webkitAudioContext?: typeof AudioContext })
        : undefined;
    return maybeWindow?.webkitAudioContext ?? null;
}

async function estimateAudioDurationMs(audioBlob: Blob): Promise<number | undefined> {
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
        return undefined;
    }

    const audioContext = new AudioContextCtor();
    try {
        const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
        return Math.round((audioBuffer.length / audioBuffer.sampleRate) * 1000);
    } catch {
        return undefined;
    } finally {
        await audioContext.close().catch(() => {});
    }
}

function buildVoiceSessionMetadataJson(params: {
    sessionId: string;
    farmId: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
}): string | undefined {
    const speech = params.inputSpeechDurationMs ?? params.inputRawDurationMs;
    const raw = params.inputRawDurationMs ?? params.inputSpeechDurationMs;
    if (speech === undefined && raw === undefined) {
        return undefined;
    }

    const safeSpeech = speech ?? 0;
    const safeRaw = raw ?? safeSpeech;
    const metadata = {
        sessionId: params.sessionId,
        farmId: params.farmId,
        totalSegments: 1,
        totalSpeechDurationMs: safeSpeech,
        totalRawDurationMs: safeRaw,
        totalSilenceRemovedMs: Math.max(0, safeRaw - safeSpeech),
        compressionRatio: 1,
        deviceTimestamp: new Date().toISOString(),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    return JSON.stringify(metadata);
}

export class BackendAiClient implements VoiceParserPort {
    async parseInput(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string }
    ): Promise<VoiceParseResult> {
        try {
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
            const fieldConfidences = apiResult.fieldConfidences ?? {};
            const lowConfidenceFields = Object.entries(fieldConfidences)
                .filter(([, confidence]) => (confidence?.level || '').toLowerCase() === 'low')
                .map(([field]) => field);
            const suggestedAction = normalizeSuggestedAction(apiResult.suggestedAction);

            const parsedLog = apiResult.parsedLog as Record<string, unknown>;
            const inferredTranscript = typeof parsedLog?.fullTranscript === 'string'
                ? parsedLog.fullTranscript
                : (input.type === 'text' ? input.content : undefined);

            return {
                success: true,
                data: parsedLog as any,
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

    private async submitVoiceAudioInput(
        input: Extract<VoiceInput, { type: 'audio' }>,
        farmId: string,
        userId: string,
        parseContext: object,
        scope: LogScope,
    ) {
        const material = await this.resolveVoiceUploadMaterial(input, farmId, userId);
        return agriSyncClient.parseVoiceLog(
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
            },
        );
    }

    private async submitVoiceTextInput(
        input: Extract<VoiceInput, { type: 'text' }>,
        farmId: string,
        userId: string,
        parseContext: object,
        scope: LogScope,
    ) {
        const transcript = input.content.trim();
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

        const sessionId = input.sessionId?.trim() || payloadHash.slice(0, 24);
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
            await db.pendingAiJobs.add({
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
                },
                status: 'pending',
                createdAt: nowIso,
                updatedAt: nowIso,
                retryCount: 0,
            });
            return;
        }

        const transcript = input.content.trim();
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
