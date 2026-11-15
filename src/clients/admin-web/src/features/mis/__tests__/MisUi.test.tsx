import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CompanyMis } from '@/hooks/useCompanyMis';
import { KpiTile } from '@/features/mis/MisUi';
import { OverviewSection } from '@/features/mis/MisOverview';
import { AcquisitionSection } from '@/features/mis/MisAcquisition';
import { EngagementSection } from '@/features/mis/MisEngagement';
import { RetentionSection } from '@/features/mis/MisRetention';
import { QualitySection } from '@/features/mis/MisQuality';
import { FarmsSection } from '@/features/mis/MisFarms';
import { OperationsSection } from '@/features/mis/MisOperations';
import {
  DAY_LINE_NOT_COUNTED, acquisitionView, engagementView, farmsView, operationsView, overviewView, qualityView, retentionView, tileFrom,
} from '@/features/mis/misView';
import { MIS_ITEMS, MIS_SLOTS } from '@/features/mis/misItems';
import { GHOST } from '@/features/mis/misTheme';
import { farmsBlockedFixture, misFixture, notMeasured, num } from '@/test/misFixture';
import { PLAN_REASONS } from '@/test/misPlan';

/**
 * CR-2b Task 3 — the approved card, tile and chart kit, made honest.
 * Expected behaviour from the plan (Task 3, B2, B3, B4, B9).
 */

const CHECKED = '15 Nov 2026, 2:32 pm India time';
type Section = 'overview' | 'acquisition' | 'engagement' | 'retention' | 'quality' | 'farms' | 'operations';
const SECTIONS: Section[] = ['overview', 'acquisition', 'engagement', 'retention', 'quality', 'farms', 'operations'];

function sectionOf(section: Section, d: CompanyMis, compare: boolean): ReactElement {
  const p = { compare, checkedAt: CHECKED };
  switch (section) {
    case 'overview': return <OverviewSection view={overviewView(d)} {...p} />;
    case 'acquisition': return <AcquisitionSection view={acquisitionView(d)} {...p} />;
    case 'engagement': return <EngagementSection view={engagementView(d)} {...p} />;
    case 'retention': return <RetentionSection view={retentionView(d)} {...p} />;
    case 'quality': return <QualitySection view={qualityView(d)} {...p} />;
    case 'farms': return <FarmsSection view={farmsView(d)} {...p} />;
    case 'operations': return <OperationsSection view={operationsView()} {...p} />;
  }
}

function card(container: HTMLElement, item: string): HTMLElement {
  const el = container.querySelector(`[data-mis-item="${item}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no element for item ${item}`);
  return el;
}

/** The chart CARD of an item (a tile can carry the same item key). */
function chartCard(container: HTMLElement, item: string): HTMLElement {
  const el = container.querySelector(`section[data-mis-item="${item}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no element for item ${item}`);
  return el;
}

