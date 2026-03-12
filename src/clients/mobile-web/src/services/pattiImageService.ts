/**
 * Thin-client patti extraction client.
 * Image parsing is performed by backend AI orchestration.
 */

import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { getAuthSession } from '../infrastructure/api/AuthTokenStore';
import { IdempotencyKeyFactory } from '../infrastructure/ai/IdempotencyKeyFactory';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';

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
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

export const processPattiImage = async (
    imageData: string,
    mimeType: string,
    cropName: string
): Promise<Record<string, unknown>> => {
    const farmId = await resolveFarmIdFromCache();
    if (!farmId) {
        return {
            success: false,
            confidence: 0,
            warning: 'No farm context available for AI patti extraction.',
        };
    }

    const blob = base64ToBlob(imageData, mimeType);
    const userId = getAuthSession()?.userId ?? 'unknown-user';
    const requestPayloadHash = await IdempotencyKeyFactory.hashBlob(blob);
    const keyMaterial = await IdempotencyKeyFactory.buildOperationKey({
        userId,
        farmId,
        operation: 'patti',
        contentHash: requestPayloadHash,
        versionTag: 'ocr-patti-v2',
    });
    const idempotencyKey = keyMaterial.idempotencyKey;

    if (!navigator.onLine) {
        const db = getDatabase();
        const nowIso = new Date().toISOString();
        await db.pendingAiJobs.add({
            operationType: 'patti_extract',
            inputBlob: blob,
            inputMimeType: mimeType,
            context: {
                farmId,
                userId,
                cropName,
                operation: 'patti',
                idempotencyKey,
                requestPayloadHash,
            },
            status: 'pending',
            createdAt: nowIso,
            updatedAt: nowIso,
            retryCount: 0,
        });

        return {
            success: false,
            confidence: 0,
            warning: 'Saved locally. Will process when connected.',
        };
    }

    const response = await agriSyncClient.extractPatti(
        blob,
        mimeType,
        cropName,
        farmId,
        idempotencyKey,
    );

    return {
        ...(response || {}),
        success: true,
    };
};

