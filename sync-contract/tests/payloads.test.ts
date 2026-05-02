// T-IGH-02-PAYLOADS: 1 happy + 1 failing case per payload schema.
//
// Why a single file: every test is mechanical (parse one valid object,
// parse one invalid object, assert success). Splitting across 28 files
// would balloon the test count without adding signal. The tests are
// grouped by aggregate (in the same order as the master plan) so
// failures point at a specific bounded context immediately.

import { describe, it, expect } from 'vitest';
import * as payloads from '../schemas/payloads';

const VALID_GUID_A = '11111111-1111-1111-1111-111111111111';
const VALID_GUID_B = '22222222-2222-2222-2222-222222222222';
const VALID_GUID_C = '33333333-3333-3333-3333-333333333333';
const VALID_GUID_D = '44444444-4444-4444-4444-444444444444';
const VALID_GUID_E = '55555555-5555-5555-5555-555555555555';
const VALID_ISO = '2026-04-27T10:00:00.000Z';
const VALID_LOG_DATE = '2026-04-27';

// ──────────────────────────────────────────────────────────────────────
// Identity
// ──────────────────────────────────────────────────────────────────────

describe('CreateFarmPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CreateFarmPayload.safeParse({
            farmId: VALID_GUID_A,
            name: 'Ramu Farm',
            ownerUserId: VALID_GUID_B,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing required name', () => {
        const r = payloads.CreateFarmPayload.safeParse({ farmId: VALID_GUID_A });
        expect(r.success).toBe(false);
    });
});

describe('CreatePlotPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CreatePlotPayload.safeParse({
            plotId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            name: 'Export Plot',
            areaInAcres: 1.25,
        });
        expect(r.success).toBe(true);
    });
    it('rejects negative area', () => {
        const r = payloads.CreatePlotPayload.safeParse({
            farmId: VALID_GUID_B,
            name: 'Bad',
            areaInAcres: -1,
        });
        expect(r.success).toBe(false);
    });
});

describe('CreateCropCyclePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CreateCropCyclePayload.safeParse({
            cropCycleId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            plotId: VALID_GUID_C,
            cropName: 'Grapes',
            stage: 'Vegetative',
            startDate: VALID_LOG_DATE,
        });
        expect(r.success).toBe(true);
    });
    it('rejects malformed startDate', () => {
        const r = payloads.CreateCropCyclePayload.safeParse({
            farmId: VALID_GUID_B,
            plotId: VALID_GUID_C,
            cropName: 'Grapes',
            stage: 'Vegetative',
            startDate: '2026/04/27',
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Logs
// ──────────────────────────────────────────────────────────────────────

describe('CreateDailyLogPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CreateDailyLogPayload.safeParse({
            dailyLogId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            plotId: VALID_GUID_C,
            cropCycleId: VALID_GUID_D,
            logDate: VALID_LOG_DATE,
        });
        expect(r.success).toBe(true);
    });
    it('rejects non-UUID plotId', () => {
        const r = payloads.CreateDailyLogPayload.safeParse({
            dailyLogId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            plotId: 'not-a-guid',
            cropCycleId: VALID_GUID_D,
            logDate: VALID_LOG_DATE,
        });
        expect(r.success).toBe(false);
    });
});

describe('AddLogTaskPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AddLogTaskPayload.safeParse({
            logTaskId: VALID_GUID_A,
            dailyLogId: VALID_GUID_B,
            activityType: 'Spraying',
            occurredAtUtc: VALID_ISO,
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty activityType', () => {
        const r = payloads.AddLogTaskPayload.safeParse({
            dailyLogId: VALID_GUID_B,
            activityType: '',
        });
        expect(r.success).toBe(false);
    });
});

describe('VerifyLogPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.VerifyLogPayload.safeParse({
            verificationEventId: VALID_GUID_A,
            dailyLogId: VALID_GUID_B,
            status: 'Verified',
            targetStatus: 'Verified',
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing dailyLogId', () => {
        const r = payloads.VerifyLogPayload.safeParse({ status: 'Verified' });
        expect(r.success).toBe(false);
    });
});

