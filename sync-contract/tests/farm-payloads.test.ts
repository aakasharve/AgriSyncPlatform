// T-IGH-02-PAYLOADS: happy + failing path coverage for Farm aggregate
// payloads (create_farm, create_plot, create_crop_cycle).
import { describe, it, expect } from 'vitest';
import { CreateFarmPayload } from '../schemas/payloads/create_farm.zod';
import { CreatePlotPayload } from '../schemas/payloads/create_plot.zod';
import { CreateCropCyclePayload } from '../schemas/payloads/create_crop_cycle.zod';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const G3 = '33333333-3333-3333-3333-333333333333';

describe('CreateFarmPayload', () => {
  it('accepts a minimal valid payload', () => {
    const r = CreateFarmPayload.safeParse({ name: 'My Farm' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = CreateFarmPayload.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('CreatePlotPayload', () => {
  it('accepts a valid payload with optional plotId', () => {
    const r = CreatePlotPayload.safeParse({
      plotId: G1,
      farmId: G2,
      name: 'North Plot',
      areaInAcres: 2.5,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-positive area', () => {
    const r = CreatePlotPayload.safeParse({
      farmId: G2,
      name: 'N',
      areaInAcres: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe('CreateCropCyclePayload', () => {
  it('accepts a valid payload', () => {
    const r = CreateCropCyclePayload.safeParse({
      cropCycleId: G1,
      farmId: G2,
      plotId: G3,
      cropName: 'Grapes',
      stage: 'Pruning',
      startDate: '2026-04-01',
    });
    expect(r.success).toBe(true);
  });

  it('rejects malformed startDate (ISO datetime instead of date)', () => {
    const r = CreateCropCyclePayload.safeParse({
      farmId: G2,
      plotId: G3,
      cropName: 'Grapes',
      stage: 'Pruning',
      startDate: '2026-04-01T00:00:00Z',
    });
    expect(r.success).toBe(false);
  });
});
