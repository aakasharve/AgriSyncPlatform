/**
 * CEI Phase 2 §4.5 — test-instance domain enums.
 *
 * Mirrors `ShramSafal.Domain.Tests.TestInstanceStatus` exactly. The server
 * sends statuses as strings ("Due", "Collected", ...) in API responses, but
 * Dexie stores them as numbers for cheap index filtering.
 */

export const TestInstanceStatus = {
    Due: 0,
    Collected: 1,
    Reported: 2,
    Overdue: 3,
    Waived: 4,
} as const;

export type TestInstanceStatus = typeof TestInstanceStatus[keyof typeof TestInstanceStatus];

/** Map the string form the backend emits → numeric form Dexie indexes. */
export function parseTestInstanceStatus(raw: string): TestInstanceStatus {
    switch (raw) {
        case 'Due': return TestInstanceStatus.Due;
        case 'Collected': return TestInstanceStatus.Collected;
        case 'Reported': return TestInstanceStatus.Reported;
        case 'Overdue': return TestInstanceStatus.Overdue;
        case 'Waived': return TestInstanceStatus.Waived;
        default: return TestInstanceStatus.Due;
    }
}

/** Reverse of {@link parseTestInstanceStatus} — used for UI labels. */
export function testInstanceStatusName(status: TestInstanceStatus): string {
    switch (status) {
        case TestInstanceStatus.Due: return 'Due';
        case TestInstanceStatus.Collected: return 'Collected';
        case TestInstanceStatus.Reported: return 'Reported';
        case TestInstanceStatus.Overdue: return 'Overdue';
        case TestInstanceStatus.Waived: return 'Waived';
        default: return 'Due';
    }
}

/** Kind mirrors ShramSafal.Domain.Tests.TestProtocolKind. */
export const TestProtocolKind = {
    Soil: 0,
    Water: 1,
    Tissue: 2,
    Residue: 3,
    Other: 4,
} as const;

export type TestProtocolKind = typeof TestProtocolKind[keyof typeof TestProtocolKind];
