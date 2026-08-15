/**
 * What a producer can SAY about which way the money moved.
 *
 * Deliberately only two members. A capture surface always knows — the farmer
 * is either recording a sale or a spend — so there is nothing here for it to
 * hedge with.
 */
export type MoneyEventType = 'Expense' | 'Income';

/**
 * What a money event can BE, once read back.
 *
 * `'Unknown'` is a read-side state and only a read-side state: it is what a
 * cost entry that reached the server before `direction` existed comes back as.
 * Those rows are not all expenses — the client used to push income down the
 * expense wire, which is the defect the field closes — so resolving them to
 * `'Expense'` to keep a total tidy would re-create it here (`P4`).
 *
 * Consequence, stated rather than hidden: an `'Unknown'` row is counted in
 * NEITHER the income total nor the expense total, because it belongs to
 * neither. It is still listed, with its amount, and is still the farmer's
 * record — what is missing is a claim nobody ever made.
 */
export type MoneyEventDirection = MoneyEventType | 'Unknown';

export type MoneyCategory =
    | 'Labour'
    | 'Input'
    | 'Machinery'
    | 'Transport'
    | 'Repair'
    | 'Fuel'
    | 'Electricity'
    | 'Other';

export type MoneySourceType =
    | 'Manual'
    | 'VoiceLog'
    | 'Procurement'
    | 'Income'
    | 'ScheduleAuto'
    | 'Adjustment';

export type MoneyTrustStatus = 'Unverified' | 'Verified' | 'Adjusted';
export type MoneyReviewStatus = 'OK' | 'NeedsReview';
export type MoneyPriceSource = 'PriceBook' | 'Manual' | 'Unknown';

export interface MoneyEvent {
    id: string;
    farmId: string;
    plotId?: string;
    cropId?: string;
    dateTime: string;
    /**
     * `'Unknown'` only ever arrives from the server for a row written before
     * the wire could carry a direction. Nothing this client creates is Unknown:
     * `createMoneyEventFromSource` takes a `MoneyEventType`.
     */
    type: MoneyEventDirection;
    category: MoneyCategory;
    amount: number;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    paymentMode?: 'Cash' | 'UPI' | 'Bank' | 'Credit';
    vendorName?: string;
    sourceType: MoneySourceType;
    sourceId: string;
    createdByUserId: string;
    verifiedByUserId?: string;
    trustStatus: MoneyTrustStatus;
    reviewStatus: MoneyReviewStatus;
    reviewReasons?: string[];
    priceSource: MoneyPriceSource;
    notes?: string;
    attachments?: string[];
    createdAt: string;
    updatedAt?: string;
    /** CEI Phase 4 §4.8 — set when this cost entry was created by a job card settlement */
    jobCardId?: string;
}

export interface PriceBookItem {
    id: string;
    name: string;
    category: MoneyCategory;
    defaultUnit: string;
    defaultUnitPrice: number;
    vendorDefaults?: string[];
    effectiveFrom: string;
    isActive: boolean;
}

export interface MoneyAdjustment {
    id: string;
    adjustsMoneyEventId: string;
    deltaAmount?: number;
    correctedFields?: Partial<Pick<MoneyEvent, 'amount' | 'category' | 'plotId' | 'cropId' | 'notes'>>;
    reason: string;
    correctedByUserId: string;
    correctedAt: string;
}

export interface FinanceSettings {
    highAmountThreshold: number;
    duplicateWindowMinutes: number;
    gstEnabled: boolean;
}

export interface FinanceFilters {
    fromDate?: string;
    toDate?: string;
    plotId?: string;
    cropId?: string;
    sourceType?: MoneySourceType;
    sourceId?: string;
    reviewStatus?: MoneyReviewStatus;
    trustStatus?: MoneyTrustStatus;
    type?: MoneyEventType;
}

export interface EffectiveMoneyEvent extends MoneyEvent {
    effectiveAmount: number;
    adjustments: MoneyAdjustment[];
}

export interface MoneySourcePayload {
    type: MoneySourceType;
    sourceId: string;
    dateTime: string;
    eventType: MoneyEventType;
    category: MoneyCategory;
    farmId?: string;
    plotId?: string;
    cropId?: string;
    amount?: number;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    paymentMode?: 'Cash' | 'UPI' | 'Bank' | 'Credit';
    vendorName?: string;
    notes?: string;
    attachments?: string[];
    createdByUserId?: string;
    location?: import('../../infrastructure/api/AgriSyncClient').LocationDto | null;
}

export interface FinancePipelineBucket {
    key: 'Captured' | 'NeedsReview' | 'Approved' | 'Adjusted';
    count: number;
    total: number;
    topIssue: string;
}
