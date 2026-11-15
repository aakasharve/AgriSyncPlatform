import { createElement } from 'react';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CompanyMis, MisNumber } from '@/hooks/useCompanyMis';
import {
  COHORT_DAYS, acquisitionView, deltaOf, engagementView, farmsView, headlineFor, heatGrid, newFarmsOf,
  overviewView, qualityView, retentionView, roleName, shownOf, tileFrom, type MisTileModel,
} from '@/features/mis/misView';
import { RetentionSection } from '@/features/mis/MisRetention';
import { EngagementSection } from '@/features/mis/MisEngagement';
import { reasonSentence } from '@/features/mis/misItems';
import { BUSIEST, at, farmsBlockedFixture, misFixture, notMeasured, num } from '@/test/misFixture';
import { PLAN_REASONS, S_OPS_HEADLINE } from '@/test/misPlan';

/**
 * CR-2b Task 2 — the pure adapter between the route's answer and the pages.
 * Expected values come from the fixture and the plan's stated rules (Task 2
 * "Rules the adapter owns", B3, B4, B8), never from what the code prints.
 */

const v = (value: number | null, code: string | null = null) => ({ value, notMeasuredReason: value === null ? code : null });

function tilesOf(d: CompanyMis): MisTileModel[] {
  return [
    ...overviewView(d).tiles,
    ...retentionView(d).tiles,
    ...qualityView(d).tiles,
    ...farmsView(d).tiles,
  ];
}

function tileOf(tiles: MisTileModel[], item: string): MisTileModel {
  const t = tiles.find((x) => x.item === item);
  if (!t) throw new Error(`no tile for ${item}; tiles: ${tiles.map((x) => x.item).join(', ')}`);
  return t;
}

