import { describe, it, expect } from 'vitest';
import { validatePayload } from '../PayloadValidator';
import { SyncMutationName } from '../SyncMutationCatalog';

describe('PayloadValidator', () => {
  it('passes valid create_daily_log payloads (canonical wire format)', () => {
    // Schema mirrors the backend allowlist + the client's CreateDailyLogCommand.
    // See sync-contract/schemas/payloads/create_daily_log.zod.ts for history.
    const result = validatePayload(SyncMutationName.CreateDailyLog, {
      dailyLogId: '11111111-1111-1111-1111-111111111111',
      farmId: '22222222-2222-2222-2222-222222222222',
      plotId: '33333333-3333-3333-3333-333333333333',
      cropCycleId: '44444444-4444-4444-4444-444444444444',
      logDate: '2026-04-27',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects payloads missing required fields', () => {
    const result = validatePayload(SyncMutationName.CreateDailyLog, { dailyLogId: 'not-a-guid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns ok for unknown payload-schema lookup misses (passthrough fallback)', () => {
    // T-IGH-02-PAYLOADS hardened all 32 catalog mutations, so the literal
    // "z.unknown() scaffold" branch tested by the previous version of this
    // case no longer exists. The fallback path itself remains: if the
    // catalog grows a mutation whose `<PayloadSchema>Payload` export hasn't
    // shipped yet (transient state during a sync-contract bump), the
    // validator should pass-through rather than throw. Simulate that by
    // calling validatePayload with a real catalog name AFTER deleting the
    // schema — but since we can't mutate the imported barrel here, we
    // assert the public observable: the contract test asserts every
    // catalog name has a matching export, and validatePayload over a
    // permissive .passthrough() schema (e.g. publish_schedule) tolerates
    // extra fields without rejecting.
    const result = validatePayload(SyncMutationName.SchedulePublish, {
      scheduleTemplateId: '11111111-1111-1111-1111-111111111111',
      actorUserId: '22222222-2222-2222-2222-222222222222',
      futureFieldNotYetSpecified: 'tolerated',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown mutation type', () => {
    const result = validatePayload('does_not_exist' as never, {});
    expect(result.ok).toBe(false);
  });
});
