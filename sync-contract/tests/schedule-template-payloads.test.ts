// T-IGH-02-PAYLOADS: happy + failing path coverage for ScheduleTemplate
// payloads (schedule.publish, schedule.edit, schedule.clone).
import { describe, it, expect } from 'vitest';
import { SchedulePublishPayload } from '../schemas/payloads/schedule_publish.zod';
import { ScheduleEditPayload } from '../schemas/payloads/schedule_edit.zod';
import { ScheduleClonePayload } from '../schemas/payloads/schedule_clone.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';

describe('SchedulePublishPayload', () => {
  it('accepts the minimum payload', () => {
    const r = SchedulePublishPayload.safeParse({ templateId: G1 });
    expect(r.success).toBe(true);
  });

  it('rejects missing templateId', () => {
    const r = SchedulePublishPayload.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('ScheduleEditPayload', () => {
  it('accepts a full payload', () => {
    const r = ScheduleEditPayload.safeParse({
      sourceTemplateId: G1,
      newTemplateId: G2,
      newName: 'Pruning v2',
      newStage: 'Vegetative',
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing newTemplateId', () => {
    const r = ScheduleEditPayload.safeParse({ sourceTemplateId: G1 });
    expect(r.success).toBe(false);
  });
});

describe('ScheduleClonePayload', () => {
  it('accepts a clone-with-reason payload', () => {
    const r = ScheduleClonePayload.safeParse({
      sourceTemplateId: G1,
      newTemplateId: G2,
      newScope: 'Team',
      reason: 'Localizing for Vidarbha',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown TenantScope value', () => {
    const r = ScheduleClonePayload.safeParse({
      sourceTemplateId: G1,
      newTemplateId: G2,
      newScope: 'Global',
      reason: 'x',
    });
    expect(r.success).toBe(false);
  });
});