/** The points (x, y) of an SVG path "M x,y L x,y ...". */
function points(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

/** Previous-period paths: drawn in the ghost colour. */
function ghostPaths(el: Element): SVGPathElement[] {
  return [...el.querySelectorAll('path')].filter((p) => (p.getAttribute('stroke') ?? '').toLowerCase() === GHOST.toLowerCase()) as SVGPathElement[];
}

/** Current-period line paths: unfilled, not ghost-coloured. */
function linePaths(el: Element): SVGPathElement[] {
  return [...el.querySelectorAll('path')].filter((p) => {
    const stroke = (p.getAttribute('stroke') ?? '').toLowerCase();
    return p.getAttribute('fill') === 'none' && stroke !== '' && stroke !== GHOST.toLowerCase();
  }) as SVGPathElement[];
}

/** y is linear in the value: check the drawn shape against the served values. */
function expectShape(pts: { y: number }[], values: number[]) {
  expect(pts).toHaveLength(values.length);
  const [v0, v1] = [values[0], values[values.length - 1]];
  const [y0, y1] = [pts[0].y, pts[pts.length - 1].y];
  for (let i = 0; i < values.length; i += 1) {
    const expected = y0 + ((values[i] - v0) / (v1 - v0)) * (y1 - y0);
    expect(Math.abs(pts[i].y - expected)).toBeLessThan(0.6);
  }
}

// Wide, uneven made-up day values so the drawn shape can be checked against them.
const CUR = Array.from({ length: 30 }, (_, i) => (i === 2 ? null : 40 + ((i * 37) % 50)));
const PREV = Array.from({ length: 30 }, (_, i) => (i === 7 || i === 8 ? null : 15 + ((i * 53) % 70)));

describe('KpiTile (CR-2b Task 3)', () => {
  it('A_not_measured_tile_shows_the_word_and_the_sentence_and_no_digit', () => {
    const tile = tileFrom('overview.signUps', notMeasured('denominator_zero'), 'count', true);
    const { container } = render(<KpiTile tile={tile} compare />);
    const el = card(container, 'overview.signUps');
    // B18 V5: the label once, the reason sentence, and never "Not measured" twice in the box.
    expect((el.textContent ?? '').match(/not measured/gi) ?? []).toHaveLength(1);
    expect(el.textContent).toContain(PLAN_REASONS.denominator_zero);
    expect(el.textContent).not.toMatch(/\d/);
  });

  it('A_zero_tile_shows_0', () => {
    const tile = tileFrom('overview.signUps', num(0, 0), 'count', true);
    render(<KpiTile tile={tile} compare={false} />);
    expect(screen.getByTestId('kpi-overview.signUps-value').textContent).toBe('0');
  });

  it('Previous_not_measured_is_named', () => {
    const tile = tileFrom('retention.d30', {
      current: { value: 12.7, notMeasuredReason: null },
      previous: { value: null, notMeasuredReason: 'no_complete_window' },
    }, 'pct', true);
    const { container } = render(<KpiTile tile={tile} compare />);
    const el = card(container, 'retention.d30');
    const named = within(el).getByText('Earlier period not measured');
    expect(named.getAttribute('title') ?? '').toContain(PLAN_REASONS.no_complete_window);
    expect(el.textContent).not.toMatch(/no earlier data/i);
    expect(el.textContent).toContain('12.7%');
  });
});

describe('charts and the period before (CR-2b Task 3, B2)', () => {
  it('Charts_draw_the_previous_period_only_from_served_values', () => {
    const d = misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 83.7, CUR, PREV) } });
    const { container } = render(sectionOf('quality', d, true));
    const el = chartCard(container, 'quality.voiceSaved');

    // Current line: two runs around the null day 2.
    const cur = linePaths(el).map((p) => points(p.getAttribute('d') ?? ''));
    expect(cur.map((r) => r.length)).toEqual([2, 27]);
    expectShape([...cur[0], ...cur[1]], CUR.filter((x): x is number => x !== null));

    // Previous line: from previousByDay only, gaps at days 7 and 8, by position.
    const prev = ghostPaths(el).map((p) => points(p.getAttribute('d') ?? ''));
    expect(prev.map((r) => r.length)).toEqual([7, 21]);
    expectShape([...prev[0], ...prev[1]], PREV.filter((x): x is number => x !== null));
    // First day under first day: same x for the same position.
    const xCur = new Map<number, number>();
    [0, 1].forEach((i, k) => xCur.set(i, cur[0][k].x));
    for (let i = 3; i < 30; i += 1) xCur.set(i, cur[1][i - 3].x);
    expect(prev[0][0].x).toBeCloseTo(xCur.get(0)!, 0);
    expect(prev[1][0].x).toBeCloseTo(xCur.get(9)!, 0);
    expect(prev[1][20].x).toBeCloseTo(xCur.get(29)!, 0);

    expect(within(el).getAllByText('Previous period').length).toBeGreaterThan(0);
  });

  it('Charts_draw_the_previous_period_only_from_served_values: the hero line and the return curve', () => {
    const d = misFixture();
    const ov = render(sectionOf('overview', d, true));
    const hero = chartCard(ov.container, 'overview.activeFarms');
    const heroPrev = ghostPaths(hero).map((p) => points(p.getAttribute('d') ?? ''));
    expect(heroPrev.map((r) => r.length)).toEqual([30]);
    ov.unmount();

    const re = render(sectionOf('retention', d, true));
    const curveCard = chartCard(re.container, 'retention.curve');
    const prevCurve = ghostPaths(curveCard).map((p) => points(p.getAttribute('d') ?? ''));
    // previousCurve has a value on days 0..29.
    expect(prevCurve.reduce((s, r) => s + r.length, 0)).toBe(d.retention.previousCurve.filter((c) => c.activePct !== null).length);
    re.unmount();

    // Compare off: nothing from the period before anywhere.
    for (const s of SECTIONS) {
      const v = render(sectionOf(s, d, false));
      expect([s, ghostPaths(v.container).length]).toEqual([s, 0]);
      expect([s, v.container.textContent?.includes('Previous period')]).toEqual([s, false]);
      v.unmount();
    }
  });

  it('A_null_day_is_a_gap_not_a_zero', () => {
    const d = misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 83.7, CUR, null) } });
    const { container } = render(sectionOf('quality', d, false));
    const el = chartCard(container, 'quality.voiceSaved');
    const runs = linePaths(el).map((p) => points(p.getAttribute('d') ?? ''));
    // 29 drawn points, never 30: the null day is not drawn at all, and the line is not joined across it.
    expect(runs.reduce((s, r) => s + r.length, 0)).toBe(29);
    expect(runs).toHaveLength(2);

    // Sparkline: overview stickiness has a null on day 3.
    const ov = render(sectionOf('overview', misFixture(), false));
    const tile = ov.getByTestId('kpi-overview.stickiness');
    const spark = linePaths(tile).map((p) => points(p.getAttribute('d') ?? ''));
    expect(spark.map((r) => r.length)).toEqual([3, 26]);
  });

  it('No_previous_values_means_no_previous_line_or_legend', () => {
    const d = misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 83.7, CUR, null) } });
    const { container } = render(sectionOf('quality', d, true));
    const el = chartCard(container, 'quality.voiceSaved');
    expect(ghostPaths(el)).toHaveLength(0);
    expect(el.textContent).not.toContain('Previous period');

    const noCurve = misFixture({ retention: { previousCurve: [] } });
    const re = render(sectionOf('retention', noCurve, true));
    const curveCard = chartCard(re.container, 'retention.curve');
    expect(ghostPaths(curveCard)).toHaveLength(0);
    expect(curveCard.textContent).not.toContain('Previous period');
    // B2: the old decision-4 sentence is gone.
    expect(re.container.textContent).not.toContain('Comparison changes the numbers only');
  });
});

