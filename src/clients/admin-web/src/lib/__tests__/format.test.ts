/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, fmt, rate01 } from '@/lib/format';

/**
 * The central rule of the formatter module, asserted rather than asserted-to.
 *
 * A missing measurement must come out as `null` and NEVER as 0, '0', '0%',
 * '0ms' or '₹0'. These tests are the only thing standing between that rule and
 * a screen that quietly reports a zero it never measured.
 *
 * They are deliberately written so that breaking a formatter — making it
 * return 0 instead of null — turns them red. That was demonstrated during
 * Task 4 by doing exactly that, watching this file fail, and reverting.
 */

const MISSING = [null, undefined, NaN] as const;

describe('null in, null out — the rule the whole module exists for', () => {
  it.each(MISSING)('fmt.num(%s) is null, so nothing can render a fabricated zero', (v) => {
    expect(fmt.num(v)).toBeNull();
  });

  it.each(MISSING)('fmt.pct(%s) is null, not "0%"', (v) => {
    expect(fmt.pct(v)).toBeNull();
  });

  it.each(MISSING)('fmt.ratePct(%s) is null, not "0%"', (v) => {
    expect(fmt.ratePct(v)).toBeNull();
  });

  it.each(MISSING)('fmt.ms(%s) is null, not "0ms"', (v) => {
    expect(fmt.ms(v)).toBeNull();
  });

  it.each(MISSING)('fmt.money(%s) is null, not "₹0"', (v) => {
    expect(fmt.money(v)).toBeNull();
  });

  it.each(MISSING)('fmt.acres(%s) is null, not "0 ac"', (v) => {
    expect(fmt.acres(v)).toBeNull();
  });

  it.each(MISSING)('rate01(%s) is null — a missing rate is not a zero rate', (v) => {
    expect(rate01(v)).toBeNull();
  });

  it.each([null, undefined, ''])('fmt.date(%s) is null', (v) => {
    expect(fmt.date(v)).toBeNull();
    expect(fmt.dateTime(v)).toBeNull();
    expect(fmt.time(v)).toBeNull();
    expect(fmt.age(v)).toBeNull();
  });

  it('a non-finite number is a missing reading, not a printable one', () => {
    expect(fmt.num(Infinity)).toBeNull();
    expect(fmt.num(-Infinity)).toBeNull();
    expect(fmt.ms(Infinity)).toBeNull();
  });

  it('every null return is genuinely null, never the string "null" or a zero', () => {
    // Guards the shape of the failure as well as the fact of it: a caller
    // testing `=== null` must not be defeated by a stringified null.
    const outputs: unknown[] = [
      fmt.num(null),
      fmt.pct(null),
      fmt.ms(null),
      fmt.money(null),
      fmt.acres(null),
    ];
    for (const out of outputs) {
      expect(out).toBeNull();
      expect(out).not.toBe(0);
      expect(out).not.toBe('0');
      expect(out).not.toBe('null');
    }
  });
});

describe('fmt.num — Indian digit grouping', () => {
  it('groups 2477000 as 24,77,000 and not as 2,477,000', () => {
    // Western grouping here would be wrong for every operator who reads this
    // console. It also silently regresses if the runtime loses full ICU, which
    // is why the assertion is on the exact string.
    expect(fmt.num(2477000)).toBe('24,77,000');
  });

  it('groups the smaller magnitudes the console actually shows', () => {
    expect(fmt.num(1402)).toBe('1,402');
    expect(fmt.num(100000)).toBe('1,00,000');
    expect(fmt.num(0)).toBe('0'); // a MEASURED zero still prints — that is a reading
  });

  it('fixes the decimal places so a column lines up under tabular-nums', () => {
    expect(fmt.num(3, 2)).toBe('3.00');
    expect(fmt.num(12.75, 2)).toBe('12.75');
    expect(fmt.num(4.2, 2)).toBe('4.20');
  });
});

