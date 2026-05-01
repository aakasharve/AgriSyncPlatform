import { describe, it, expect } from 'vitest';
import { validatePayload } from '../PayloadValidator';
import { SyncMutationName } from '../SyncMutationCatalog';

describe('PayloadValidator', () => {
  it('passes valid create_daily_log payloads', () => {
    const result = validatePayload(SyncMutationName.CreateDailyLog, {
      clientRequestId: 'req-1',
      logId: '11111111-1111-1111-1111-111111111111',
      farmId: '22222222-2222-2222-2222-222222222222',
      plotIds: ['33333333-3333-3333-3333-333333333333'],
      capturedAt: '2026-04-27T10:00:00Z',
      inputMode: 'voice',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects payloads missing required fields', () => {
    const result = validatePayload(SyncMutationName.CreateDailyLog, { logId: 'not-a-guid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed jobcard.create payloads (T-IGH-02-PAYLOADS hardened the schema)', () => {
    // jobcard.create now has a strict schema; the historical
    // {anything: true} smoke is no longer a meaningful pass-through.
    // Replaced with a true validation check: missing required fields
    // must surface as a validation error.
    const result = validatePayload(SyncMutationName.JobcardCreate, { anything: true });
    expect(result.ok).toBe(false);
  });

  it('passes valid jobcard.create payloads', () => {
    const result = validatePayload(SyncMutationName.JobcardCreate, {
      farmId: '11111111-1111-1111-1111-111111111111',
      plotId: '22222222-2222-2222-2222-222222222222',
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
    expect(result.ok).toBe(true);
  });

  it('rejects unknown mutation type', () => {
    const result = validatePayload('does_not_exist' as never, {});
    expect(result.ok).toBe(false);
  });
});
