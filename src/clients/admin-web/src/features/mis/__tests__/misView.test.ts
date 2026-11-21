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
import { BUSIEST, at, farmsBlockedFixture, misFixture, notMeasured, num, ramp } from '@/test/misFixture';
import { PLAN_REASONS, S_DISTRICT, S_OPS_HEADLINE } from '@/test/misPlan';

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

/** A not-measured value: its reason sentence, without a second "Not measured:" in front (B18 V5). */
function expectReason(shown: { kind: string; why?: string }, sentence: string, label = '') {
  expect([label, shown.kind]).toEqual([label, 'notMeasured']);
  const why = shown.why ?? '';
  expect([label, why.includes(sentence)]).toEqual([label, true]);
  expect([label, /not measured/i.test(why)]).toEqual([label, false]);
}

describe('misView: values and absences (CR-2b Task 2)', () => {
  it('A_measured_zero_prints_0_and_a_null_prints_its_reason', () => {
    expect(shownOf(v(0), 'count')).toEqual({ kind: 'value', value: 0, text: '0' });
    expect(shownOf(v(0), 'pct')).toEqual({ kind: 'value', value: 0, text: '0%' });
    // B18 V5: the box carries the label "Not measured"; the sentence does not repeat it.
    for (const [code, sentence] of Object.entries(PLAN_REASONS)) {
      expectReason(shownOf(v(null, code), 'count'), sentence);
    }
    expectReason(shownOf(v(null, 'brand_new_code'), 'ms'), 'The server gave a reason this page does not know yet.');

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
    const why = PLAN_REASONS.farm_list_unreadable;
    const ov = overviewView(d);
    expectReason(ov.hero.current, why);
    expect(tileOf(ov.tiles, 'overview.signUps').current).toMatchObject({ kind: 'value', text: '268' });
    for (const key of ['overview.dau', 'overview.wau', 'overview.mau', 'overview.stickiness', 'overview.logsRecorded', 'overview.voiceShare']) {
      expectReason(tileOf(ov.tiles, key).current, why, key);
      expect([key, tileOf(ov.tiles, key).spark]).toEqual([key, null]);
    }
    // CR-2c Global Constraints ("Farm block"): the block reaches every farm-derived item, not the two
    // non-farm reads; sync failures (#47) are read for the whole server, so their tile stays measured.
    const NOT_PER_FARM = new Set(['quality.syncFailTile']);
    const blockedTiles = [...farmsView(d).tiles, ...qualityView(d).tiles].filter((x) => x.fields.length > 0);
    expect(blockedTiles.filter((t) => !NOT_PER_FARM.has(t.item)).length).toBeGreaterThan(5);
    for (const t of blockedTiles) {
      if (NOT_PER_FARM.has(t.item)) continue;
      expectReason(t.current, why, t.item);
    }
    const sync = tileOf(qualityView(d).tiles, 'quality.syncFailTile');
    expect(sync.current).toMatchObject({ kind: 'value', text: '3.4%' });
    // #10 is farm-derived: the understanding tile is blocked with the rest.
    expectReason(tileOf(ov.tiles, 'overview.understanding').current, why, 'overview.understanding');
    for (const t of retentionView(d).tiles.filter((x) => x.fields.length > 0)) {
      expectReason(t.current, why, t.item);
    }
    // Acquisition: verified stays measured, the rest is not.
    const steps = acquisitionView(d).steps;
    const verified = steps.find((s) => s.fields.includes('acquisition.verified'));
    expect(verified?.current).toMatchObject({ kind: 'value', text: '271' });
    const firstLog = steps.find((s) => s.fields.includes('acquisition.firstLog'));
    expectReason(firstLog!.current, why, 'acquisition.firstLog');
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
      '271 people verified their phone. 61 of 139 old enough to judge had entries reach the server on 3 of their first 7 days. Installs and channels are not measured yet.',
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
    // B11: nothing to divide by is said in this item's own terms.
    expect(nm).toContain('is not measured: No farm was active in the last 7 days.');
    expect(nm).not.toContain(PLAN_REASONS.denominator_zero);
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
    // B11: nothing to divide by is said in this item's own terms.
    expect(nm).toContain('is not measured: No voice recording was made in this period.');
    expect(nm).not.toContain(PLAN_REASONS.denominator_zero);
    expect(nm).toContain('8.7%');
  });

  it('Headlines_use_real_numbers_or_say_not_measured: farms', () => {
    // CR-2c Task 2 Step 3: #62's district clause stays "not measured yet" and names its blocker (S_DISTRICT).
    expect(headlineFor('farms', d, false)).toBe(`415 active farms covering 963.4 acres. Districts are not measured yet. ${S_DISTRICT}`);
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

describe('misView: plain words (CR-2b B11, B13)', () => {
  const dz = notMeasured('denominator_zero');

  it('Nothing_to_divide_by_is_said_in_plain_terms_per_item', () => {
    const whyOf = (s: { kind: string; why?: string }) => (s.kind === 'notMeasured' ? s.why ?? '' : '');
    const cases: [string, string, string][] = [
      ['overview.voiceShare', 'No entry was saved in this period.',
        whyOf(tileOf(overviewView(misFixture({ overview: { voiceSharePct: dz } })).tiles, 'overview.voiceShare').current)],
      ['quality.corrected', 'No entry was saved in this period.',
        whyOf(tileOf(qualityView(misFixture({ quality: { logsCorrectedPct: dz } })).tiles, 'quality.corrected').current)],
      ['quality.voiceSaved', 'No voice recording was made in this period.',
        whyOf(tileOf(qualityView(misFixture({ quality: { voiceRecordingsSavedPct: dz } })).tiles, 'quality.voiceSaved').current)],
      ['overview.stickiness', 'Nobody saved an entry in the last 30 days.',
        whyOf(tileOf(overviewView(misFixture({ overview: { stickinessPct: dz } })).tiles, 'overview.stickiness').current)],
      ['farms.inFpo', 'No farm was active in the last 7 days.',
        whyOf(tileOf(farmsView(misFixture({ farms: { activeFarmsInFpoPct: dz } })).tiles, 'farms.inFpo').current)],
      ['engagement.logsPerFarm', 'No farm was active in the last 7 days.',
        (() => { const c = engagementView(misFixture({ engagement: { logsPerActiveFarmPerWeek: dz } })).perFarm; return c.kind === 'notMeasured' ? c.why : ''; })()],
    ];
    for (const [item, sentence, why] of cases) {
      expect.soft([item, why.includes(sentence)]).toEqual([item, true]);
      expect.soft([item, why.includes(PLAN_REASONS.denominator_zero)]).toEqual([item, false]);
    }
    // The generic sentence stays the fall-back for every other item.
    const d1 = tileOf(retentionView(misFixture({ retention: { d1Pct: dz } })).tiles, 'retention.d1').current;
    expect(whyOf(d1)).toContain(PLAN_REASONS.denominator_zero);
    // Other reasons are untouched by B11.
    const other = tileOf(overviewView(misFixture({ overview: { voiceSharePct: notMeasured('farm_list_unreadable') } })).tiles, 'overview.voiceShare').current;
    expect(whyOf(other)).toContain(PLAN_REASONS.farm_list_unreadable);
  });

  it('Counted_nouns_agree_with_their_number', () => {
    const singular = /\b1 (farms|people|entries|acres)\b/;
    const pluralLost = (n: number) => new RegExp(`\b${n} (farm|person|entry|acre)\b(?!s)`);
    for (const n of [0, 1, 2]) {
      const d = misFixture({
        overview: { activeFarms: num(n, n), logsRecorded: num(n, n) },
        acquisition: { verified: num(n, n) },
        retention: { quietFarms7To29: num(n, n) },
        farms: { activeFarms: num(n, n), farmsInFpo: num(n, n) },
      });
      const texts = [
        headlineFor('overview', d, false), headlineFor('acquisition', d, false),
        headlineFor('retention', d, false), headlineFor('farms', d, false),
        tileOf(farmsView(d).tiles, 'farms.inFpo').hint,
      ];
      for (const t of texts) {
        if (n === 1) {
          expect.soft([n, t, singular.test(t)]).toEqual([n, t, false]);
        } else {
          expect.soft([n, t, pluralLost(n).test(t)]).toEqual([n, t, false]);
        }
      }
      if (n === 1) {
        expect.soft(headlineFor('overview', d, false)).toMatch(/^1 farm saved an entry/);
        expect.soft(headlineFor('overview', d, false)).toMatch(/of the 1 entry in this range/);
        expect.soft(headlineFor('acquisition', d, false)).toMatch(/^1 person verified/);
        expect.soft(headlineFor('farms', d, false)).toMatch(/^1 active farm\b(?!s)/);
        expect.soft(tileOf(farmsView(d).tiles, 'farms.inFpo').hint).toMatch(/\b1 [^,.;]*\bfarm\b(?!s)/);
      }
      if (n === 2) {
        expect.soft(headlineFor('overview', d, false)).toMatch(/^2 farms saved an entry/);
        expect.soft(headlineFor('acquisition', d, false)).toMatch(/^2 people verified/);
        expect.soft(tileOf(farmsView(d).tiles, 'farms.inFpo').hint).toMatch(/\b2 [^,.;]*\bfarms\b/);
      }
    }
  });

  it('A_zero_change_reads_no_change', () => {
    // Tile: counts and shares.
    for (const [n, kind] of [[num(412, 412), 'count'], [num(42.5, 42.5), 'pct'], [num(0, 0), 'count']] as const) {
      const t = tileFrom('overview.dau', n, kind, true);
      expect([kind, t.delta && 'text' in t.delta ? t.delta.text : null]).toEqual([kind, 'no change']);
    }
    // Headline with compare on.
    const flat = misFixture({ overview: { activeFarms: num(412, 412, ramp(412), ramp(412)) } });
    const h = headlineFor('overview', flat, true);
    expect(h).toContain('no change on the period before');
    expect(h).not.toMatch(/[+−-]?0(\.0)?%( |\))|0 pts/);
    const q = headlineFor('quality', misFixture({ quality: { voiceRecordingsSavedPct: num(86.1, 86.1) } }), true);
    expect(q).toContain('no change on the period before');
  });

  it('A_change_too_small_to_show_is_not_no_change', () => {
    // B13 reserves "no change" for a change of exactly zero; a real change must not read as none,
    // and "0%" is never printed. (The plans give no wording for it; only these two rules are pinned.)
    for (const [n, kind] of [[num(100001, 100000), 'count'], [num(42.52, 42.5), 'pct']] as const) {
      const t = tileFrom('overview.dau', n, kind, true);
      const text = t.delta && 'text' in t.delta ? t.delta.text : '';
      expect([kind, text]).not.toEqual([kind, 'no change']);
      expect([kind, /^[+−-]?0(\.0)?( ?%| pts)$/.test(text)]).toEqual([kind, false]);
      expect([kind, t.delta && 'text' in t.delta ? t.delta.good : null]).toEqual([kind, true]);
    }
    // B16 wording, and B18 V5: no leading plus on "less than 0.1 pts".
    const pts = tileFrom('overview.dau', num(42.52, 42.5), 'pct', true).delta;
    expect(pts && 'text' in pts ? pts.text : '').toBe('less than 0.1 pts');
    const rel = tileFrom('overview.dau', num(100001, 100000), 'count', true).delta;
    // B16 quotes "less than 0.1%"; V5 removes the plus only on "pts", so the sign is not pinned here.
    expect(rel && 'text' in rel ? rel.text : '').toMatch(/^\+?less than 0\.1%$/);
  });
});

describe('misView: review round 1 wording (CR-2b B18 V5, V6)', () => {
  it('Points_agree_with_their_number', () => {
    const one = deltaOf(num(43.5, 42.5), 'pct', true);
    const two = deltaOf(num(44.5, 42.5), 'pct', true);
    expect(one && 'text' in one ? one.text : '').toBe('+1 pt');
    expect(two && 'text' in two ? two.text : '').toBe('+2 pts');
  });

  it('The_counted_hints_name_their_count_with_agreeing_nouns', () => {
    // Item 9: "{voiceLogs} of {logsRecorded} entries"; item 43: "{voiceRecordings} recordings";
    // item 46: "{logsCorrected} entries corrected".
    const d = misFixture();
    expect(tileOf(overviewView(d).tiles, 'overview.voiceShare').hint).toContain('388 of 913 entries');
    expect(tileOf(qualityView(d).tiles, 'quality.voiceSaved').hint).toContain('452 recordings');
    expect(tileOf(qualityView(d).tiles, 'quality.corrected').hint).toContain('79 entries corrected');

    const ones = misFixture({
      overview: { voiceLogs: num(1, 1), logsRecorded: num(1, 1) },
      quality: { voiceRecordings: num(1, 1), logsCorrected: num(1, 1) },
    });
    expect(tileOf(overviewView(ones).tiles, 'overview.voiceShare').hint).toContain('1 of 1 entry');
    expect(tileOf(overviewView(ones).tiles, 'overview.voiceShare').hint).not.toMatch(/\b1 entries\b/);
    expect(tileOf(qualityView(ones).tiles, 'quality.voiceSaved').hint).toMatch(/\b1 recording\b(?!s)/);
    expect(tileOf(qualityView(ones).tiles, 'quality.corrected').hint).toMatch(/\b1 entry corrected\b/);

    const zeros = misFixture({
      overview: { voiceLogs: num(0, 0), logsRecorded: num(50, 50) },
      quality: { voiceRecordings: num(0, 0), logsCorrected: num(0, 0) },
    });
    expect(tileOf(overviewView(zeros).tiles, 'overview.voiceShare').hint).toContain('0 of 50 entries');
    expect(tileOf(qualityView(zeros).tiles, 'quality.voiceSaved').hint).toContain('0 recordings');
    expect(tileOf(qualityView(zeros).tiles, 'quality.corrected').hint).toContain('0 entries corrected');
  });
});
