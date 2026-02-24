import { ReceiptExtractionResponse, ExpenseCategory, ExpenseScope } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getAuthSession } from '../../../infrastructure/api/AuthTokenStore';
import { IdempotencyKeyFactory } from '../../../infrastructure/ai/IdempotencyKeyFactory';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

type UnknownRecord = Record<string, unknown>;

const CATEGORY_SET: ReadonlySet<ExpenseCategory> = new Set<ExpenseCategory>([
    'FERTILIZER',
    'PESTICIDE',
    'FUNGICIDE',
    'SEEDS_PLANTS',
    'IRRIGATION',
    'LABOUR',
    'MACHINERY_RENTAL',
    'FUEL',
    'TRANSPORT',
    'PACKAGING',
    'ELECTRICITY',
    'EQUIPMENT_REPAIR',
    'MISC',
]);

const SCOPE_SET: ReadonlySet<ExpenseScope> = new Set<ExpenseScope>(['PLOT', 'CROP', 'FARM', 'UNKNOWN']);

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

function readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeCategory(value: unknown): ExpenseCategory {
    const raw = readString(value)?.toUpperCase() as ExpenseCategory | undefined;
    return raw && CATEGORY_SET.has(raw) ? raw : 'MISC';
}

function normalizeScope(value: unknown): ExpenseScope {
    const raw = readString(value)?.toUpperCase() as ExpenseScope | undefined;
    return raw && SCOPE_SET.has(raw) ? raw : 'UNKNOWN';
}

function normalizeConfidence(value: unknown): number {
    const numeric = readNumber(value);
    if (numeric === undefined) {
        return 0;
    }

    const scaled = numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(0, Math.min(100, Math.round(scaled * 100) / 100));
}

function extractMimeType(base64: string): string {
    if (!base64.startsWith('data:')) {
        return 'image/jpeg';
    }

    const semicolonIndex = base64.indexOf(';');
    if (semicolonIndex <= 5) {
        return 'image/jpeg';
    }

    return base64.slice(5, semicolonIndex) || 'image/jpeg';
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

function ensureRecord(value: unknown): UnknownRecord {
    return (value && typeof value === 'object' && !Array.isArray(value))
        ? value as UnknownRecord
        : {};
}

function mapLineItems(payload: UnknownRecord): ReceiptExtractionResponse['lineItems'] {
    const source = Array.isArray(payload.lineItems)
        ? payload.lineItems
        : (Array.isArray(payload.items) ? payload.items : []);

    return source
        .map(item => ensureRecord(item))
        .map(item => {
            const quantity = readNumber(item.quantity);
            const unitPrice = readNumber(item.unitPrice);
            const totalAmount = readNumber(item.totalAmount)
                ?? (quantity !== undefined && unitPrice !== undefined ? quantity * unitPrice : 0);

            return {
                name: readString(item.name) ?? 'Unknown item',
                quantity,
                unit: readString(item.unit),
                unitPrice,
                totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
                suggestedCategory: normalizeCategory(item.suggestedCategory),
                confidence: normalizeConfidence(item.confidence),
            };
        });
}

function mapReceiptResponse(apiResponse: UnknownRecord, fallbackDate: string): ReceiptExtractionResponse {
    const normalizedPayload = ensureRecord(apiResponse.normalizedJson);
    const payload = Object.keys(normalizedPayload).length > 0 ? normalizedPayload : apiResponse;
    const lineItems = mapLineItems(payload);
    const subtotal = readNumber(payload.subtotal) ?? lineItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    const discount = readNumber(payload.discount) ?? 0;
    const tax = readNumber(payload.tax) ?? 0;
    const grandTotal = readNumber(payload.grandTotal) ?? (subtotal - discount + tax);

    return {
        success: Boolean(payload.success ?? apiResponse.success ?? true),
        confidence: normalizeConfidence(payload.confidence ?? apiResponse.overallConfidence ?? apiResponse.confidence),
        vendorName: readString(payload.vendorName),
        vendorPhone: readString(payload.vendorPhone),
        date: readString(payload.date) ?? fallbackDate,
        lineItems,
        subtotal,
        discount,
        tax,
        grandTotal,
        suggestedScope: normalizeScope(payload.suggestedScope),
        suggestedCropName: readString(payload.suggestedCropName),
    };
}

/**
 * Backend-driven receipt extraction client.
 * When offline, request is persisted in pendingAiJobs and processed by BackgroundSyncWorker.
 */
export const extractReceiptData = async (imageBase64: string): Promise<ReceiptExtractionResponse> => {
    const farmId = await resolveFarmIdFromCache();
    if (!farmId) {
        return {
            success: false,
            confidence: 0,
            date: getDateKey(),
            lineItems: [],
            subtotal: 0,
            grandTotal: 0,
            suggestedScope: 'UNKNOWN',
        };
    }

    const mimeType = extractMimeType(imageBase64);
    const blob = base64ToBlob(imageBase64, mimeType);
    const userId = getAuthSession()?.userId ?? 'unknown-user';
    const requestPayloadHash = await IdempotencyKeyFactory.hashBlob(blob);
    const keyMaterial = await IdempotencyKeyFactory.buildOperationKey({
        userId,
        farmId,
        operation: 'receipt',
        contentHash: requestPayloadHash,
    });
    const idempotencyKey = keyMaterial.idempotencyKey;

    if (!navigator.onLine) {
        const nowIso = new Date().toISOString();
        const db = getDatabase();
        await db.pendingAiJobs.add({
            operationType: 'receipt_extract',
            inputBlob: blob,
            inputMimeType: mimeType,
            context: {
                farmId,
                userId,
                operation: 'receipt',
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
            date: getDateKey(),
            lineItems: [],
            subtotal: 0,
            grandTotal: 0,
            suggestedScope: 'UNKNOWN',
        };
    }

    try {
        const response = await agriSyncClient.extractReceipt(blob, mimeType, farmId, idempotencyKey);
        return mapReceiptResponse(ensureRecord(response), getDateKey());
    } catch (_error) {
        return {
            success: false,
            confidence: 0,
            date: getDateKey(),
            lineItems: [],
            subtotal: 0,
            grandTotal: 0,
            suggestedScope: 'UNKNOWN',
        };
    }
};
