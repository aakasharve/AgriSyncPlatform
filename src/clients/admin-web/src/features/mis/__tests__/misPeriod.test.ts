import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MIS_MAX_DAYS, clampCustom, fmtIndiaTime, istToday, presetPeriod, resetMisPeriod, useMisCompare, useMisPeriod,
  type MisPeriod,
} from '@/features/mis/misPeriod';

/**
 * CR-2b Task 1 — the one chosen range shared by all seven pages.
 * Expected values from the plan ("misPeriod" in the answer section, Task 1)
 * and CR-2a "Counting rules" (an India day = the date of t + 05:30).
 */

const DAY_MS = 86_400_000;
const spanDays = (p: { from: string; to: string }) =>
  (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / DAY_MS + 1;

beforeEach(() => {
  resetMisPeriod();
});

describe('misPeriod (CR-2b Task 1)', () => {
  it('Today_follows_india_time', () => {
    expect(istToday(new Date('2026-11-14T19:00:00Z'))).toBe('2026-11-15');
    expect(istToday(new Date('2026-11-14T18:29:59Z'))).toBe('2026-11-14');
    expect(istToday(new Date('2026-11-14T18:30:00Z'))).toBe('2026-11-15');
  });

  it('Presets_end_today_and_span_7_30_90_days', () => {
    expect(presetPeriod('7d', '2026-11-15')).toEqual({ preset: '7d', from: '2026-11-09', to: '2026-11-15' });
    expect(presetPeriod('30d', '2026-11-15')).toEqual({ preset: '30d', from: '2026-10-17', to: '2026-11-15' });
    expect(presetPeriod('90d', '2026-11-15')).toEqual({ preset: '90d', from: '2026-08-18', to: '2026-11-15' });
    // Across a month and year boundary.
    expect(presetPeriod('7d', '2027-01-02')).toEqual({ preset: '7d', from: '2026-12-27', to: '2027-01-02' });
  });

  it('Custom_never_ends_after_today_never_reverses_never_exceeds_180', () => {
    const today = '2026-11-15';
    expect(MIS_MAX_DAYS).toBe(180);

    const late = clampCustom('2026-11-01', '2026-11-20', today);
    expect(late.preset).toBe('custom');
    expect(late.to).toBe('2026-11-15');
    expect(late.from).toBe('2026-11-01');

    const backwards = clampCustom('2026-11-10', '2026-11-05', today);
    expect(backwards.to).toBe('2026-11-05');
    expect(backwards.from <= backwards.to).toBe(true);

    const long = clampCustom('2025-01-01', '2026-11-15', today);
    expect(long.to).toBe('2026-11-15');
    expect(spanDays(long)).toBeLessThanOrEqual(180);
    expect(spanDays(long)).toBeGreaterThanOrEqual(1);

    const fine = clampCustom('2026-06-01', '2026-06-30', today);
    expect(fine).toEqual({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
  });

  it('The_range_survives_unmounting_the_page', () => {
    let seen: MisPeriod | null = null;
    let compareSeen: boolean | null = null;
    let setPeriod: ((p: MisPeriod) => void) | null = null;
    let setCompare: ((on: boolean) => void) | null = null;
    function Page() {
      const [p, set] = useMisPeriod();
      const [c, setC] = useMisCompare();
      seen = p;
      compareSeen = c;
      setPeriod = set;
      setCompare = setC;
      return null;
    }

    const first = render(createElement(Page));
    // Default: the last 30 days, compare on.
    expect((seen as MisPeriod | null)?.preset).toBe('30d');
    expect(spanDays(seen as unknown as MisPeriod)).toBe(30);
    expect(compareSeen).toBe(true);

    const seven = presetPeriod('7d', '2026-11-15');
    act(() => { setPeriod!(seven); setCompare!(false); });
    first.unmount();

    render(createElement(Page));
    expect(seen).toEqual(seven);
    expect(compareSeen).toBe(false);

    act(() => { resetMisPeriod(); });
    expect((seen as MisPeriod | null)?.preset).toBe('30d');
    expect(compareSeen).toBe(true);
  });

  it('fmtIndiaTime_adds_five_and_a_half_hours', () => {
    expect(fmtIndiaTime('2026-11-15T09:02:00Z')).toBe('15 Nov 2026, 2:32 pm India time');
    expect(fmtIndiaTime('2026-11-14T19:00:00Z')).toBe('15 Nov 2026, 12:30 am India time');
    expect(fmtIndiaTime('2026-11-15T06:30:00.0000000Z')).toBe('15 Nov 2026, 12:00 pm India time');
  });
});
