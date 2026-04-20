import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';

export interface VocabLearningResult {
    success: boolean;
    parsedLog?: Record<string, unknown>;
    confidence?: number;
    message?: string;
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

/**
 * Backward-compatible name retained, but execution is routed to backend AI.
 * No direct Gemini SDK/API calls from frontend.
 */
export async function callGeminiForVocabLearning(
    transcript: string,
    options?: {
        farmId?: string;
        idempotencyKey?: string;
    },
): Promise<VocabLearningResult> {
    const trimmedTranscript = transcript.trim();
    if (!trimmedTranscript) {
        return {
            success: false,
            message: 'Transcript is required for vocabulary learning.',
        };
    }

    const farmId = options?.farmId ?? await resolveFarmIdFromCache();
    if (!farmId) {
        return {
            success: false,
            message: 'No farm context available for vocabulary learning.',
        };
    }

    try {
        const response = await agriSyncClient.parseVoice(trimmedTranscript, {
            farmId,
            idempotencyKey: options?.idempotencyKey,
            contextJson: JSON.stringify({
                focusCategory: 'vocab_learning',
                feature: 'frontend_vocab_learner',
            }),
        });

        return {
            success: Boolean(response.success ?? true),
            parsedLog: response.parsedLog,
            confidence: response.confidence,
        };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Vocab learning request failed.',
        };
    }
}

export async function learnVocabularyWithBackend(
    transcript: string,
    options?: {
        farmId?: string;
        idempotencyKey?: string;
    },
): Promise<VocabLearningResult> {
    return callGeminiForVocabLearning(transcript, options);
}