describe('tables, cohorts and keys (CR-2b Task 3)', () => {
  it('Tables_never_print_a_bare_dash', () => {
    const d = misFixture({
      quality: { voiceRecordingsSavedPct: num(86.1, 83.7, CUR, PREV) },
      engagement: { logsPerActiveFarmPerWeek: num(6.7, 5.9, CUR, PREV) },
    });
    let tables = 0;
    for (const s of SECTIONS) {
      const v = render(sectionOf(s, d, true));
      for (const b of within(v.container).queryAllByRole('button', { name: 'Table' })) fireEvent.click(b);
      for (const cell of v.container.querySelectorAll('td, th')) {
        tables += 1;
        expect([s, (cell.textContent ?? '').trim()]).not.toEqual([s, '-']);
        expect([s, /^[-–—]$/.test((cell.textContent ?? '').trim())]).toEqual([s, false]);
      }
      expect([s, /(^|\s)[-–—](\s|$)/.test(v.container.textContent ?? '')]).toEqual([s, false]);
      v.unmount();
    }
    expect(tables).toBeGreaterThan(50);
  });

  it('Cohort_cells_say_not_yet_or_nobody', () => {
    const { container } = render(sectionOf('retention', misFixture(), false));
    const el = chartCard(container, 'retention.cohorts');
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    for (const h of ['Day 1', 'Day 7', 'Day 14', 'Day 30']) expect(heads).toContain(h);
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    const cells = (r: Element) => [...r.querySelectorAll('td')].map((td) => td.textContent?.trim());
    // Week of 19 Oct: 74 people, day 1/7/14 counted, day 30 not passed yet.
    expect(cells(rows[0])).toEqual(['74', '41.9%', '27.4%', '18.6%', 'not yet']);
    // Week of 2 Nov: nobody signed up.
    expect(cells(rows[2])).toEqual(['0', 'nobody', 'nobody', 'nobody', 'nobody']);
    expect(cells(rows[3])).toEqual(['58', '34.5%', 'not yet', 'not yet', 'not yet']);
  });

  it('Every_tile_and_card_carries_its_item_key', () => {
    const keys = new Set([...MIS_ITEMS.map((i) => i.key), ...MIS_SLOTS.map((s) => s.key)]);
    for (const s of SECTIONS) {
      const v = render(sectionOf(s, misFixture(), true));
      const roots = [
        // The strip that holds the tiles is a panel, not a tile or card: its tiles carry the keys.
        ...[...v.container.querySelectorAll('section')].filter((e) => e.querySelector('[data-testid^="kpi-"]') === null),
        ...[...v.container.querySelectorAll('[data-testid^="kpi-"]')].filter((e) => !(e.getAttribute('data-testid') ?? '').endsWith('-value')),
      ];
      expect([s, roots.length > 0]).toEqual([s, true]);
      for (const r of roots) {
        const key = r.getAttribute('data-mis-item');
        expect([s, key !== null && keys.has(key)]).toEqual([s, true]);
      }
      for (const e of v.container.querySelectorAll('[data-mis-item]')) {
        expect([s, keys.has(e.getAttribute('data-mis-item')!)]).toEqual([s, true]);
      }
      v.unmount();
    }
  });
});