describe('misView: values and absences (CR-2b Task 2)', () => {
  it('A_measured_zero_prints_0_and_a_null_prints_its_reason', () => {
    expect(shownOf(v(0), 'count')).toEqual({ kind: 'value', value: 0, text: '0' });
    expect(shownOf(v(0), 'pct')).toEqual({ kind: 'value', value: 0, text: '0%' });
    for (const [code, sentence] of Object.entries(PLAN_REASONS)) {
      expect(shownOf(v(null, code), 'count')).toEqual({ kind: 'notMeasured', why: `Not measured: ${sentence}` });
    }
    expect(shownOf(v(null, 'brand_new_code'), 'ms')).toEqual({
      kind: 'notMeasured',
      why: 'Not measured: The server gave a reason this page does not know yet.',
    });

    // Through a whole page: a measured zero tile prints 0.
    const d = misFixture({ overview: { signUps: num(0, 0, Array(30).fill(0), Array(30).fill(0)) } });
    const t = tileOf(overviewView(d).tiles, 'overview.signUps');
    expect(t.current).toEqual({ kind: 'value', value: 0, text: '0' });
  });

  it('Percent_fields_are_already_percent', () => {
    expect(shownOf(v(42.5), 'pct')).toMatchObject({ kind: 'value', value: 42.5, text: '42.5%' });
    expect(shownOf(v(100), 'pct')).toMatchObject({ text: '100%' });
    const voice = tileOf(overviewView(misFixture()).tiles, 'overview.voiceShare');
    expect(voice.current).toMatchObject({ kind: 'value', text: '42.5%' });
    expect(JSON.stringify(voice)).not.toContain('4250');
    const stick = tileOf(overviewView(misFixture()).tiles, 'overview.stickiness');
    expect(stick.current).toMatchObject({ text: '24.4%' });
    const d1 = tileOf(retentionView(misFixture()).tiles, 'retention.d1');
    expect(d1.current).toMatchObject({ text: '38.6%' });
  });

  it('A_previous_measured_zero_is_a_real_comparison', () => {
    const up = deltaOf(num(5, 0), 'count', true);
    expect(up).toEqual({ text: 'up from 0', good: true });
    const flat = deltaOf(num(0, 0), 'count', true);
    expect(flat).not.toBeNull();
    expect(flat && 'text' in flat ? flat.text : '').toBe('no change');
    expect(JSON.stringify(up)).not.toMatch(/no earlier/i);
    // On a tile with compare: the previous is a real 0.
    const t = tileFrom('overview.signUps', num(5, 0), 'count', true);
    expect(t.previous).toEqual({ kind: 'value', value: 0, text: '0' });
  });

  it('A_previous_not_measured_says_so', () => {
    const d = deltaOf({ current: v(12.7), previous: v(null, 'no_complete_window') }, 'pct', true);
    expect(d).not.toBeNull();
    expect(d && 'previousNotMeasured' in d).toBe(true);
    expect((d as { previousNotMeasured: string }).previousNotMeasured).toContain(PLAN_REASONS.no_complete_window);
    // Current not measured: nothing to compare.
    expect(deltaOf({ current: v(null, 'no_samples'), previous: v(2340) }, 'ms', false)).toBeNull();
  });

  it('Points_not_percent_for_shares', () => {
    expect(deltaOf(num(42.5, 40), 'pct', true)).toEqual({ text: '+2.5 pts', good: true });
    const down = deltaOf(num(40, 42.5), 'pct', true);
    expect(down && 'text' in down ? down.good : null).toBe(false);
    expect(down && 'text' in down ? down.text : '').toMatch(/^[−-]2\.5 pts$/);
    // Counts: the signed relative change. 377 -> 412 is +9.28%.
    const rel = deltaOf(num(412, 377), 'count', true);
    expect(rel && 'text' in rel ? rel.text : '').toMatch(/^\+9(\.3)?%$/);
    expect(rel && 'text' in rel ? rel.good : null).toBe(true);
    // Lower is better for times: slower is bad news.
    const slower = deltaOf(num(2610, 2340), 'ms', false);
    expect(slower && 'text' in slower ? slower.good : null).toBe(false);
  });

  it('A_tile_has_a_sparkline_exactly_when_its_number_carries_day_values', () => {
    // The adapter alone.
    const withDays = tileFrom('overview.dau', num(3, 2, [1, null, 3], [2, 2, 2]), 'count', true);
    expect(withDays.spark).toEqual([1, null, 3]);
    expect(tileFrom('overview.dau', num(3, 2), 'count', true).spark).toBeNull();

    // Every tile on every page, against the fixture.
    const d = misFixture();
    const tiles = tilesOf(d);
    expect(tiles.length).toBeGreaterThan(10);
    for (const t of tiles) {
      const field = t.fields[0];
      const n = field ? (at(d, field) as MisNumber | undefined) : undefined;
      const days = n && typeof n === 'object' && 'current' in n ? n.currentByDay ?? null : null;
      expect([t.item, t.spark]).toEqual([t.item, days]);
    }
    // And the sparkline goes when the day values go.
    const noDays = misFixture({ overview: { wau: num(356, 318) } });
    expect(tileOf(overviewView(noDays).tiles, 'overview.wau').spark).toBeNull();
  });

  it('New_farms_is_the_difference_or_not_measured', () => {
    expect(newFarmsOf(num(774, 699))).toMatchObject({ kind: 'value', value: 75, text: '75' });
    expect(newFarmsOf(num(5, 5))).toMatchObject({ kind: 'value', value: 0, text: '0' });
    expect(newFarmsOf({ current: v(774), previous: v(null, 'farm_list_unreadable') }).kind).toBe('notMeasured');
    expect(overviewView(misFixture()).hero.newFarms).toMatchObject({ kind: 'value', value: 75 });
    expect(overviewView(misFixture()).hero.registered).toMatchObject({ kind: 'value', text: '774' });
    expect(overviewView(misFixture()).hero.current).toMatchObject({ kind: 'value', text: '412' });
  });

  it('Farm_list_unreadable_reaches_every_farm_tile_but_not_sign_ups', () => {
    const d = farmsBlockedFixture();
    const why = `Not measured: ${PLAN_REASONS.farm_list_unreadable}`;
    const ov = overviewView(d);
    expect(ov.hero.current).toEqual({ kind: 'notMeasured', why });
    expect(tileOf(ov.tiles, 'overview.signUps').current).toMatchObject({ kind: 'value', text: '268' });
    for (const key of ['overview.dau', 'overview.wau', 'overview.mau', 'overview.stickiness', 'overview.logsRecorded', 'overview.voiceShare']) {
      expect([key, tileOf(ov.tiles, key).current]).toEqual([key, { kind: 'notMeasured', why }]);
      expect([key, tileOf(ov.tiles, key).spark]).toEqual([key, null]);
    }
    for (const t of [...farmsView(d).tiles, ...qualityView(d).tiles].filter((x) => x.fields.length > 0)) {
      expect([t.item, t.current]).toEqual([t.item, { kind: 'notMeasured', why }]);
    }
    for (const t of retentionView(d).tiles.filter((x) => x.fields.length > 0)) {
      expect([t.item, t.current]).toEqual([t.item, { kind: 'notMeasured', why }]);
    }
    // Acquisition: verified stays measured, the rest is not.
    const steps = acquisitionView(d).steps;
    const verified = steps.find((s) => s.fields.includes('acquisition.verified'));
    expect(verified?.current).toMatchObject({ kind: 'value', text: '271' });
    const firstLog = steps.find((s) => s.fields.includes('acquisition.firstLog'));
    expect(firstLog?.current).toEqual({ kind: 'notMeasured', why });
  });

  it('Heatmap_is_monday_first_and_keeps_every_cell', () => {
    const d = misFixture();
    const cells = [...d.engagement.whenLogged].reverse(); // order must not matter
    const { grid, max } = heatGrid(cells);
    expect(grid).toHaveLength(7);
    for (const row of grid) expect(row).toHaveLength(24);
    for (const c of cells) expect(grid[c.weekday - 1][c.hour]).toBe(c.logs);
    expect(grid[BUSIEST.weekday - 1][BUSIEST.hour]).toBe(97);
    expect(max).toBe(97);
    const total = (g: number[][]) => g.flat().reduce((s, x) => s + x, 0);
    expect(total(grid)).toBe(cells.reduce((s, c) => s + c.logs, 0));
  });

  it('Cohort_null_is_not_yet_and_zero_people_is_nobody', () => {
    expect([...COHORT_DAYS]).toEqual([1, 7, 14, 30]);
    const r = retentionView(misFixture());
    expect(r.cohorts.kind).toBe('chart');
    const rows = r.cohorts.kind === 'chart' ? r.cohorts.data.rows : [];
    const d = misFixture();
    expect(rows.map((x) => x.weekStart)).toEqual(d.retention.cohortByWeek.map((x) => x.weekStart));
    for (const [k, row] of rows.entries()) {
      expect(row.people).toBe(d.retention.cohortByWeek[k].people);
      // B4: the cells are day 1/7/14/30, null kept (never 0).
      expect(row.cells).toEqual(d.retention.cohortByWeek[k].activePctOnDays);
    }
    expect(rows[2].people).toBe(0);
  });

  it('Role_names_are_plain_and_unknown_is_named', () => {
    const plan: Record<string, string> = {
      PrimaryOwner: 'Owner',
      SecondaryOwner: 'Co-owner',
      Mukadam: 'Mukadam',
      Worker: 'Worker',
      Agronomist: 'Agronomist',
      Consultant: 'Consultant',
      FpcTechnicalManager: 'FPC technical manager',
      FieldScout: 'Field scout',
      LabOperator: 'Lab operator',
      Unknown: 'No role on that farm',
      SomethingNew: 'SomethingNew',
    };
    for (const [role, label] of Object.entries(plan)) expect([role, roleName(role)]).toEqual([role, label]);
  });

  it('Band_and_role_shares_are_count_over_served_total_or_absent', () => {
    // B8: share = count / sum of the served counts x 100, one decimal, half away from zero.
    // Bands: 404, 73, 52, 96, 149 of 774.
    const bandsCard = (d: CompanyMis) => {
      const view = render(createElement(RetentionSection, { view: retentionView(d), compare: false, checkedAt: '15 Nov 2026, 2:32 pm India time' }));
      const el = view.container.querySelector('[data-mis-item="retention.bands"]') as HTMLElement;
      expect(el).not.toBeNull();
      return { el, view };
    };
    {
      const { el, view } = bandsCard(misFixture());
      for (const share of ['52.2%', '9.4%', '6.7%', '12.4%', '19.3%']) {
        expect.soft([share, within(el).queryAllByText((_, n) => n?.textContent?.trim() === share).length > 0]).toEqual([share, true]);
      }
      view.unmount();
    }
    {
      // One band not measured: no share anywhere in the card; its reason stands.
      const { el, view } = bandsCard(misFixture({ retention: { quietFarms7To13: notMeasured('denominator_zero') } }));
      expect.soft(el.textContent ?? '').not.toMatch(/\d%/);
      expect.soft(el.textContent ?? '').toContain(reasonSentence('denominator_zero'));
      view.unmount();
    }
    {
      // Every band a measured 0: the sum is 0, so no share; the counts stand as 0.
      const zero = num(0, 0);
      const { el, view } = bandsCard(misFixture({
        retention: {
          activeFarms0To6: zero, quietFarms7To13: zero, quietFarms14To29: zero, quietFarms7To29: zero,
          silentFarms30Plus: zero, neverLoggedFarms: zero,
        },
      }));
      expect.soft(el.textContent ?? '').not.toMatch(/\d%/);
      view.unmount();
    }

    // Roles: 233, 87, 64, 158, 45 of 587.
    const rolesCard = (d: CompanyMis) => {
      const view = render(createElement(EngagementSection, { view: engagementView(d), compare: false, checkedAt: '15 Nov 2026, 2:32 pm India time' }));
      const el = view.container.querySelector('[data-mis-item="engagement.roleMix"]') as HTMLElement;
      expect(el).not.toBeNull();
      return { el, view };
    };
    {
      const { el, view } = rolesCard(misFixture());
      for (const share of ['39.7%', '14.8%', '10.9%', '26.9%', '7.7%']) {
        expect.soft([share, within(el).queryAllByText((_, n) => n?.textContent?.trim() === share).length > 0]).toEqual([share, true]);
      }
      view.unmount();
    }
    {
      const { el, view } = rolesCard(misFixture({
        engagement: { roleMixOfMau: [{ role: 'PrimaryOwner', people: 0 }, { role: 'Worker', people: 0 }] },
      }));
      expect.soft(el.textContent ?? '').not.toMatch(/\d%/);
      view.unmount();
    }
  });
});

