import { describe, it, expect } from 'vitest';
import { buildReport } from '../reporter';
import type { ScenarioResult, EvalConfig } from '../types';

const baseFloors = {
  workDone: 0, irrigation: 0, machinery: 0,
  expenses: 0, tasks: 0, observations: 0,
} as const;

const cfg: EvalConfig = {
  thresholds: { inputs: 0.8, labour: 0.8 },
  global: { failOnRegression: true, minScenariosPerBucket: 3, bucketFloorOverrides: { ...baseFloors } },
};

const r = (id: string, bucket: ScenarioResult['bucket'], passed: boolean): ScenarioResult => ({
  scenarioId: id, bucket, source: 'live', passed, fieldDiffs: [], modelMs: 0, promptVersion: 'test',
});
const find = (rep: ReturnType<typeof buildReport>, b: string) =>
  rep.buckets.find((x) => x.bucket === b && x.source === 'live')!;

describe('buildReport honest gate', () => {
  it('FAILS a floor>0 bucket below minScenariosPerBucket', () => {
    const rep = buildReport([r('a', 'inputs', true)], new Date(), new Date(), cfg);
    expect(find(rep, 'inputs').belowFloor).toBe(true);
    expect(rep.overall).toBe('fail');
  });

  it('FAILS when pass-rate is below threshold even at/above floor', () => {
    const rep = buildReport(
      [r('a', 'inputs', true), r('b', 'inputs', true), r('c', 'inputs', false)], // 2/3 = 0.67 < 0.80
      new Date(), new Date(), cfg,
    );
    expect(find(rep, 'inputs').belowFloor).toBe(false);
    expect(find(rep, 'inputs').belowThreshold).toBe(true);
    expect(rep.overall).toBe('fail');
  });

  it('PASSES when floor met and pass-rate >= threshold; floor-0 empty buckets do not fail', () => {
    const rep = buildReport(
      [r('a', 'inputs', true), r('b', 'inputs', true), r('c', 'inputs', true)], // 3/3, floor 3
      new Date(), new Date(), cfg,
    );
    expect(rep.overall).toBe('pass');
  });

  it('surfaces a zero-scenario floor>0 bucket as belowFloor (no vacuous pass)', () => {
    const cfg2: EvalConfig = { ...cfg, global: { ...cfg.global, bucketFloorOverrides: { ...baseFloors, labour: 3 } } };
    const rep = buildReport(
      [r('a', 'inputs', true), r('b', 'inputs', true), r('c', 'inputs', true)],
      new Date(), new Date(), cfg2,
    );
    expect(find(rep, 'labour').total).toBe(0);
    expect(find(rep, 'labour').belowFloor).toBe(true);
    expect(rep.overall).toBe('fail');
  });
});
