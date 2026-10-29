/**
 * Thin-client patti extraction client.
 * Image parsing is performed by backend AI orchestration.
 */

import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { getAuthSession } from '../infrastructure/storage/AuthTokenStore';
import { IdempotencyKeyFactory } from '../infrastructure/ai/IdempotencyKeyFactory';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../infrastructure/storage/SessionStore';
import { resolveFarmIdFromSyncState, resolveKnownFarmId } from '../infrastructure/sync/SyncContext';

/**
 * spec: pre-launch-repair L2b (L2a review leftover; D-19 "never first-farm fallback") — the farm a sale slip is
 * read under: the farm of the harvest's own plot, else the farm the app is working on if this phone holds it
 * (`resolveKnownFarmId`, the bill sheet's and the log path's rule). It used to be the FIRST farm of the last
 * download (then the first cached day ledger's), so a farmer with two farms had his slip read under the wrong
 * one. No farm known = not read, said plainly below — never a guessed farm.
 */
async function resolvePattiFarmId(plotId?: string): Promise<string | undefined> {
    const fromPlot = await resolveFarmIdFromSyncState(plotId).catch(() => null);
    if (fromPlot) {
        return fromPlot;
    }
    return (await resolveKnownFarmId(SessionStore.getCurrentFarmId()).catch(() => null)) ?? undefined;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const normalized = base64.includes(',') ? base64.split(',')[1] : base64;
    let binaryString: string;
    try {
        binaryString = atob(normalized);
    } catch {
        throw new Error('Invalid base64 image data');
    }
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

export const processPattiImage = async (
    imageData: string,
    mimeType: string,
    cropName: string,
    /** The harvest's plot — its farm is the farm the slip is read under. */
    plotId?: string,
): Promise<Record<string, unknown>> => {
    const farmId = await resolvePattiFarmId(plotId);
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

