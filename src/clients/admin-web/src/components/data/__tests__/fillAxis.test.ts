/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fillAxis,
  gapCount,
  isGap,
  measuredSlots,
  ramp,
  PILLAR_ORDER,
  SCORE_BINS,
  TIER_ORDER,
} from '../fillAxis';
import type { AxisSlot } from '../fillAxis';

/**
 * THE ONE BEHAVIOUR THIS TASK EXISTS FOR.
 *
 * A slot that was MEASURED and came back zero is a real zero.
 * A slot that was NEVER MEASURED is a gap.
 *
 * The live console cannot tell them apart: `map.get(key) ?? 0` in three charts
 * turns both into a bar sitting on the axis. Every assertion in the first
 * describe block goes red if `fillAxis` ever falls back to a number again.
 */

interface Bin {
  bucket: string;
  count: number | null;
}

const bucket = (b: Bin) => b.bucket;
const countOf = (b: Bin) => b.count;

describe('a gap is not a zero, and a zero is not a gap', () => {
  it('a slot MEASURED at zero keeps its zero', () => {
    const slots = fillAxis(['0-10', '11-20'], [{ bucket: '0-10', count: 0 }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    expect(slots[0]).toEqual({ key: '0-10', label: '0-10', kind: 'value', value: 0 });
  });

  it('a slot NEVER measured is a gap — and carries no value at all', () => {
    const slots = fillAxis(['0-10', '11-20'], [{ bucket: '0-10', count: 0 }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    expect(slots[1].kind).toBe('gap');
    // Not `value: 0`. Not `value: null`. NO VALUE PROPERTY — there is nothing
    // for a later `?? 0` to fall through to.
    expect(slots[1]).not.toHaveProperty('value');
    expect(slots[1]).toEqual({ key: '11-20', label: '11-20', kind: 'gap', why: 'unmeasured' });
  });

  it('the two are distinguishable AFTER the fill, which is the whole point', () => {
    const slots = fillAxis(['a', 'b'], [{ bucket: 'a', count: 0 }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    const kinds = slots.map((s) => s.kind);
    expect(kinds).toEqual(['value', 'gap']);
    // If the fill ever zero-filled again, both would read 'value' and this
    // console would be back to drawing an absence as a bad day.
    expect(new Set(kinds).size).toBe(2);
  });

  it('a row that EXISTS but carries no number is a gap, not a zero', () => {
    // The other half of the same defect: an API row for the week with a null
    // average is still a week with no reading.
    const slots = fillAxis(['a'], [{ bucket: 'a', count: null }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    expect(slots[0].kind).toBe('gap');
  });

  it('NaN is a gap — `0/0` over an empty week is not a measurement', () => {
    const slots = fillAxis(['a'], [{ bucket: 'a', count: Number.NaN }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    expect(slots[0].kind).toBe('gap');
  });

  it('a gap can name WHICH of the four causes it is', () => {
    const slots = fillAxis(['a', 'b'], [], {
      keyOf: bucket,
      valueOf: countOf,
      why: (key) => (key === 'a' ? 'feed-down' : 'unmeasured'),
    });

    expect(slots.map((s) => (isGap(s) ? s.why : null))).toEqual(['feed-down', 'unmeasured']);
  });
});

describe('the axis is fixed, so a chart cannot reshuffle between refreshes', () => {
  it('keeps axis order regardless of the order the API returned', () => {
    const slots = fillAxis(
      ['0-10', '11-20', '21-30'],
      [
        { bucket: '21-30', count: 3 },
        { bucket: '0-10', count: 1 },
      ],
      { keyOf: bucket, valueOf: countOf },
    );

    expect(slots.map((s) => s.key)).toEqual(['0-10', '11-20', '21-30']);
  });

  it('keeps axis LENGTH even when the API returns nothing', () => {
    const slots = fillAxis(SCORE_BINS, [], { keyOf: bucket, valueOf: countOf });

    expect(slots).toHaveLength(10);
    expect(gapCount(slots)).toBe(10);
  });

  it('ignores a row whose key is not on the axis — the API cannot widen a chart', () => {
    const slots = fillAxis(['a'], [{ bucket: 'zzz', count: 9 }], {
      keyOf: bucket,
      valueOf: countOf,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].kind).toBe('gap');
  });

  it('resolves a duplicate key the way `new Map` does — last wins', () => {
    // Preserved from the three live charts (`new Map(bins.map(...))`) rather
    // than improved. A silent change of tie-breaking is the drift a rewrite
    // is meant to avoid.
    const slots = fillAxis(
      ['a'],
      [
        { bucket: 'a', count: 1 },
        { bucket: 'a', count: 2 },
      ],
      { keyOf: bucket, valueOf: countOf },
    );

    expect(slots[0]).toMatchObject({ kind: 'value', value: 2 });
  });

  it('tolerates a null collection — a hook that has not resolved is not a zero', () => {
    const slots = fillAxis(TIER_ORDER, null, { keyOf: bucket, valueOf: countOf });

    expect(slots.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(slots.every(isGap)).toBe(true);
  });

  it('separates the reader label from the API key', () => {
    const slots = fillAxis(PILLAR_ORDER, [], { keyOf: bucket, valueOf: countOf });

    expect(slots[0].key).toBe('triggerFit');
    expect(slots[0].label).toBe('Trigger fit');
  });
});

describe('helpers', () => {
  const slots: AxisSlot<number>[] = fillAxis(
    ['a', 'b', 'c'],
    [
      { bucket: 'a', count: 0 },
      { bucket: 'c', count: 4 },
    ],
    { keyOf: bucket, valueOf: countOf },
  );

  it('measuredSlots keeps a measured zero and drops the gap', () => {
    expect(measuredSlots(slots).map((s) => s.value)).toEqual([0, 4]);
  });

  it('gapCount counts only what was never measured', () => {
    expect(gapCount(slots)).toBe(1);
  });
});

describe('the recency ramp (v3 AS.ramp)', () => {
  it('runs from the faintest at the oldest to full strength at the newest', () => {
    expect(ramp(0, 8)).toBe(0.45);
    expect(ramp(7, 8)).toBe(1);
  });

  it('is a different step for a different series length — which is why it is shared', () => {
    // 45% across three bars is not 45% across twelve. Two pages doing their
    // own arithmetic drift apart on a screen a reader compares side by side.
    expect(ramp(1, 3)).not.toBe(ramp(1, 12));
  });

  it('returns full strength for a one-period series rather than dividing by zero', () => {
    expect(ramp(0, 1)).toBe(1);
    expect(ramp(0, 0)).toBe(1);
  });
});

/**
 * THE TWO COPIES MUST AGREE.
 *
 * `fillAxis.ts` documents the three fixed axes; the three live charts still
 * own theirs, because no chart is re-pointed until Tasks 21-23. A duplicate
 * nothing compares is a duplicate that drifts, so these read the live files
 * FROM DISK.
 *
 * The length guard is not decoration. `vitest.config.ts` sets `css: false`,
 * which stubs css requests — including `?raw` — to an empty string, and Task 3
 * lost about twenty assertions to exactly that shape. These are .tsx rather
 * than .css so the stub does not apply, but the failure mode (a suite passing
 * against '') is cheap enough to rule out that ruling it out is not optional.
 */
function source(file: string): string {
  const text = readFileSync(
    resolve(process.cwd(), 'src/features/farmer-health/components', file),
    'utf-8',
  );
  expect(text.length).toBeGreaterThan(500);
  return text;
}

describe('the documented axes match the live charts (A33)', () => {
  it('SCORE_BINS matches FIXED_BINS in ScoreDistributionChart', () => {
    const declared = source('ScoreDistributionChart.tsx').match(/const FIXED_BINS = \[([^\]]*)\]/);
    expect(declared).not.toBeNull();
    const live = (declared?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1));

    expect(live).toEqual([...SCORE_BINS]);
    expect(live).toHaveLength(10);
  });

  it('TIER_ORDER matches TIER_ORDER in EngagementTierBreakdown', () => {
    const declared = source('EngagementTierBreakdown.tsx').match(
      /const TIER_ORDER: EngagementTier\[\] = \[([^\]]*)\]/,
    );
    expect(declared).not.toBeNull();
    const live = (declared?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1));

    expect(live).toEqual([...TIER_ORDER]);
  });

  it('PILLAR_ORDER matches PILLAR_ORDER in PillarHeatmap', () => {
    const declared = source('PillarHeatmap.tsx').match(/const PILLAR_ORDER = \[([^\]]*)\]/);
    expect(declared).not.toBeNull();
    const live = (declared?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1));

    expect(live).toEqual(PILLAR_ORDER.map((p) => (typeof p === 'string' ? p : p.key)));
    expect(live).toHaveLength(6);
  });

  it('all five charts still carry a "Show data table" disclosure (A32)', () => {
    // The register line this task is built on. If one of these disappears
    // before Tasks 21-23 re-point them, it disappeared without the shell.
    for (const file of [
      'ScoreDistributionChart.tsx',
      'EngagementTierBreakdown.tsx',
      'PillarHeatmap.tsx',
      'WeeklyTrendChart.tsx',
      'FarmerTimeline.tsx',
    ]) {
      expect(source(file)).toContain('Show data table');
    }
  });

  it('the sr-only one is still sr-only — the reason this prop is required', () => {
    // EngagementTierBreakdown.tsx:95. Invisible in every screenshot review,
    // which is why a convention was never going to be enough.
    expect(source('EngagementTierBreakdown.tsx')).toContain('<details className="sr-only">');
  });
});
