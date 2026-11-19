/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
 * THE DUPLICATE IS GONE — AND THAT IS WHAT IS ASSERTED NOW.
 *
 * Task 9 documented the three fixed axes here while the three live charts
 * still owned theirs, and read those files from disk so the two copies could
 * not drift. **Task 22 re-pointed all four Farmer Health charts onto
 * `ChartShell` and DELETED them** — `ScoreDistributionChart.tsx`,
 * `EngagementTierBreakdown.tsx`, `PillarHeatmap.tsx` and
 * `WeeklyTrendChart.tsx`. There is no second copy of `SCORE_BINS` or
 * `TIER_ORDER` left to compare against, and `PILLAR_ORDER` moved into the
 * feature as `PILLARS`/`PILLAR_AXIS` because it carries a weight and a
 * measurability rule this module has no business knowing.
 *
 * So the assertion inverts: instead of proving two copies agree, prove there
 * is only one. A `grep` for a re-declared axis is the cheap, direct form of
 * "nobody quietly started a second one".
 *
 * The length guard is not decoration. `vitest.config.ts` sets `css: false`,
 * which stubs css requests — including `?raw` — to an empty string, and Task 3
 * lost about twenty assertions to exactly that shape. These are .tsx rather
 * than .css so the stub does not apply, but the failure mode (a suite passing
 * against '') is cheap enough to rule out that ruling it out is not optional.
 */
function source(rel: string): string {
  const text = readFileSync(resolve(process.cwd(), rel), 'utf-8');
  expect(text.length, rel).toBeGreaterThan(500);
  return text;
}

const FEATURE = 'src/features/farmer-health';

describe('there is exactly ONE copy of each fixed axis (A33)', () => {
  it('the four re-pointed charts are gone, not orphaned beside the shell', () => {
    /* A rewrite that left them on disk would leave two charts per axis, one
       of which nothing renders — which is how a "fixed axis" starts drifting
       from the one the reader is looking at. */
    for (const file of [
      'ScoreDistributionChart.tsx',
      'EngagementTierBreakdown.tsx',
      'PillarHeatmap.tsx',
      'WeeklyTrendChart.tsx',
    ]) {
      expect(existsSync(resolve(process.cwd(), FEATURE, 'components', file)), file).toBe(false);
    }
  });

  it('no farmer-health file re-declares SCORE_BINS or TIER_ORDER', () => {
    for (const rel of featureFiles()) {
      const text = readFileSync(rel, 'utf-8');
      expect(/const FIXED_BINS\s*[:=]/.test(text), rel).toBe(false);
      expect(/const TIER_ORDER\s*[:=]/.test(text), rel).toBe(false);
    }
  });

  it('the pillar axis the screen draws is the six pillars, in weighting order', () => {
    /* PILLAR_ORDER's keys still have to be these six, in this order, wherever
       they live — the heatmap's whole honesty property is that an absent
       pillar keeps its place. */
    const text = source(`${FEATURE}/cohort.ts`);
    const from = text.indexOf('export const PILLARS');
    const to = text.indexOf('] as const;', from);
    expect(from, 'PILLARS not found in cohort.ts').toBeGreaterThan(-1);
    expect(to, 'PILLARS block not terminated').toBeGreaterThan(from);

    const keys = [...text.slice(from, to).matchAll(/key: '([^']+)'/g)].map((m) => m[1]);

    expect(keys).toEqual(PILLAR_ORDER.map((p) => (typeof p === 'string' ? p : p.key)));
    expect(keys).toHaveLength(6);
  });

  it('every chart still carries a "Show data table" disclosure (A32)', () => {
    /* The four that moved get theirs from `ChartShell`, whose `dataTable` is a
       REQUIRED prop — the compiler is the assertion there, and the screen test
       reads the rendered tables. The fifth is still hand-rolled and still
       Task 23's. */
    expect(source('src/components/data/ChartShell.tsx')).toContain('Show data table');
    expect(source(`${FEATURE}/components/FarmerTimeline.tsx`)).toContain('Show data table');
  });

  it('the sr-only disclosure is gone, and nothing brought it back', () => {
    /* `EngagementTierBreakdown.tsx:95` was `<details className="sr-only">` —
       the one accessibility affordance on the page, and the one thing no
       screenshot review could see. It is the reason `dataTable` is a required
       prop. Its replacement is VISIBLE, and no farmer-health file may hide a
       data table again. */
    for (const rel of featureFiles()) {
      /* CODE ONLY. This very rule is quoted in a comment in `FarmerHealthPage`
         — the note explaining why the sr-only table went — and an assertion
         that cannot tell a prohibition from its own explanation is an
         assertion that punishes documenting the decision. */
      expect(/<details className="sr-only">/.test(codeOf(readFileSync(rel, 'utf-8'))), rel).toBe(
        false,
      );
    }
  });
});

/** The file with its comments removed, so a rule quoted in a comment does not
 *  read as the rule being broken. */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every .ts/.tsx under the feature, tests excluded. */
function featureFiles(): string[] {
  const root = resolve(process.cwd(), FEATURE);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  expect(out.length).toBeGreaterThan(5);
  return out;
}
