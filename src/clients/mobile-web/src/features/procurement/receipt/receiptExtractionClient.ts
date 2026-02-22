import { ReceiptExtractionResponse } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';

/**
 * Thin-client fallback.
 * Receipt OCR/extraction must run server-side; frontend only returns
 * a safe placeholder so user can continue with manual confirmation.
 */
export const extractReceiptData = async (_imageBase64: string): Promise<ReceiptExtractionResponse> => {
    return {
        success: false,
        confidence: 0,
        date: getDateKey(),
        lineItems: [],
        subtotal: 0,
        grandTotal: 0,
        suggestedScope: 'UNKNOWN',
    };
};