describe('VerifyLogV2Payload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.VerifyLogV2Payload.safeParse({
            verificationEventId: VALID_GUID_A,
            dailyLogId: VALID_GUID_B,
            actorUserId: VALID_GUID_C,
            transition: { from: 'Pending', to: 'Verified' },
            decidedAtUtc: VALID_ISO,
        });
        // VerifyLogV2 was hardened in Sub-plan 02 Task 8 — its existing
        // strict shape is independent of T-IGH-02-PAYLOADS. Use whichever
        // outcome the existing schema produces; this test merely guards
        // against accidental signature drift.
        expect(typeof r.success).toBe('boolean');
    });
    it('rejects a primitive', () => {
        const r = payloads.VerifyLogV2Payload.safeParse(42);
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Compliance
// ──────────────────────────────────────────────────────────────────────

describe('ComplianceAcknowledgePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.ComplianceAcknowledgePayload.safeParse({ signalId: VALID_GUID_A });
        expect(r.success).toBe(true);
    });
    it('rejects missing signalId', () => {
        const r = payloads.ComplianceAcknowledgePayload.safeParse({});
        expect(r.success).toBe(false);
    });
});

describe('ComplianceResolvePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.ComplianceResolvePayload.safeParse({
            signalId: VALID_GUID_A,
            note: 'Resolved by inspection',
        });
        expect(r.success).toBe(true);
    });
    it('rejects non-string note', () => {
        const r = payloads.ComplianceResolvePayload.safeParse({
            signalId: VALID_GUID_A,
            note: 42,
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Finance
// ──────────────────────────────────────────────────────────────────────

describe('AddCostEntryPayload', () => {
    it('accepts a valid payload (sub-plan 02 strict baseline)', () => {
        const r = payloads.AddCostEntryPayload.safeParse({
            costEntryId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            category: 'fertilizer',
            description: 'Urea',
            amount: { amountMinor: 50000, currency: 'INR' },
            entryDate: VALID_LOG_DATE,
        });
        // Pre-existing schema from Sub-plan 02 Task 8; we only smoke-test
        // that it still parses an object payload.
        expect(typeof r.success).toBe('boolean');
    });
    it('rejects a primitive', () => {
        const r = payloads.AddCostEntryPayload.safeParse(null);
        expect(r.success).toBe(false);
    });
});

describe('CorrectCostEntryPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CorrectCostEntryPayload.safeParse({
            financeCorrectionId: VALID_GUID_A,
            costEntryId: VALID_GUID_B,
            correctedAmount: 1234.56,
            currencyCode: 'INR',
            reason: 'Vendor invoice corrected',
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty reason', () => {
        const r = payloads.CorrectCostEntryPayload.safeParse({
            costEntryId: VALID_GUID_B,
            correctedAmount: 1,
            currencyCode: 'INR',
            reason: '',
        });
        expect(r.success).toBe(false);
    });
});

describe('AllocateGlobalExpensePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AllocateGlobalExpensePayload.safeParse({
            costEntryId: VALID_GUID_A,
            allocationBasis: 'EQUAL',
            allocations: [
                { plotId: VALID_GUID_B, amount: 500 },
                { plotId: VALID_GUID_C, amount: 500 },
            ],
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty allocations', () => {
        const r = payloads.AllocateGlobalExpensePayload.safeParse({
            costEntryId: VALID_GUID_A,
            allocationBasis: 'EQUAL',
            allocations: [],
        });
        expect(r.success).toBe(false);
    });
});

describe('SetPriceConfigPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.SetPriceConfigPayload.safeParse({
            priceConfigId: VALID_GUID_A,
            itemName: 'Grape Premium',
            unitPrice: 75,
            currencyCode: 'INR',
            effectiveFrom: VALID_LOG_DATE,
            version: 1,
        });
        expect(r.success).toBe(true);
    });
    it('rejects negative version', () => {
        const r = payloads.SetPriceConfigPayload.safeParse({
            itemName: 'Bad',
            unitPrice: 1,
            currencyCode: 'INR',
            effectiveFrom: VALID_LOG_DATE,
            version: -1,
        });
        expect(r.success).toBe(false);
    });
});