describe('misView: headlines (CR-2b Task 2)', () => {
  const d = misFixture();

  it('Headlines_use_real_numbers_or_say_not_measured: overview', () => {
    expect(headlineFor('overview', d, false)).toMatch(
      /^412 farms saved an entry in the 7 days to 15 Nov( 2026)?\. Voice made 42\.5% of the 913 entries in this range\.$/,
    );
    const nm = headlineFor('overview', misFixture({ overview: { activeFarms: notMeasured('farm_list_unreadable') } }), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.farm_list_unreadable}`);
    expect(nm).not.toContain('412');
    expect(nm).toContain('42.5%');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: acquisition', () => {
    expect(headlineFor('acquisition', d, false)).toBe(
      '271 people verified their phone. 61 of 139 old enough to judge saved entries on 3 of their first 7 days. Installs and channels are not measured yet.',
    );
    const nm = headlineFor('acquisition', misFixture({ acquisition: { habit: notMeasured('no_complete_window'), habitEligible: notMeasured('no_complete_window') } }), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.no_complete_window}`);
    expect(nm).toContain('271 people verified their phone');
    expect(nm).toContain('Installs and channels are not measured yet.');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: engagement', () => {
    expect(headlineFor('engagement', d, false)).toBe(
      'An active farm saved 6.7 entries a week. The busiest hour is 7 pm on Wednesdays (when entries reached the server).',
    );
    const nm = headlineFor('engagement', misFixture({ engagement: { logsPerActiveFarmPerWeek: notMeasured('denominator_zero') } }), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.denominator_zero}`);
    expect(nm).not.toContain('6.7');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: retention', () => {
    expect(headlineFor('retention', d, false)).toBe(
      '38.6% of new sign-ups came back the next day and 12.7% were active on day 30. 125 farms have gone quiet for 7–29 days and can still be won back.',
    );
    const nm = headlineFor('retention', misFixture({ retention: { d30Pct: notMeasured('no_complete_window') } }), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.no_complete_window}`);
    expect(nm).toContain('38.6%');
    expect(nm).not.toContain('12.7');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: quality', () => {
    expect(headlineFor('quality', d, false)).toBe(
      '86.1% of voice recordings became a saved entry. Farmers corrected 8.7% of saved entries.',
    );
    const nm = headlineFor('quality', misFixture({ quality: { voiceRecordingsSavedPct: notMeasured('denominator_zero') } }), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.denominator_zero}`);
    expect(nm).toContain('8.7%');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: farms', () => {
    expect(headlineFor('farms', d, false)).toBe('415 active farms covering 963.4 acres. Districts are not measured yet.');
    const nm = headlineFor('farms', farmsBlockedFixture(), false);
    expect(nm).toContain(`is not measured: ${PLAN_REASONS.farm_list_unreadable}`);
    expect(nm).not.toMatch(/\d/);
  });

  it('Headlines_use_real_numbers_or_say_not_measured: operations', () => {
    expect(headlineFor('operations', d, false)).toBe(S_OPS_HEADLINE);
    expect(headlineFor('operations', null, true)).toBe(S_OPS_HEADLINE);
  });

  it('Compare_off_headlines_carry_no_change_clause', () => {
    for (const section of ['overview', 'acquisition', 'engagement', 'quality'] as const) {
      const on = headlineFor(section, d, true);
      const off = headlineFor(section, d, false);
      expect([section, on === off]).toEqual([section, false]);
      expect(on.length).toBeGreaterThan(off.length);
    }
    // The change clause carries the served comparison: 377 -> 412 is +9.3%.
    expect(headlineFor('overview', d, true)).toMatch(/9(\.3)?%/);
    expect(headlineFor('overview', d, false)).not.toMatch(/9\.3%|377/);
    // Previous not measured: no change clause even with compare on.
    const noPrev = misFixture({ overview: { activeFarms: { ...num(412, 0), previous: v(null, 'farm_list_unreadable') } } });
    expect(headlineFor('overview', noPrev, true)).toBe(headlineFor('overview', noPrev, false));
  });
});
