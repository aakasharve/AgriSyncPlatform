// T-IGH-02-PAYLOADS: happy + failing path coverage for PlannedActivity
// payloads (plan.add, plan.override, plan.remove, adopt_schedule,
// migrate_schedule, abandon_schedule).
import { describe, it, expect } from 'vitest';
import { PlanAddPayload } from '../schemas/payloads/plan_add.zod';
import { PlanOverridePayload } from '../schemas/payloads/plan_override.zod';
import { PlanRemovePayload } from '../schemas/payloads/plan_remove.zod';
import { AdoptSchedulePayload } from '../schemas/payloads/adopt_schedule.zod';
import { MigrateSchedulePayload } from '../schemas/payloads/migrate_schedule.zod';
import { AbandonSchedulePayload } from '../schemas/payloads/abandon_schedule.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const G3 = '33333333-3333-3333-3333-333333333333';
const G4 = '44444444-4444-4444-4444-444444444444';

describe('PlanAddPayload', () => {
  it('accepts a valid payload', () => {
    const r = PlanAddPayload.safeParse({
      newActivityId: G1,
      cropCycleId: G2,
      farmId: G3,
      activityName: 'Spray',
      stage: 'Bloom',
      plannedDate: '2026-05-10',
      reason: 'Local override',
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed plannedDate', () => {
    const r = PlanAddPayload.safeParse({
      newActivityId: G1,
      cropCycleId: G2,
      farmId: G3,
      activityName: 'Spray',
      stage: 'Bloom',
      plannedDate: '10-05-2026',
      reason: 'x',
    });
    expect(r.success).toBe(false);
  });
});

describe('PlanOverridePayload', () => {
  it('accepts a date-only override', () => {
    const r = PlanOverridePayload.safeParse({
      plannedActivityId: G1,
      farmId: G2,
      newPlannedDate: '2026-05-12',
      reason: 'Rain forecast',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty reason', () => {
    const r = PlanOverridePayload.safeParse({
      plannedActivityId: G1,
      farmId: G2,
      newStage: 'Bloom',
      reason: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('PlanRemovePayload', () => {
  it('accepts a valid payload', () => {
    const r = PlanRemovePayload.safeParse({
      plannedActivityId: G1,
      farmId: G2,
      reason: 'Cancelled',
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing plannedActivityId', () => {
    const r = PlanRemovePayload.safeParse({ farmId: G2, reason: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('AdoptSchedulePayload', () => {
  it('accepts a valid payload', () => {
    const r = AdoptSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
      scheduleTemplateId: G4,
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing scheduleTemplateId', () => {
    const r = AdoptSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
    });
    expect(r.success).toBe(false);
  });
});

describe('MigrateSchedulePayload', () => {
  it('accepts a valid migration payload', () => {
    const r = MigrateSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
      newScheduleTemplateId: G4,
      reason: 'WeatherShift',
      reasonText: 'Unseasonal rain forecast',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown ScheduleMigrationReason', () => {
    const r = MigrateSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
      newScheduleTemplateId: G4,
      reason: 'BadReason',
    });
    expect(r.success).toBe(false);
  });
});

describe('AbandonSchedulePayload', () => {
  it('accepts a valid payload with optional reasonText', () => {
    const r = AbandonSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: G3,
      reasonText: 'Crop loss',
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed cropCycleId', () => {
    const r = AbandonSchedulePayload.safeParse({
      farmId: G1,
      plotId: G2,
      cropCycleId: 'not-a-guid',
    });
    expect(r.success).toBe(false);
  });
});
