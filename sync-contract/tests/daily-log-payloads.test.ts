// T-IGH-02-PAYLOADS: happy + failing path coverage for DailyLog
// aggregate payloads (add_log_task, verify_log, add_location).
import { describe, it, expect } from 'vitest';
import { AddLogTaskPayload } from '../schemas/payloads/add_log_task.zod';
import { VerifyLogPayload } from '../schemas/payloads/verify_log.zod';
import { AddLocationPayload } from '../schemas/payloads/add_location.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';

describe('AddLogTaskPayload', () => {
  it('accepts a valid payload with optional fields omitted', () => {
    const r = AddLogTaskPayload.safeParse({
      dailyLogId: G1,
      activityType: 'Pruning',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty activityType', () => {
    const r = AddLogTaskPayload.safeParse({
      dailyLogId: G1,
      activityType: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('VerifyLogPayload', () => {
  it('accepts targetStatus + dailyLogId', () => {
    const r = VerifyLogPayload.safeParse({
      dailyLogId: G1,
      targetStatus: 'Verified',
      verifiedByUserId: G2,
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed dailyLogId', () => {
    const r = VerifyLogPayload.safeParse({
      dailyLogId: 'not-a-guid',
      targetStatus: 'Verified',
    });
    expect(r.success).toBe(false);
  });
});

describe('AddLocationPayload', () => {
  it('accepts a complete location snapshot', () => {
    const r = AddLocationPayload.safeParse({
      latitude: 18.5204,
      longitude: 73.8567,
      accuracyMeters: 10,
      capturedAtUtc: '2026-04-30T10:00:00Z',
      provider: 'gps',
      permissionState: 'granted',
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative accuracyMeters', () => {
    const r = AddLocationPayload.safeParse({
      latitude: 18.5204,
      longitude: 73.8567,
      accuracyMeters: -1,
      capturedAtUtc: '2026-04-30T10:00:00Z',
      provider: 'gps',
      permissionState: 'granted',
    });
    expect(r.success).toBe(false);
  });
});