describe('the funnel (CR-2b Task 3, B9)', () => {
  function steps(d: CompanyMis) {
    const v = render(sectionOf('acquisition', d, false));
    const list = v.container.querySelector('ol') as HTMLOListElement;
    expect(list).not.toBeNull();
    return { v, items: [...list.querySelectorAll(':scope > li')] as HTMLElement[] };
  }

  it('Funnel_steps_are_numbered', () => {
    const { items } = steps(misFixture());
    expect(items).toHaveLength(5);
    items.forEach((li, k) => {
      const marker = [...li.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent?.trim() === String(k + 1));
      expect.soft([k + 1, marker !== undefined]).toEqual([k + 1, true]);
    });
  });

  it('Did_not_continue_is_shown_only_between_two_measured_steps_on_one_base', () => {
    // verified 271 -> has farm 214 -> first entry 167; habit 61 of 139 (another base).
    {
      const { v } = steps(misFixture());
      const lines = (v.container.textContent ?? '').match(/\d+% did not continue/g) ?? [];
      // (271 - 214) / 271 = 21.0%; (214 - 167) / 214 = 22.0%. None after the unmeasured
      // installs step, none into the habit step.
      expect.soft(lines).toEqual(['21% did not continue', '22% did not continue']);
      v.unmount();
    }
    {
      // A step not measured: no line on either side of it.
      const { v } = steps(misFixture({ acquisition: { hasFarm: notMeasured('farm_list_unreadable') } }));
      expect.soft(v.container.textContent ?? '').not.toMatch(/did not continue/);
      v.unmount();
    }
    {
      // An earlier step of 0: nothing to divide by.
      const { v } = steps(misFixture({ acquisition: { verified: num(0, 0), hasFarm: num(0, 0), firstLog: num(0, 0) } }));
      expect.soft(v.container.textContent ?? '').not.toMatch(/did not continue/);
      v.unmount();
    }
  });
});

