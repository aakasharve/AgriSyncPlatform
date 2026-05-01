// T-IGH-02-PAYLOADS: happy + failing path coverage for the remaining
// aggregates (Compliance, TestInstance, JobCard).
import { describe, it, expect } from 'vitest';
import { ComplianceAcknowledgePayload } from '../schemas/payloads/compliance_acknowledge.zod';
import { ComplianceResolvePayload } from '../schemas/payloads/compliance_resolve.zod';
import { TestinstanceCollectedPayload } from '../schemas/payloads/testinstance_collected.zod';
import { TestinstanceReportedPayload } from '../schemas/payloads/testinstance_reported.zod';
import { JobcardCreatePayload } from '../schemas/payloads/jobcard_create.zod';
import { JobcardAssignPayload } from '../schemas/payloads/jobcard_assign.zod';
import { JobcardStartPayload } from '../schemas/payloads/jobcard_start.zod';
import { JobcardCompletePayload } from '../schemas/payloads/jobcard_complete.zod';
import { JobcardSettlePayload } from '../schemas/payloads/jobcard_settle.zod';
import { JobcardCancelPayload } from '../schemas/payloads/jobcard_cancel.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const G3 = '33333333-3333-3333-3333-333333333333';

describe('ComplianceAcknowledgePayload', () => {
  it('accepts a valid signalId', () => {
    const r = ComplianceAcknowledgePayload.safeParse({ signalId: G1 });
    expect(r.success).toBe(true);
  });

  it('rejects a non-Guid signalId', () => {
    const r = ComplianceAcknowledgePayload.safeParse({ signalId: 'foo' });
    expect(r.success).toBe(false);
  });
});

describe('ComplianceResolvePayload', () => {
  it('accepts signalId + note', () => {
    const r = ComplianceResolvePayload.safeParse({
      signalId: G1,
      note: 'Issue resolved by spraying',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty note', () => {
    const r = ComplianceResolvePayload.safeParse({ signalId: G1, note: '' });
    expect(r.success).toBe(false);
  });
});

describe('TestinstanceCollectedPayload', () => {
  it('accepts a valid testInstanceId', () => {
    const r = TestinstanceCollectedPayload.safeParse({ testInstanceId: G1 });
    expect(r.success).toBe(true);
  });

  it('rejects missing testInstanceId', () => {
    const r = TestinstanceCollectedPayload.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('TestinstanceReportedPayload', () => {
  it('accepts results with attachments', () => {
    const r = TestinstanceReportedPayload.safeParse({
      testInstanceId: G1,
      results: [
        { parameterCode: 'PH', parameterValue: '6.5', unit: 'pH' },
      ],
      attachmentIds: [G2],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty results array', () => {
    const r = TestinstanceReportedPayload.safeParse({
      testInstanceId: G1,
      results: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('JobcardCreatePayload', () => {
  it('accepts a valid payload with one line item', () => {
    const r = JobcardCreatePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
      plannedDate: '2026-05-15',
      lineItems: [
        {
          activityType: 'Pruning',
          expectedHours: 8,
          ratePerHourAmount: 200,
          ratePerHourCurrencyCode: 'INR',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty lineItems', () => {
    const r = JobcardCreatePayload.safeParse({
      farmId: G1,
      plotId: G2,
      plannedDate: '2026-05-15',
      lineItems: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('JobcardAssignPayload', () => {
  it('accepts both Guids', () => {
    const r = JobcardAssignPayload.safeParse({ jobCardId: G1, workerUserId: G2 });
    expect(r.success).toBe(true);
  });

  it('rejects non-Guid workerUserId', () => {
    const r = JobcardAssignPayload.safeParse({ jobCardId: G1, workerUserId: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('JobcardStartPayload', () => {
  it('accepts a valid jobCardId', () => {
    const r = JobcardStartPayload.safeParse({ jobCardId: G1 });
    expect(r.success).toBe(true);
  });

  it('rejects missing jobCardId', () => {
    const r = JobcardStartPayload.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('JobcardCompletePayload', () => {
  it('accepts both ids', () => {
    const r = JobcardCompletePayload.safeParse({ jobCardId: G1, dailyLogId: G2 });
    expect(r.success).toBe(true);
  });

  it('rejects missing dailyLogId', () => {
    const r = JobcardCompletePayload.safeParse({ jobCardId: G1 });
    expect(r.success).toBe(false);
  });
});

describe('JobcardSettlePayload', () => {
  it('accepts a payload with positive payout', () => {
    const r = JobcardSettlePayload.safeParse({
      jobCardId: G1,
      actualPayoutAmount: 1600,
      actualPayoutCurrencyCode: 'INR',
      settlementNote: 'Paid in cash',
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-positive payout', () => {
    const r = JobcardSettlePayload.safeParse({
      jobCardId: G1,
      actualPayoutAmount: 0,
      actualPayoutCurrencyCode: 'INR',
    });
    expect(r.success).toBe(false);
  });
});

describe('JobcardCancelPayload', () => {
  it('accepts jobCardId + reason', () => {
    const r = JobcardCancelPayload.safeParse({
      jobCardId: G1,
      reason: 'Worker unavailable',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty reason', () => {
    const r = JobcardCancelPayload.safeParse({ jobCardId: G1, reason: '' });
    expect(r.success).toBe(false);
  });
});