describe('fmt.pct / fmt.ratePct / fmt.ms / fmt.money / fmt.acres', () => {
  it('pct takes a percentage and keeps the sign tight against the figure', () => {
    expect(fmt.pct(94.2)).toBe('94.2%');
    expect(fmt.pct(94.24, 0)).toBe('94%');
  });

  it('ratePct takes a 0..1 rate — the AiHealthBlock reading', () => {
    expect(fmt.ratePct(0.9432)).toBe('94%');
    expect(fmt.ratePct(1)).toBe('100%');
  });

  it('ratePct does NOT let a missing rate become a zero through arithmetic', () => {
    // `rate01(null) * 100` is 0 in JavaScript. This is the trap the helper
    // exists to close.
    expect(fmt.ratePct(null)).toBeNull();
    expect(fmt.ratePct(undefined)).toBeNull();
  });

  it('ms carries its unit and groups the digits', () => {
    expect(fmt.ms(310)).toBe('310ms');
    expect(fmt.ms(1490)).toBe('1,490ms');
  });

  it('money leads with the rupee symbol', () => {
    expect(fmt.money(2477000)).toBe('₹24,77,000');
  });

  it('acres prints one decimal by default', () => {
    expect(fmt.acres(28.4)).toBe('28.4 ac');
  });
});

describe('rate01 — lifted from AiHealthBlock, behaviour preserved exactly', () => {
  it('passes a valid rate straight through', () => {
    expect(rate01(0.9432)).toBe(0.9432);
    expect(rate01(0)).toBe(0); // a MEASURED zero rate is a real reading
    expect(rate01(1)).toBe(1);
  });

  it('clamps an out-of-range finite rate to the nearest bound', () => {
    // CHARACTERISATION, not endorsement. This is what AiHealthBlock ships
    // today, so the port preserves it. Note the consequence: a server bug
    // sending -0.2 renders "0%", which is a printed zero for a reading nobody
    // trusts. Flagged for the founder in the Task 4 report; changing it is a
    // product decision, not a refactor.
    expect(rate01(1.4)).toBe(1);
    expect(rate01(-0.2)).toBe(0);
  });
});

describe('fmt.age — the 4-tier freshness ramp (A24)', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads seconds under a minute, and never "0s ago"', () => {
    expect(fmt.age(ago(5_000), now)).toBe('5s ago');
    expect(fmt.age(ago(200), now)).toBe('1s ago');
  });

  it('reads minutes under an hour', () => {
    expect(fmt.age(ago(90_000), now)).toBe('1m ago');
    expect(fmt.age(ago(59 * 60_000), now)).toBe('59m ago');
  });

  it('reads hours under a day', () => {
    expect(fmt.age(ago(3 * 3_600_000), now)).toBe('3h ago');
  });

  it('reads days beyond that', () => {
    expect(fmt.age(ago(50 * 3_600_000), now)).toBe('2d ago');
  });

  it('returns null for an unparseable timestamp instead of "NaNd ago"', () => {
    // FreshnessChip.tsx:12-19 computes `Date.now() - NaN`, falls through every
    // branch and renders "NaNd ago" — a freshness age it does not have. The
    // shared module refuses to state an age it cannot compute. The chip itself
    // still carries the original; it is fixed when the chip is migrated.
    expect(fmt.age('not-a-date')).toBeNull();
  });
});

describe('fmt.date / dateTime / time never throw on bad input', () => {
  it('returns null where date-fns would raise a RangeError', () => {
    // Four components wrap `format()` in try/catch precisely because of this.
    expect(() => fmt.date('not-a-date')).not.toThrow();
    expect(fmt.date('not-a-date')).toBeNull();
    expect(fmt.dateTime(new Date(NaN))).toBeNull();
    expect(fmt.time(Number.NaN)).toBeNull();
  });

  it('formats with the surface pattern it is given', () => {
    // Constructed in LOCAL time on purpose: date-fns formats in local time, so
    // a UTC literal here would make the expectation timezone-dependent.
    const localNoon = new Date(2026, 7, 31, 9, 5, 7);
    expect(fmt.date(localNoon, DATE_FORMATS.churnLastLog)).toBe('31 Aug 2026');
    expect(fmt.date(localNoon, DATE_FORMATS.farmsLastLog)).toBe('31 Aug');
    expect(fmt.dateTime(localNoon, DATE_FORMATS.usersLastLogin)).toBe('31 Aug 26, 09:05');
    expect(fmt.time(localNoon, DATE_FORMATS.opsLiveRow)).toBe('09:05:07');
    expect(fmt.dateTime(localNoon, DATE_FORMATS.opsErrorsRow)).toBe('2026-08-31 09:05:07');
  });

  it('accepts a Date and an epoch number as well as an ISO string', () => {
    const iso = '2026-08-31T09:05:07.000Z';
    const viaString = fmt.dateTime(iso, DATE_FORMATS.usersLastLogin);
    expect(viaString).not.toBeNull();
    expect(fmt.dateTime(new Date(iso), DATE_FORMATS.usersLastLogin)).toBe(viaString);
    expect(fmt.dateTime(Date.parse(iso), DATE_FORMATS.usersLastLogin)).toBe(viaString);
  });
});

