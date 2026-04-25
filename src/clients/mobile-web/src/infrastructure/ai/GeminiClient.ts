import { VoiceInput, VoiceParseResult, VoiceParserPort } from '../../application/ports';
import { AgriLogResponse, CropProfile, FarmerProfile } from '../../types';
import { LogScope } from '../../domain/types/log.types';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';
import { annotateFieldConfidencesWithBuckets } from '../../domain/ai/contracts/FieldConfidence';

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAgriLogResponse(value: unknown): value is AgriLogResponse {
    return isRecord(value)
        && typeof value.summary === 'string'
        && typeof value.dayOutcome === 'string'
        && Array.isArray(value.cropActivities)
        && Array.isArray(value.irrigation)
        && Array.isArray(value.labour)
        && Array.isArray(value.inputs)
        && Array.isArray(value.machinery)
        && Array.isArray(value.activityExpenses)
        && Array.isArray(value.missingSegments);
}

export class GeminiClient implements VoiceParserPort {
    async parseInput(
        input: VoiceInput,
        _scope: LogScope,
        _crops: CropProfile[],
        _profile: FarmerProfile,
        _options?: { focusCategory?: string }
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

            const apiResult = await agriSyncClient.parseVoice(
                input.type === 'text' ? input.content : '',
                {
                    farmId,
                    audioBase64: input.type === 'audio' ? input.data : undefined,
                    audioMimeType: input.type === 'audio' ? input.mimeType : undefined,
                });

            const confidenceScore = Number(apiResult.confidence || 0);
            const fieldConfidences = annotateFieldConfidencesWithBuckets(apiResult.fieldConfidences ?? {});
            const lowConfidenceFields = Object.entries(fieldConfidences)
                .filter(([, confidence]) => confidence.level?.toLowerCase() === 'low')
                .map(([field]) => field);
            const suggestedAction = normalizeSuggestedAction(apiResult.suggestedAction);
            if (!isAgriLogResponse(apiResult.parsedLog)) {
                return {
                    success: false,
                    error: 'Server returned unexpected data format',
                };
            }

            return {
                success: true,
                data: apiResult.parsedLog,
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
                    promptVersion: apiResult.promptVersion,
                    providerUsed: apiResult.providerUsed,
                    fallbackUsed: apiResult.fallbackUsed,
                    timestamp: new Date().toISOString(),
                    processingTimeMs: apiResult.latencyMs,
                    confidenceScore,
                    validation: {
                        stage: 'infrastructure_parser',
                        outcome: apiResult.validationOutcome?.toLowerCase().includes('fail') ? 'fail' : 'pass',
                    },
                    rawTranscript: input.type === 'text' ? input.content : undefined,
                },
                rawTranscript: input.type === 'text' ? input.content : undefined,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to parse voice input.',
            };
        }
    }
}
