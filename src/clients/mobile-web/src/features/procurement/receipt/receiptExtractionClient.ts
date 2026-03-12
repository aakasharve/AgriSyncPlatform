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

function hasMeaningfulReceiptExtraction(result: ReceiptExtractionResponse): boolean {
    return result.lineItems.length > 0 ||
        (result.grandTotal ?? 0) > 0 ||
        (result.subtotal ?? 0) > 0 ||
        Boolean(result.vendorName);
}

// ─── Session-based progressive extraction ────────────────────────────────────

/** Status reported by the background verification poller. */
export type VerificationStatus = 'pending' | 'verifying' | 'verified' | 'needs_review' | 'failed';

/** Callback fired when verification completes or updates a field. */
export interface VerificationUpdate {
    status: VerificationStatus;
    /** Updated extraction when verification produces a different/better result. */
    updated?: Partial<ReceiptExtractionResponse>;
}

/** Starts background verification polling. Returns cleanup function. */
function startVerificationPoller(
    sessionId: string,
    draftExtraction: ReceiptExtractionResponse,
    onUpdate: (update: VerificationUpdate) => void,
): () => void {
    const POLL_INTERVAL_MS = 5_000;
    const MAX_POLLS = 12; // 60 s max

    let stopped = false;
    let pollCount = 0;

    const poll = async () => {
        if (stopped) return;

        try {
            const session = await agriSyncClient.getExtractionSession(sessionId);
            const status = (session.status ?? '').toLowerCase();

            if (status === 'verifying' || status === 'draftready') {
                // Still in progress — schedule next poll
                onUpdate({ status: 'verifying' });
                scheduleNext();
                return;
            }

            if (status === 'verified' && session.verifiedResult != null) {
                const verifiedExtraction = mapReceiptResponse(
                    session.verifiedResult as Record<string, unknown>,
                    draftExtraction.date || getDateKey(),
                );
                // Only emit update if meaningful fields changed
                const updated = buildPartialUpdate(draftExtraction, verifiedExtraction);
                onUpdate({ status: 'verified', updated });
                return;
            }

            if (status === 'needsreview' || status === 'needs_review') {
                onUpdate({ status: 'needs_review' });
                return;
            }

            // Completed or unrecognised — stop polling
            onUpdate({ status: 'failed' });
        } catch {
            onUpdate({ status: 'failed' });
        }
    };

    const scheduleNext = () => {
        if (stopped || pollCount >= MAX_POLLS) {
            if (!stopped) onUpdate({ status: 'failed' });
            return;
        }
        pollCount++;
        setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    // Initial delay before first poll — give the server a moment to start processing
    setTimeout(() => void poll(), POLL_INTERVAL_MS);

    return () => { stopped = true; };
}

/** Returns only the fields that genuinely differ between draft and verified. */
function buildPartialUpdate(
    draft: ReceiptExtractionResponse,
    verified: ReceiptExtractionResponse,
): Partial<ReceiptExtractionResponse> {
    const update: Partial<ReceiptExtractionResponse> = {};

    if (verified.grandTotal !== 0 && Math.abs((verified.grandTotal ?? 0) - (draft.grandTotal ?? 0)) > 0.01) {
        update.grandTotal = verified.grandTotal;
    }
    if (verified.vendorName && verified.vendorName !== draft.vendorName) {
        update.vendorName = verified.vendorName;
    }
    if (verified.confidence > draft.confidence) {
        update.confidence = verified.confidence;
    }
    if (verified.lineItems.length > 0 && verified.lineItems.length !== draft.lineItems.length) {
        update.lineItems = verified.lineItems;
    }

    return update;
}

/**
 * Session-based receipt extraction — progressive two-lane.
 *
 * 1. Posts image to /document-sessions/receipt → server returns draft immediately
 * 2. Returns the draft ReceiptExtractionResponse to the caller (fast path, ~3s)
 * 3. Starts a background verification poller; fires `onVerification` when done
 *
 * Falls back to the legacy `extractReceiptData` if session creation fails.
 */
export const extractReceiptWithSession = async (
    imageBase64: string,
    onVerification: (update: VerificationUpdate) => void,
): Promise<ReceiptExtractionResponse> => {
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

    if (!navigator.onLine) {
        // Offline — fall back to legacy path which queues to pendingAiJobs
        return extractReceiptData(imageBase64);
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
        versionTag: 'ocr-receipt-v3',
    });

    try {
        const sessionResponse = await agriSyncClient.createReceiptSession(
            farmId,
            blob,
            mimeType,
            keyMaterial.idempotencyKey,
        );

        const draftExtraction = mapReceiptResponse(
            ensureRecord(sessionResponse.draft.normalizedJson),
            getDateKey(),
        );

        // Boost confidence from the API response (0-1 scale from backend)
        if (typeof sessionResponse.draft.overallConfidence === 'number') {
            draftExtraction.confidence = normalizeConfidence(sessionResponse.draft.overallConfidence);
        }

        if (!hasMeaningfulReceiptExtraction(draftExtraction)) {
            throw new Error('Session OCR returned no usable receipt fields.');
        }

        // Background: start verification poller
        startVerificationPoller(sessionResponse.sessionId, draftExtraction, onVerification);

        return draftExtraction;
    } catch {
        // Session API failed — fall back to legacy direct extraction
        const fallback = await extractReceiptData(imageBase64);
        if (!hasMeaningfulReceiptExtraction(fallback)) {
            throw new Error('Receipt OCR returned no usable data.');
        }

        return fallback;
    }
};

// ─── Legacy direct extraction ─────────────────────────────────────────────────

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
        versionTag: 'ocr-receipt-v3',
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