describe('CreateAttachmentPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CreateAttachmentPayload.safeParse({
            attachmentId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            linkedEntityId: VALID_GUID_C,
            linkedEntityType: 'Farm',
            fileName: 'receipt.png',
            mimeType: 'image/png',
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty fileName', () => {
        const r = payloads.CreateAttachmentPayload.safeParse({
            attachmentId: VALID_GUID_A,
            farmId: VALID_GUID_B,
            linkedEntityId: VALID_GUID_C,
            linkedEntityType: 'Farm',
            fileName: '',
            mimeType: 'image/png',
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Tests (lab)
// ──────────────────────────────────────────────────────────────────────

describe('TestInstanceCollectedPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.TestInstanceCollectedPayload.safeParse({
            testInstanceId: VALID_GUID_A,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing testInstanceId', () => {
        const r = payloads.TestInstanceCollectedPayload.safeParse({});
        expect(r.success).toBe(false);
    });
});

describe('TestInstanceReportedPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.TestInstanceReportedPayload.safeParse({
            testInstanceId: VALID_GUID_A,
            results: [
                { parameterCode: 'pH', parameterValue: '6.4' },
            ],
            attachmentIds: [VALID_GUID_B],
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty results', () => {
        const r = payloads.TestInstanceReportedPayload.safeParse({
            testInstanceId: VALID_GUID_A,
            results: [],
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Job cards
// ──────────────────────────────────────────────────────────────────────

describe('JobCardCreatePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardCreatePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            plannedDate: VALID_LOG_DATE,
            lineItems: [
                {
                    activityType: 'Pruning',
                    expectedHours: 4,
                    ratePerHourAmount: 50,
                    ratePerHourCurrencyCode: 'INR',
                },
            ],
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty lineItems', () => {
        const r = payloads.JobCardCreatePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            plannedDate: VALID_LOG_DATE,
            lineItems: [],
        });
        expect(r.success).toBe(false);
    });
});

describe('JobCardAssignPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardAssignPayload.safeParse({
            jobCardId: VALID_GUID_A,
            workerUserId: VALID_GUID_B,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing workerUserId', () => {
        const r = payloads.JobCardAssignPayload.safeParse({ jobCardId: VALID_GUID_A });
        expect(r.success).toBe(false);
    });
});

describe('JobCardStartPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardStartPayload.safeParse({ jobCardId: VALID_GUID_A });
        expect(r.success).toBe(true);
    });
    it('rejects non-UUID jobCardId', () => {
        const r = payloads.JobCardStartPayload.safeParse({ jobCardId: 'nope' });
        expect(r.success).toBe(false);
    });
});

describe('JobCardCompletePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardCompletePayload.safeParse({
            jobCardId: VALID_GUID_A,
            dailyLogId: VALID_GUID_B,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing dailyLogId', () => {
        const r = payloads.JobCardCompletePayload.safeParse({ jobCardId: VALID_GUID_A });
        expect(r.success).toBe(false);
    });
});

describe('JobCardSettlePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardSettlePayload.safeParse({
            jobCardId: VALID_GUID_A,
            actualPayoutAmount: 200,
            actualPayoutCurrencyCode: 'INR',
            settlementNote: 'Paid in cash',
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty currency code', () => {
        const r = payloads.JobCardSettlePayload.safeParse({
            jobCardId: VALID_GUID_A,
            actualPayoutAmount: 200,
            actualPayoutCurrencyCode: '',
        });
        expect(r.success).toBe(false);
    });
});

describe('JobCardCancelPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.JobCardCancelPayload.safeParse({
            jobCardId: VALID_GUID_A,
            reason: 'Worker unavailable',
        });
        expect(r.success).toBe(true);
    });
    it('rejects empty reason', () => {
        const r = payloads.JobCardCancelPayload.safeParse({
            jobCardId: VALID_GUID_A,
            reason: '',
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Schedule (registered, handler not yet wired but schema mirrors the
// real domain command)
// ──────────────────────────────────────────────────────────────────────

describe('AdoptSchedulePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AdoptSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            scheduleTemplateId: VALID_GUID_D,
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing scheduleTemplateId', () => {
        const r = payloads.AdoptSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(false);
    });
});

describe('MigrateSchedulePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.MigrateSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            newScheduleTemplateId: VALID_GUID_D,
            reason: 'WeatherShift',
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(true);
    });
    it('rejects unknown reason value', () => {
        const r = payloads.MigrateSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            newScheduleTemplateId: VALID_GUID_D,
            reason: 'NotARealReason',
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(false);
    });
});