/**
 * The eleven per-surface formats are checked against the SCREENS THEMSELVES.
 *
 * A shared constant carrying a format string the screen does not actually use
 * would be worse than no constant at all: it would read as documentation and
 * be a lie. Each file is read from disk with a length check first, because
 * vitest.config.ts sets `css: false` and an empty read passing silently is a
 * known failure shape in this repo.
 */
describe('DATE_FORMATS matches the screens it claims to describe (A51)', () => {
  const CITED: Record<keyof typeof DATE_FORMATS, string> = {
    opsErrorsRow: 'src/pages/ops/OpsErrorsPage.tsx',
    opsLiveRow: 'src/pages/ops/OpsLivePage.tsx',
    opsLiveLastErr: 'src/pages/ops/OpsLivePage.tsx',
    farmsLastLog: 'src/pages/farms/FarmsListPage.tsx',
    farmsCreated: 'src/pages/farms/FarmsListPage.tsx',
    usersCreated: 'src/pages/users/UsersPage.tsx',
    usersLastLogin: 'src/pages/users/UsersPage.tsx',
    churnLastLog: 'src/pages/farms/SilentChurnPage.tsx',
    sufferLastErr: 'src/pages/farms/SufferingPage.tsx',
    cohortRow: 'src/features/farmer-health/components/InterventionQueueTable.tsx',
    workerSince: 'src/features/farmer-health/components/WorkerSummaryList.tsx',
    voiceDay: 'src/pages/ops/OpsVoicePage.tsx',
  };

  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

  it('read the real screen files — not empty stubs', () => {
    for (const rel of new Set(Object.values(CITED))) {
      expect(read(rel).length, rel).toBeGreaterThan(500);
    }
  });

  it.each(Object.entries(CITED))(
    '%s is the format its screen actually uses (or the screen now imports the module)',
    (key, rel) => {
      const src = read(rel);
      const pattern = DATE_FORMATS[key as keyof typeof DATE_FORMATS];
      // Two legal states: the screen still holds the literal (not yet
      // migrated), or the screen has been re-pointed at this module. Anything
      // else means the constant and the screen have drifted apart.
      const stillInline = src.includes(`'${pattern}'`);
      const migrated = /from '@\/lib\/format'/.test(src);
      expect(stillInline || migrated, `${rel} no longer agrees with DATE_FORMATS.${key}`).toBe(
        true
      );
    }
  );

  it('keeps all twelve, and keeps them different on purpose', () => {
    /* Eleven at Task 4; the twelfth is `voiceDay`, the first of the eleven
       recharts axis formats that report routed to Tasks 19, 21 and 22. */
    expect(Object.keys(DATE_FORMATS)).toHaveLength(12);
    // API Errors carries the full date because an operator may be looking days
    // back; Ops Live carries time only because its window is the last two
    // hours. Collapsing these into one format breaks both screens at once.
    expect(DATE_FORMATS.opsErrorsRow).toContain('yyyy-MM-dd');
    expect(DATE_FORMATS.opsLiveRow).not.toContain('MM');
    expect(new Set(Object.values(DATE_FORMATS)).size).toBeGreaterThan(1);
  });
});
