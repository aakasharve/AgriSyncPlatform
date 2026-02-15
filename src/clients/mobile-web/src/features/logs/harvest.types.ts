export type HarvestPattern = 'SINGLE' | 'MULTIPLE';

export interface HarvestUnit {
    type: 'WEIGHT' | 'COUNT' | 'CONTAINER';

    // For WEIGHT
    weightUnit?: 'KG' | 'QUINTAL' | 'TON';

    // For CONTAINER
    containerName?: string;             // "Crate", "Bag", "Carret", "पेटी"
    containerSizeKg?: number;           // 10kg crate, 50kg bag

    // For COUNT
    countUnit?: string;                 // "pieces", "bunches"
}

export interface HarvestConfig {
    plotId: string;
    pattern: HarvestPattern;
    configuredAt: string;

    // For MULTIPLE harvest
    expectedPickings?: number;          // Estimated total pickings
    typicalIntervalDays?: number;       // Days between harvests

    // Unit configuration
    primaryUnit: HarvestUnit;
    secondaryUnit?: HarvestUnit;        // Alternative unit
}

export interface ProduceGrade {
    id: string;
    name: string;                       // "Grade 1", "A", "Premium"
    localName?: string;                 // "पहिला नंबर", "माल"
    description?: string;               // "Large, glossy, no blemishes"
    colorCode: string;                  // For UI display
    sortOrder: number;                  // 1 = best grade
}

export const DEFAULT_PRODUCE_GRADES: ProduceGrade[] = [
    { id: 'g1', name: 'Grade 1', localName: 'पहिला नंबर', description: 'Premium quality', colorCode: '#10B981', sortOrder: 1 },
    { id: 'g2', name: 'Grade 2', localName: 'दुसरा नंबर', description: 'Good quality', colorCode: '#3B82F6', sortOrder: 2 },
    { id: 'g3', name: 'Grade 3', localName: 'तिसरा नंबर', description: 'Average quality', colorCode: '#F59E0B', sortOrder: 3 },
    { id: 'g4', name: 'Grade 4', localName: 'चौथा नंबर', description: 'Low quality/rejected', colorCode: '#EF4444', sortOrder: 4 },
];

export interface HarvestDayEntry {
    id: string;
    date: string;

    // Quantity harvested
    quantity: number;
    unit: HarvestUnit;

    // Grade-wise breakdown (estimated at harvest time)
    gradeEstimates?: {
        gradeId: string;
        estimatedQuantity: number;
        estimatedPercentage: number;
    }[];

    // Labour involved
    labourCount?: number;
    labourCost?: number;

    // Link to daily log
    linkedLogId?: string;
    linkedActivityId?: string;          // CropActivityEvent ID

    notes?: string;
}

export interface SaleEntry {
    id: string;
    date: string;                       // Sale/receipt date

    // Grade-wise actual sale
    gradeWiseSales: {
        gradeId: string;
        gradeName: string;
        quantity: number;
        unit: string;
        pricePerUnit: number;
        totalAmount: number;
    }[];

    // Totals
    totalQuantity: number;
    totalAmount: number;

    // Deductions
    commissionAmount?: number;
    transportDeduction?: number;
    hamaliDeduction?: number; // Porter/Labor
    bharaiDeduction?: number; // Filling charges
    tolaiDeduction?: number; // Weighing
    motorFeeDeduction?: number; // Market fee
    otherDeductions?: number;
    netAmount: number;

    // Receipt details
    pattiNumber?: string;
    pattiImageUrl?: string;

    // AI extraction metadata
    aiExtracted: boolean;
    userVerified: boolean;
}

export interface GradeWiseSummary {
    gradeId: string;
    gradeName: string;
    quantity: number;
    percentage: number;                 // Of total harvest
    pricePerUnit: number;
    totalAmount: number;
    averagePrice: number;
}

export interface HarvestSession {
    id: string;
    plotId: string;
    cropId: string;

    // Harvest pattern context
    pattern: HarvestPattern;
    pickingNumber?: number;             // For MULTIPLE: 1st, 2nd, 3rd picking

    // Temporal (harvest can span days)
    startDate: string;                  // First day of this harvest
    endDate?: string;                   // Last day (null if ongoing)
    status: 'IN_PROGRESS' | 'HARVESTED' | 'SOLD' | 'COMPLETED';

    // What was harvested (SEND side)
    harvestEntries: HarvestDayEntry[];
    totalQuantitySent: number;
    totalUnitsSent: number;             // e.g., 50 crates
    unit: HarvestUnit;

    // What was sold (RECEIVE side - from पट्टी)
    saleEntries: SaleEntry[];
    totalQuantityReceived?: number;     // May differ from sent (loss/damage)

    // Reconciliation
    quantityDifference?: number;        // Sent - Received (loss indicator)
    differenceReason?: 'TRANSIT_LOSS' | 'QUALITY_REJECTION' | 'WEIGHT_DIFFERENCE' | 'THEFT' | 'OTHER';
    differenceNote?: string;

    // Financial summary
    totalIncome: number;
    averagePricePerKg?: number;
    gradeWiseBreakdown: GradeWiseSummary[];

    // Receipt/पट्टी
    pattiStatus: 'PENDING' | 'PARTIAL' | 'RECEIVED';
    pattiImageUrl?: string;
    pattiReceivedDate?: string;

    // Payment tracking
    paymentStatus: 'PENDING' | 'PARTIAL' | 'RECEIVED';
    amountReceived: number;
    amountPending: number;
    paymentDueDate?: string;

    // Metadata
    buyerName?: string;
    buyerPhone?: string;
    marketName?: string;                // "APMC Nashik", "Local Mandi"
    vehicleNumber?: string;

    // Link to daily logs
    linkedLogIds: string[];             // Logs where harvesting activity was recorded

    createdAt: string;
    updatedAt?: string;
}

export interface OtherIncomeEntry {
    id: string;
    plotId?: string;
    cropId?: string;
    date: string;

    source: 'RESIDUE' | 'BYPRODUCT' | 'PLANT_SALE' | 'OTHER';
    description: string;
    quantity?: number;
    unit?: string;

    amount: number;
    buyerName?: string;

    receiptImageUrl?: string;
    notes?: string;
}

export interface PendingHarvestItem {
    type: 'PATTI_PENDING' | 'PAYMENT_PENDING' | 'HARVEST_INCOMPLETE';
    sessionId: string;
    plotName: string;
    cropName: string;
    daysPending: number;
    amount?: number;
    buyerName?: string;
    buyerPhone?: string;
}