describe('empty charts and the habit step (CR-2b B12, B14)', () => {
  it('A_chart_with_no_measured_day_shows_the_reason_not_empty_axes', () => {
    const allNull = Array(30).fill(null) as null[];
    const cases: [Section, string, CompanyMis, string][] = [
      // A measured number whose every day is null: the card says why, it draws no axes.
      ['quality', 'quality.voiceSaved',
        misFixture({ quality: { voiceRecordingsSavedPct: { ...notMeasured('denominator_zero'), currentByDay: allNull, previousByDay: allNull } } }),
        'No voice recording was made in this period.'], // B11: the number's own reason
      ['quality', 'quality.transcriptionAvg',
        misFixture({ quality: {
          transcriptionAvgMs: { ...notMeasured('no_samples'), currentByDay: allNull, previousByDay: allNull },
          transcriptionP95Ms: { ...notMeasured('no_samples'), currentByDay: allNull, previousByDay: allNull },
        } }),
        PLAN_REASONS.no_samples],
      // B18 V3: the reason shown is this number's own (B11 sentence), not only the panel title.
      ['engagement', 'engagement.logsPerFarm',
        misFixture({ engagement: { logsPerActiveFarmPerWeek: { ...notMeasured('denominator_zero'), currentByDay: allNull, previousByDay: allNull } } }),
        'No farm was active in the last 7 days.'],
      // A measured range figure whose every day is null still draws no empty axes.
      ['engagement', 'engagement.logsPerFarm',
        misFixture({ engagement: { logsPerActiveFarmPerWeek: { ...num(6.7, 5.9), currentByDay: allNull, previousByDay: allNull } } }),
        'Not measured'],
    ];
    for (const [s, item, d, words] of cases) {
      const v = render(sectionOf(s, d, true));
      const el = chartCard(v.container, item);
      expect.soft([item, el.querySelectorAll('svg[role="img"] text').length]).toEqual([item, 0]);
      expect.soft([item, linePaths(el).length + ghostPaths(el).length]).toEqual([item, 0]);
      expect.soft([item, words, (el.textContent ?? '').includes(words)]).toEqual([item, words, true]);
      // V3: "a day-by-day line is not counted yet" is only for a number with no day list at all.
      expect.soft([item, (el.textContent ?? '').includes(DAY_LINE_NOT_COUNTED)]).toEqual([item, false]);
      v.unmount();
    }
  });

  it('No_day_list_keeps_its_sentence_and_an_all_null_previous_draws_no_legend', () => {
    // V3: a number with no day list at all keeps "A day-by-day line is not counted yet. ..."
    const none = misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 83.7) } });
    const a = render(sectionOf('quality', none, true));
    expect(chartCard(a.container, 'quality.voiceSaved').textContent).toContain(DAY_LINE_NOT_COUNTED);
    a.unmount();
    // V3: a previous list that is all null draws no previous line and no "Previous period" legend.
    const prevNull = misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 83.7, CUR, Array(30).fill(null)) } });
    const b = render(sectionOf('quality', prevNull, true));
    const el = chartCard(b.container, 'quality.voiceSaved');
    expect(ghostPaths(el)).toHaveLength(0);
    expect(el.textContent).not.toContain('Previous period');
    b.unmount();
    // The return curve: every point null -> the number's own reason, no axes.
    const flatCurve = misFixture({
      retention: {
        d1Pct: notMeasured('no_complete_window'),
        curve: Array.from({ length: 31 }, (_, day) => ({ day, activePct: null, eligible: 0 })),
        previousCurve: Array.from({ length: 31 }, (_, day) => ({ day, activePct: null, eligible: 0 })),
      },
    });
    const c = render(sectionOf('retention', flatCurve, true));
    const curve = chartCard(c.container, 'retention.curve');
    expect(curve.querySelectorAll('svg[role="img"] text').length).toBe(0);
    expect(curve.textContent).toContain(PLAN_REASONS.no_complete_window);
    expect(curve.textContent).not.toContain(DAY_LINE_NOT_COUNTED);
    expect(curve.textContent).not.toContain('Previous period');
    c.unmount();
  });

  it('Blocked_farm_numbers_never_say_nobody', () => {
    // V1: blocked farm numbers send curve and cohortByWeek empty while sign-ups stay measured.
    for (const code of ['farm_list_unreadable', 'too_many_farms_for_live_count']) {
      const v = render(sectionOf('retention', farmsBlockedFixture(code), true));
      for (const item of ['retention.curve', 'retention.cohorts']) {
        const el = chartCard(v.container, item);
        expect.soft([code, item, (el.textContent ?? '').includes(PLAN_REASONS[code])]).toEqual([code, item, true]);
        expect.soft([code, item, /No one verified a phone in this range/.test(el.textContent ?? '')]).toEqual([code, item, false]);
        expect.soft([code, item, /No sign-up week starts inside this range/.test(el.textContent ?? '')]).toEqual([code, item, false]);
        expect.soft([code, item, /measured zero/i.test(el.textContent ?? '')]).toEqual([code, item, false]);
      }
      v.unmount();
    }
    // Readable farm numbers and truly nobody: the "nobody" wording is right.
    const nobody = misFixture({
      overview: { signUps: num(0, 0, Array(30).fill(0), Array(30).fill(0)) },
      acquisition: { verified: num(0, 0) },
      retention: { d1Pct: notMeasured('no_complete_window'), d30Pct: notMeasured('no_complete_window'), curve: [], previousCurve: [], cohortByWeek: [] },
    });
    const r = render(sectionOf('retention', nobody, true));
    expect(chartCard(r.container, 'retention.curve').textContent).toContain('No one verified a phone in this range');
    expect(chartCard(r.container, 'retention.cohorts').textContent).toContain('No sign-up week starts inside this range');
    r.unmount();
  });

  it('The_cohort_scale_top_is_the_largest_cell_rounded_up_to_ten', () => {
    // V4: fixture's largest cell is 41.9 -> 50%; a largest cell of 73 -> 80%.
    const legendTop = (d: CompanyMis) => {
      const v = render(sectionOf('retention', d, false));
      const text = chartCard(v.container, 'retention.cohorts').textContent ?? '';
      v.unmount();
      return text;
    };
    expect(legendTop(misFixture())).toContain('50%');
    const big = misFixture({
      retention: {
        cohortByWeek: [
          { weekStart: '2026-10-19', people: 74, activePctByWeek: [44.6, 31.1, 24.3, null], activePctOnDays: [73, 27.4, 18.6, null] },
        ],
      },
    });
    const t = legendTop(big);
    expect(t).toContain('80%');
    expect(t).not.toContain('60%');
  });

  it('Cohort_titles_and_the_first_band_follow_the_review', () => {
    const v = render(sectionOf('retention', misFixture(), true));
    // V5: a day that has not passed.
    const notYet = [...chartCard(v.container, 'retention.cohorts').querySelectorAll('td')].filter((td) => td.textContent?.trim() === 'not yet');
    expect(notYet.length).toBeGreaterThan(0);
    for (const td of notYet) expect(td.getAttribute('title')).toBe('This day has not passed yet');
    // V5: the first band (saved in the last 7 days, 404 vs 371: +8.9%) shows its change like the others.
    const bands = chartCard(v.container, 'retention.bands');
    const first = [...bands.querySelectorAll('li')].find((li) => (li.textContent ?? '').includes('Saved in the last 7 days'));
    expect(first).toBeDefined();
    expect(first!.textContent).toMatch(/\+8\.9%/);
    // Control: the second band (silent 7–13 days, 66 -> 73: +10.6%) shows its change.
    const second = [...bands.querySelectorAll('li')].find((li) => (li.textContent ?? '').includes('Silent 7–13 days'));
    expect(second?.textContent).toMatch(/\+10\.6%/);
    v.unmount();
  });

  it('Habit_with_nobody_eligible_shows_no_bar_and_no_count', () => {
    const d = misFixture({ acquisition: { habit: num(0, 0), habitEligible: num(0, 0) } });
    const v = render(sectionOf('acquisition', d, true));
    // The habit step: the funnel row that holds the habit item.
    const li = (v.container.querySelector('ol [data-mis-item="acquisition.habit"]')?.closest('li') ?? null) as HTMLElement | null;
    expect(li).not.toBeNull();
    const text = li!.textContent ?? '';
    expect(text).toContain('Nobody who signed up in this range is 7 days in yet');
    // No count: the only digit allowed is the step number 5 (B9).
    const marker = [...li!.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent?.trim() === '5');
    // The step's label and the B14 sentence carry plan wording with digits, not counts.
    const rest = text
      .replace(marker?.textContent ?? '', '')
      .replace(/3 of (their )?first 7 days/g, '')
      .replace('Nobody who signed up in this range is 7 days in yet', '');
    expect(rest).not.toMatch(/\d/);
    // No bar: nothing inside the step is drawn with a width.
    const bars = [...li!.querySelectorAll<HTMLElement>('[style]')].filter((e) => {
      const w = e.style.width;
      return w !== '' && Number.parseFloat(w) > 0;
    });
    expect(bars).toEqual([]);
    // And no "did not continue" line into it.
    expect(text).not.toMatch(/did not continue/);
  });
});
