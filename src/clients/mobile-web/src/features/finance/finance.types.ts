export type MoneyEventType = 'Expense' | 'Income';

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
    type: MoneyEventType;
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