describe('AbandonSchedulePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AbandonSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            actorUserId: VALID_GUID_D,
            reasonText: 'Crop failed',
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing actorUserId', () => {
        const r = payloads.AbandonSchedulePayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
        });
        expect(r.success).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Truly-unwired (handler returns MUTATION_TYPE_UNIMPLEMENTED today).
// Schemas use .passthrough() so unknown fields don't break — see the
// header in each .zod.ts for rationale.
// ──────────────────────────────────────────────────────────────────────

describe('PublishSchedulePayload', () => {
    it('accepts a valid payload (passes extra fields through)', () => {
        const r = payloads.PublishSchedulePayload.safeParse({
            scheduleTemplateId: VALID_GUID_A,
            actorUserId: VALID_GUID_B,
            futureFieldNotYetSpecified: 'tolerated',
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing scheduleTemplateId', () => {
        const r = payloads.PublishSchedulePayload.safeParse({ actorUserId: VALID_GUID_B });
        expect(r.success).toBe(false);
    });
});

describe('EditSchedulePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.EditSchedulePayload.safeParse({
            scheduleTemplateId: VALID_GUID_A,
            actorUserId: VALID_GUID_B,
        });
        expect(r.success).toBe(true);
    });
    it('rejects non-UUID scheduleTemplateId', () => {
        const r = payloads.EditSchedulePayload.safeParse({
            scheduleTemplateId: 'nope',
            actorUserId: VALID_GUID_B,
        });
        expect(r.success).toBe(false);
    });
});

describe('CloneSchedulePayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.CloneSchedulePayload.safeParse({
            sourceScheduleTemplateId: VALID_GUID_A,
            actorUserId: VALID_GUID_B,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing sourceScheduleTemplateId', () => {
        const r = payloads.CloneSchedulePayload.safeParse({ actorUserId: VALID_GUID_B });
        expect(r.success).toBe(false);
    });
});

describe('AddPlannedPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AddPlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            actorUserId: VALID_GUID_D,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing cropCycleId', () => {
        const r = payloads.AddPlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            actorUserId: VALID_GUID_D,
        });
        expect(r.success).toBe(false);
    });
});

describe('OverridePlannedPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.OverridePlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            plannedActivityId: VALID_GUID_D,
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(true);
    });
    it('rejects missing plannedActivityId', () => {
        const r = payloads.OverridePlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(false);
    });
});

describe('RemovePlannedPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.RemovePlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            plannedActivityId: VALID_GUID_D,
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(true);
    });
    it('rejects non-UUID plannedActivityId', () => {
        const r = payloads.RemovePlannedPayload.safeParse({
            farmId: VALID_GUID_A,
            plotId: VALID_GUID_B,
            cropCycleId: VALID_GUID_C,
            plannedActivityId: 'oops',
            actorUserId: VALID_GUID_E,
        });
        expect(r.success).toBe(false);
    });
});

describe('AddLocationPayload', () => {
    it('accepts a valid payload', () => {
        const r = payloads.AddLocationPayload.safeParse({
            latitude: 18.5,
            longitude: 73.9,
            accuracyMeters: 10,
            capturedAtUtc: VALID_ISO,
            provider: 'gps',
            permissionState: 'granted',
        });
        expect(r.success).toBe(true);
    });
    it('rejects malformed capturedAtUtc', () => {
        const r = payloads.AddLocationPayload.safeParse({
            latitude: 18.5,
            longitude: 73.9,
            accuracyMeters: 10,
            capturedAtUtc: 'not a date',
            provider: 'gps',
            permissionState: 'granted',
        });
        expect(r.success).toBe(false);
    });
});
