// CEI Phase 2 test-stack record types, extracted from DexieDatabase.ts to keep
// that file under the 800-line mobile-web size budget (Sub-plan 04 §DoD). Pure
// type move — no behavior change. DexieDatabase re-exports these so existing
// `import { DexieTestInstance } from '.../DexieDatabase'` call sites keep working.

/** Mirrors ShramSafal.Domain.Tests.TestProtocolKind (numeric for index friendliness). */
export interface DexieTestProtocol {
    id: string;
    name: string;
    cropType: string;
    kind: number;
    periodicity: number;
    everyNDays?: number;
    stageNames: string[];
    parameterCodes: string[];
    createdByUserId: string;
    createdAtUtc: string;
}

export interface DexieTestResult {
    parameterCode: string;
    parameterValue: string;
    unit: string;
    referenceRangeLow?: number;
    referenceRangeHigh?: number;
}

export interface DexieTestInstance {
    id: string;
    testProtocolId: string;
    cropCycleId: string;
    farmId: string;
    plotId: string;
    stageName: string;
    /** ISO date "YYYY-MM-DD" */
    plannedDueDate: string;
    /** 0=Due, 1=Collected, 2=Reported, 3=Overdue, 4=Waived */
    status: number;
    collectedByUserId?: string;
    collectedAtUtc?: string;
    reportedByUserId?: string;
    reportedAtUtc?: string;
    waivedReason?: string;
    attachmentIds: string[];
    results: DexieTestResult[];
    protocolKind: number;
    modifiedAtUtc: string;
    createdAtUtc: string;
    /** Denormalized for list rendering */
    testProtocolName?: string;
}

export interface DexieTestRecommendation {
    id: string;
    testInstanceId: string;
    ruleCode: string;
    titleEn: string;
    titleMr: string;
    suggestedActivityName: string;
    suggestedOffsetDays: number;
    createdAtUtc: string;
}
