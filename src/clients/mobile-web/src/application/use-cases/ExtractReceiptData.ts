import { agriSyncClient, type OcrExtractionResultDto } from '../../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

const OCR_QUEUE_PREFIX = 'ocr_queue:';
const OCR_RESULT_PREFIX = 'ocr_result:';

export interface ExtractReceiptDataInput {
    attachmentId: string;
    waitTimeoutMs?: number;
}

export interface ExtractedFieldDraft {
    value: string;
    confidence: number;
}

export interface ExtractReceiptDataResult {
    status: 'completed' | 'queued_offline';
    extraction?: OcrExtractionResultDto;
    fields: Record<string, ExtractedFieldDraft>;
    message?: string;
}

function toFieldMap(extraction: OcrExtractionResultDto): Record<string, ExtractedFieldDraft> {
    const result: Record<string, ExtractedFieldDraft> = {};
    for (const field of extraction.fields ?? []) {
        const key = (field.fieldName ?? '').trim();
        if (!key) {
            continue;
        }

        result[key] = {
            value: field.value ?? '',
            confidence: Number.isFinite(field.confidence) ? field.confidence : 0,
        };
    }

    return result;
}

async function waitForServerAttachmentId(attachmentId: string, timeoutMs: number): Promise<string> {
    const db = getDatabase();
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const attachment = await db.attachments.get(attachmentId);
        if (attachment?.serverAttachmentId) {
            return attachment.serverAttachmentId;
        }

        const queueItems = await db.uploadQueue
            .where('attachmentId')
            .equals(attachmentId)
            .toArray();

        const hasFailed = queueItems.some(item => item.status === 'failed' && item.retryCount >= 5);
        if (hasFailed) {
            throw new Error('Attachment upload failed repeatedly. Retry upload before OCR.');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Timed out waiting for attachment upload to complete.');
}

export async function extractReceiptData(input: ExtractReceiptDataInput): Promise<ExtractReceiptDataResult> {
    if (!input.attachmentId || input.attachmentId.trim().length === 0) {
        throw new Error('attachmentId is required.');
    }

    const attachmentId = input.attachmentId.trim();
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    const attachment = await db.attachments.get(attachmentId);
    if (!attachment) {
        throw new Error(`Attachment '${attachmentId}' not found in local storage.`);
    }

    if (!navigator.onLine) {
        await db.appMeta.put({
            key: `${OCR_QUEUE_PREFIX}${attachmentId}`,
            value: { attachmentId, queuedAt: nowIso, reason: 'offline' },
            updatedAt: nowIso,
        });

        return {
            status: 'queued_offline',
            fields: {},
            message: 'Will extract when online.',
        };
    }

    const serverAttachmentId = attachment.serverAttachmentId
        ?? await waitForServerAttachmentId(attachmentId, input.waitTimeoutMs ?? 120000);

    const extraction = await agriSyncClient.extractAttachmentReceipt(serverAttachmentId);
    const fields = toFieldMap(extraction);

    await db.appMeta.put({
        key: `${OCR_RESULT_PREFIX}${attachmentId}`,
        value: extraction,
        updatedAt: new Date().toISOString(),
    });

    return {
        status: 'completed',
        extraction,
        fields,
    };
}
