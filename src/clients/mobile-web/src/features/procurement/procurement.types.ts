// ============================================
// PROCUREMENT & EXPENSE TYPES
// ============================================

// Expense scope - WHERE does this expense apply?
export type ExpenseScope =
    | 'PLOT'      // Specific to one plot (e.g., fertilizer for Plot A)
    | 'CROP'      // Applies to entire crop (e.g., spray for all Grape plots)
    | 'FARM'      // General farm expense (e.g., electricity, equipment repair)
    | 'UNKNOWN';  // AI couldn't determine, user must classify

// Expense category - WHAT type of expense?
export type ExpenseCategory =
    | 'FERTILIZER'
    | 'PESTICIDE'
    | 'FUNGICIDE'
    | 'SEEDS_PLANTS'
    | 'IRRIGATION'
    | 'LABOUR'
    | 'MACHINERY_RENTAL'
    | 'FUEL'
    | 'TRANSPORT'
    | 'PACKAGING'
    | 'ELECTRICITY'
    | 'EQUIPMENT_REPAIR'
    | 'MISC';

// Individual line item from receipt
export interface ExpenseLineItem {
    id: string;
    name: string;                    // Product/service name
    quantity?: number;
    unit?: string;                   // kg, L, bags, hours, etc.
    unitPrice?: number;
    totalAmount: number;
    category: ExpenseCategory;

    // AI extraction metadata
    aiConfidence?: number;           // 0-100
    rawTextExtracted?: string;       // Original text AI read
}

// Main expense record
export interface ProcurementExpense {
    id: string;

    // Temporal
    date: string;                    // YYYY-MM-DD (expense date, not upload date)
    createdAt: string;               // ISO timestamp of record creation
    updatedAt?: string;

    // Scope binding
    scope: ExpenseScope;
    plotId?: string;                 // If scope = PLOT
    cropId?: string;                 // If scope = PLOT or CROP

    // Vendor info
    vendorName?: string;
    vendorPhone?: string;
    vendorType?: 'DEALER' | 'SHOP' | 'COOPERATIVE' | 'INDIVIDUAL' | 'UNKNOWN';

    // Financial
    lineItems: ExpenseLineItem[];
    subtotal: number;                // Sum of line items
    discount?: number;
    tax?: number;
    grandTotal: number;              // Final amount paid

    // Payment
    paymentStatus: 'PAID' | 'CREDIT' | 'PARTIAL';
    amountPaid?: number;
    creditDueDate?: string;

    // Evidence
    receiptImageUrl?: string;        // Stored image path
    receiptImageBase64?: string;     // For processing (not stored long-term)
    attachmentIds?: string[];        // Background-uploaded attachment ids

    // AI Processing
    aiExtracted: boolean;            // Was this AI-processed?
    aiRawResponse?: string;          // Full AI response for debugging
    userVerified: boolean;           // User confirmed AI extraction

    // Linkage - CRITICAL for no-duplicate rule
    linkedLogIds?: string[];         // DailyLog IDs that reference this expense

    // Warnings/questions
    warnings?: string[];
    questionsForUser?: string[];

    // Metadata
    notes?: string;
    tags?: string[];
    operatorId?: string;             // Who recorded this
}

// Expense summary for display
export interface ExpenseSummaryByScope {
    plotExpenses: {
        plotId: string;
        plotName: string;
        cropName: string;
        total: number;
        itemCount: number;
    }[];
    cropExpenses: {
        cropId: string;
        cropName: string;
        total: number;
        itemCount: number;
    }[];
    farmExpenses: {
        total: number;
        itemCount: number;
        byCategory: Record<ExpenseCategory, number>;
    };
    grandTotal: number;
}

// AI extraction response structure
export interface ReceiptExtractionResponse {
    success: boolean;
    confidence: number;              // Overall confidence 0-100

    // Extracted data
    vendorName?: string;
    vendorPhone?: string;
    date?: string;

    lineItems: {
        name: string;
        quantity?: number;
        unit?: string;
        unitPrice?: number;
        totalAmount: number;
        suggestedCategory: ExpenseCategory;
        confidence: number;
    }[];

    subtotal?: number;
    discount?: number;
    tax?: number;
    grandTotal?: number;

    suggestedScope?: ExpenseScope;
    suggestedCropName?: string;
}
