import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CompanyMis, MisVersionShare } from '@/hooks/useCompanyMis';
import { OverviewSection } from '@/features/mis/MisOverview';
import { EngagementSection } from '@/features/mis/MisEngagement';
import { RetentionSection } from '@/features/mis/MisRetention';
import { QualitySection } from '@/features/mis/MisQuality';
import { FarmsSection } from '@/features/mis/MisFarms';
import { engagementView, farmsView, headlineFor, overviewView, qualityView, retentionView } from '@/features/mis/misView';
import { fmtInt, fmtPctPoints } from '@/features/mis/misFormat';
import { misFixture, notMeasured, num, spread } from '@/test/misFixture';
import { PLAN_REASONS, S_DISTRICT, S_FARM_DISTRICT } from '@/test/misPlan';

/**
 * CR-2c Task 2 — the nine small additions drawn on the Company MIS pages, and the
 * three district items naming their blocker. Expected words and rules come from the
 * plan (`CR-2c-mis-small-additions-PLAN.md`: Task 2, "The answer additions",
 * amendments E1-E11), never from what the code prints. All values are made up.
 */

const CHECKED = '15 Nov 2026, 2:32 pm India time';

/* Sentences the plan words (copied from the plan, not from the code). */
const NO_SCORED_DAY = 'No farm-day in this period got a score.'; // E7, understanding
const NO_CHANGE_SENT = 'No change was sent from a phone in this period.'; // E7, sync (denominator_zero too)
const VERSIONS_NOT_RECORDED = 'App versions were not recorded yet in this period.'; // E11(5), #52
const NOBODY_COUNTED = 'Nobody did anything counted here in this period.'; // E11(5), #29
const NONE = 'None in this period'; // Task 2 Step 2
const LEGACY_LABEL = '1.0.17 or earlier'; // E10(1)
/* The two item lines with digits in them (E4 for #10; #49 unchanged), removed before a digit check. */
const LINE_10 = 'The middle score out of 10 across scored farm-days, including days scored 0 the phone hides.'; // E12
const LINE_49 = 'How farm days spread across understanding scores from 0 to 10.';

function quality(d: CompanyMis, compare = false) {
  return render(<QualitySection view={qualityView(d)} compare={compare} checkedAt={CHECKED} />);
}
function engagement(d: CompanyMis) {
  return render(<EngagementSection view={engagementView(d)} compare={false} checkedAt={CHECKED} />);
}
function farms(d: CompanyMis) {
  return render(<FarmsSection view={farmsView(d)} compare={false} checkedAt={CHECKED} />);
}
function overview(d: CompanyMis, compare = false) {
  return render(<OverviewSection view={overviewView(d)} compare={compare} checkedAt={CHECKED} />);
}

/** The chart card of an item (a tile can carry the same key; the card is a <section>). */
function cardOf(root: HTMLElement, item: string): HTMLElement {
  const el = root.querySelector(`section[data-mis-item="${item}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no card for ${item}`);
  return el;
}

/** Any element carrying the item key (a sub-panel inside another card counts). */
function itemOf(root: HTMLElement, item: string): HTMLElement {
  const el = root.querySelector(`[data-mis-item="${item}"]`) as HTMLElement | null;
  if (!el) throw new Error(`no element for ${item}`);
  return el;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const without = (t: string, ...lines: string[]) => lines.reduce((s, l) => s.split(l).join(''), t);
const bodyRows = (el: HTMLElement) => [...el.querySelectorAll('tbody tr')] as HTMLElement[];
const rowWith = (el: HTMLElement, needle: string | RegExp) =>
  bodyRows(el).filter((r) => (typeof needle === 'string' ? text(r).includes(needle) : needle.test(text(r))));

describe('the nine items drawn (CR-2c Task 2)', () => {
  it('Understanding_shows_median_and_farm_days', () => {
    // #10: a number "x.x of 10" with "from N farm-days" (Task 2 Step 2); fixture 6.5 over 684 farm-days.
    {
      const v = overview(misFixture());
      expect(v.getByTestId('kpi-overview.understanding-value').textContent).toBe('6.5 of 10');
      expect(text(v.getByTestId('kpi-overview.understanding'))).toContain(`from ${fmtInt(684)} farm-days`);
      v.unmount();
    }
    {
      // Other made-up values, and a counted noun that agrees with its number (B18 V5).
      const v = overview(misFixture({ overview: { understandingMedian: num(8.3, 7.9), understandingScoredDays: num(1, 4) } }));
      expect(v.getByTestId('kpi-overview.understanding-value').textContent).toBe('8.3 of 10');
      const tile = text(v.getByTestId('kpi-overview.understanding'));
      expect(tile).toMatch(/\bfrom 1 farm-day(?!s)/);
      v.unmount();
    }
    {
      const v = overview(misFixture({ overview: { understandingScoredDays: num(12345, 11876) } }));
      expect(text(v.getByTestId('kpi-overview.understanding'))).toContain(`from ${fmtInt(12345)} farm-days`);
      v.unmount();
    }
  });

  it('No_samples_shows_the_reason_not_zero', () => {
    // Review Focus 1 + P4 + E7: a period with no scored farm-day says why; it is never 0 of 10 or 0 farm-days,
    // and it says it in its own words, not the voice sentence of the generic `no_samples`.
    const d = misFixture({
      overview: { understandingMedian: notMeasured('no_samples'), understandingScoredDays: notMeasured('no_samples') },
      quality: { understandingSpread: { items: [], notMeasuredReason: 'no_samples' } },
    });
    for (const compare of [false, true]) {
      const v = overview(d, compare);
      const box = v.getByTestId('kpi-overview.understanding-value');
      const tile = v.getByTestId('kpi-overview.understanding');
      expect([compare, text(box).includes(NO_SCORED_DAY)]).toEqual([compare, true]);
      expect([compare, text(tile).includes(PLAN_REASONS.no_samples)]).toEqual([compare, false]);
      expect([compare, /\d/.test(text(box))]).toEqual([compare, false]);
      // Nothing in the tile but its own E4 line carries a digit: no "0 of 10", no "from 0 farm-days".
      expect([compare, /\d/.test(without(text(tile), LINE_10))]).toEqual([compare, false]);
      v.unmount();
    }
    // #49 with no scored day (E11(5)): an empty list with `no_samples`, shown with the E7 sentence, never "None".
    const q = quality(d);
    const spreadCard = cardOf(q.container, 'quality.scoreSpread');
    expect(text(spreadCard)).toContain(NO_SCORED_DAY);
    expect(text(spreadCard)).not.toContain(PLAN_REASONS.no_samples);
    expect(text(spreadCard)).not.toContain(NONE);
    expect(spreadCard.querySelector('svg[role="img"]')).toBeNull(); // no chart drawn
    expect(/\d/.test(without(text(spreadCard), LINE_49))).toBe(false);
  });

  it('Spread_draws_eleven_bars', () => {
    // #49: eleven bars, scores 0..10 (1b: all eleven buckets present, zeros real).
    const d = misFixture();
    const q = quality(d);
    const el = cardOf(q.container, 'quality.scoreSpread');
    const svg = el.querySelector('svg[role="img"]') as SVGElement;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect[fill="transparent"]')).toHaveLength(11); // one column per score
    expect(svg.querySelectorAll('path')).toHaveLength(11); // every bucket of the fixture is above 0
    // The table twin: one row per score, lowest first, each with its farm-days.
    fireEvent.click(within(el).getByRole('button', { name: 'Table' }));
    const rows = bodyRows(el);
    expect(rows).toHaveLength(11);
    d.quality.understandingSpread.items.forEach((b, i) => {
      const cells = [...rows[i].querySelectorAll('td')].map((c) => text(c).trim());
      expect([b.score, new RegExp(`\\b${b.score}\\b`).test(cells[0])]).toEqual([b.score, true]);
      expect([b.score, cells[1]]).toEqual([b.score, fmtInt(b.farmDays)]);
    });
    q.unmount();

    // A score no farm-day got is a real 0: still eleven columns, and its row says 0.
    const items = d.quality.understandingSpread.items.map((b) => (b.score === 3 ? { ...b, farmDays: 0 } : b));
    const z = quality(misFixture({ quality: { understandingSpread: { items, notMeasuredReason: null } } }));
    const zel = cardOf(z.container, 'quality.scoreSpread');
    expect(zel.querySelectorAll('svg[role="img"] rect[fill="transparent"]')).toHaveLength(11);
    fireEvent.click(within(zel).getByRole('button', { name: 'Table' }));
    const zrows = bodyRows(zel);
    expect(zrows).toHaveLength(11);
    expect(text(zrows[3].querySelectorAll('td')[1]).trim()).toBe('0');
  });

  it('Sync_shows_share_counts_and_retry_note', () => {
    // #47 with E2/E10(2): the share, "N sends refused" and "M changes accepted", and the E2 line
    // (it replaces Task 2's "retries are not counted": a change refused again counts each time).
    const d = misFixture();
    const q = quality(d);
    const tile = q.getByTestId('kpi-quality.syncFailTile');
    expect(q.getByTestId('kpi-quality.syncFailTile-value').textContent).toBe('3.4%');
    expect(text(tile)).toContain(`${fmtInt(118)} sends refused`);
    expect(text(tile)).toContain(`${fmtInt(3364)} changes accepted`);
    expect(text(tile)).toMatch(/a change refused again counts each time/i);
    expect(text(tile)).not.toMatch(/retries?( on the phone)? (are|is) not counted/i);
    // E10(2): M mixes attempts and changes, so the card never says "N refused of M changes".
    expect(text(tile)).not.toMatch(/refused of/i);
    // Global Constraints: the exception is stated on screen; every upload counts, test accounts included.
    const chart = cardOf(q.container, 'quality.syncFailChart');
    expect(`${text(tile)} ${text(chart)}`).toMatch(/test accounts/i);

    // #50 with E8: a two-series day chart read from the two counts' day lists.
    fireEvent.click(within(chart).getByRole('button', { name: 'Table' }));
    const heads = [...chart.querySelectorAll('thead th')].map((h) => text(h).trim());
    expect(heads).toEqual(expect.arrayContaining(['Refused', 'Accepted']));
    const ri = heads.indexOf('Refused');
    const ai = heads.indexOf('Accepted');
    const rows = bodyRows(chart);
    expect(rows).toHaveLength(30);
    const refusedDays = spread(118);
    const acceptedDays = spread(3364);
    rows.forEach((r, i) => {
      const cells = [...r.querySelectorAll('td')].map((c) => text(c).trim());
      expect([i, cells[ri], cells[ai]]).toEqual([i, fmtInt(refusedDays[i]), fmtInt(acceptedDays[i])]);
    });
  });

  it('Sync_shows_two_plain_counts', () => {
    // E10(2): two plain counts beside the share; nouns agree with their number (B18 V5); a measured 0 is 0.
    const cases: [number, number, number, string, string][] = [
      [0, 2, 0, '0 sends refused', '2 changes accepted'],
      [1, 1, 50, '1 send refused', '1 change accepted'],
      [2, 3, 40, '2 sends refused', '3 changes accepted'],
    ];
    for (const [refused, accepted, pct, a, b] of cases) {
      const v = quality(misFixture({
        quality: { syncRefusedChanges: num(refused, refused), syncAcceptedChanges: num(accepted, accepted), syncRefusedPct: num(pct, pct) },
      }));
      const tile = text(v.getByTestId('kpi-quality.syncFailTile'));
      expect([refused, accepted, tile.includes(a), tile.includes(b)]).toEqual([refused, accepted, true, true]);
      expect([refused, /\b1 sends\b|\b1 changes\b/.test(tile)]).toEqual([refused, false]);
      v.unmount();
    }
  });

  it('No_uploads_is_not_a_zero_rate_on_the_page', () => {
    // Review Focus 2 + E7: nothing sent is `denominator_zero` (or `no_samples`), said as "No change was sent
    // from a phone in this period.", never 0% and never the generic divide-by sentence.
    for (const code of ['denominator_zero', 'no_samples']) {
      const zeros = Array<number>(30).fill(0);
      const v = quality(misFixture({
        quality: {
          syncRefusedPct: notMeasured(code),
          syncRefusedChanges: num(0, 0, zeros, zeros),
          syncAcceptedChanges: num(0, 0, zeros, zeros),
        },
      }));
      const box = text(v.getByTestId('kpi-quality.syncFailTile-value'));
      expect([code, box.includes(NO_CHANGE_SENT)]).toEqual([code, true]);
      expect([code, /\d/.test(box)]).toEqual([code, false]);
      expect([code, box.includes(PLAN_REASONS.denominator_zero)]).toEqual([code, false]);
      expect([code, text(v.getByTestId('kpi-quality.syncFailTile')).includes('0%')]).toEqual([code, false]);
      v.unmount();
    }
  });

  it('Versions_say_known_since_when_after_the_start', () => {
    // #52: "known since <day>" only when appVersionsSeenSince is after the period's first day (17 Oct 2026).
    {
      const v = quality(misFixture()); // seen since 24 Oct 2026
      expect(text(cardOf(v.container, 'quality.versionAdoption'))).toMatch(/known since 24 Oct( 2026)?/i);
      v.unmount();
    }
    for (const since of ['2026-10-17', '2026-09-02']) {
      const v = quality(misFixture({ quality: { appVersionsSeenSince: since } }));
      expect([since, /known since/i.test(text(cardOf(v.container, 'quality.versionAdoption')))]).toEqual([since, false]);
      v.unmount();
    }
  });

  it('Legacy_version_reads_1_0_17_or_earlier', () => {
    // E10(1): the legacy number "0.9.0" is shown as "1.0.17 or earlier", exactly as the app-versions page does.
    const v = quality(misFixture());
    const card = cardOf(v.container, 'quality.versionAdoption');
    expect(text(card)).not.toContain('0.9.0');
    const legacy = rowWith(card, LEGACY_LABEL);
    expect(legacy).toHaveLength(1);
    expect(text(legacy[0])).toContain(fmtInt(142));
    expect(text(legacy[0])).toContain(fmtPctPoints(27.1));
    // A real version number is shown as served.
    expect(rowWith(card, '1.0.18')).toHaveLength(2);
  });

  it('Platform_words', () => {
    // E10(3) + E11(3): "android" -> "Android app"; any other or missing value -> "Not the Android app".
    const items: MisVersionShare[] = [
      { version: '1.0.18', platform: 'android', people: 301, sharePct: 41.2 },
      { version: '1.0.18', platform: 'not_android', people: 202, sharePct: 27.6 },
      { version: '1.0.19', platform: 'web', people: 103, sharePct: 14.1 },
      { version: '1.0.19', platform: '', people: 54, sharePct: 7.4 },
      { version: '1.0.19', platform: undefined as unknown as string, people: 39, sharePct: 5.3 },
      { version: '1.0.18', platform: null as unknown as string, people: 32, sharePct: 4.4 },
    ];
    const v = quality(misFixture({ quality: { appVersions: { items, notMeasuredReason: null } } }));
    const card = cardOf(v.container, 'quality.versionAdoption');
    for (const row of items) {
      const rows = rowWith(card, new RegExp(`(^|\\D)${fmtInt(row.people)}(\\D|$)`));
      expect([row.platform, rows.length]).toEqual([row.platform, 1]);
      const t = text(rows[0]);
      if (row.platform === 'android') {
        expect([row.platform, t.includes('Android app'), t.includes('Not the Android app')]).toEqual([row.platform, true, false]);
      } else {
        expect([row.platform, t.includes('Not the Android app')]).toEqual([row.platform, true]);
      }
    }
    // The server's raw words never reach the screen.
    expect(text(card)).not.toContain('not_android');
    expect(text(card)).not.toMatch(/\bandroid\b/);
    expect(text(card)).not.toMatch(/\bweb\b/i);
  });

  it('Versions_say_the_version_used_last_not_the_newest', () => {
    // E11(4): each person is counted once on the version on their most recent row ("the version they used
    // last"), which replaced 1a's "newest app version they used"; nothing on the card may still claim "newest".
    const v = quality(misFixture());
    const card = cardOf(v.container, 'quality.versionAdoption');
    expect(text(card)).toContain('each counted once on the version they used last');
    expect(text(card)).not.toMatch(/newest/i);
  });

  it('App_versions_not_recorded_has_its_own_sentence', () => {
    // E11(5): no app-seen row by the period's end -> `not_recorded`, shown on #52 with its own sentence.
    const v = quality(misFixture({ quality: { appVersions: { items: [], notMeasuredReason: 'not_recorded' }, appVersionsSeenSince: null } }));
    const card = cardOf(v.container, 'quality.versionAdoption');
    expect(text(card)).toContain(VERSIONS_NOT_RECORDED);
    expect(text(card)).not.toContain(PLAN_REASONS.not_recorded);
    expect(text(card)).not.toContain(NONE);
    expect(text(card)).not.toMatch(/known since/i);
    expect(card.querySelector('tbody')).toBeNull();
  });

  it('Compare_reads_not_recorded', () => {
    // #29: bars per feature with Compare shown as "not recorded" (E1 feature keys; Compare People null).
    const d = misFixture();
    const v = engagement(d);
    const card = cardOf(v.container, 'engagement.featureUse');
    const compare = rowWith(card, /compare/i);
    expect(compare).toHaveLength(1);
    expect(text(compare[0]).toLowerCase()).toContain('not recorded');
    expect(text(compare[0])).not.toMatch(/\d/);
    // Every measured feature: its share and its people, on one row.
    for (const f of d.engagement.featureUse.items.filter((x) => x.people !== null)) {
      const rows = rowWith(card, new RegExp(`(^|\\D)${fmtInt(f.people!)}(\\D|$)`));
      expect([f.feature, rows.length]).toEqual([f.feature, 1]);
      expect([f.feature, text(rows[0]).includes(fmtPctPoints(f.sharePct!))]).toEqual([f.feature, true]);
    }
    // One row per served feature; no raw feature key on screen.
    expect(bodyRows(card)).toHaveLength(d.engagement.featureUse.items.length);
    expect(text(card)).not.toMatch(/job_cards|not_recorded/);
  });

  it('Nobody_counted_has_its_own_sentence', () => {
    // E11(5): a feature share with nobody counted is `denominator_zero`, said "Nobody did anything counted
    // here in this period." on #29, never the generic divide-by sentence and never 0%.
    const nobody = ['entries', 'voice', 'costs', 'attendance', 'photos', 'job_cards'].map((feature) => ({
      feature, people: null, sharePct: null, notMeasuredReason: 'denominator_zero',
    }));
    const items = [...nobody, { feature: 'compare', people: null, sharePct: null, notMeasuredReason: 'not_recorded' }];
    {
      const v = engagement(misFixture({ engagement: { featureUse: { items, notMeasuredReason: null } } }));
      const card = cardOf(v.container, 'engagement.featureUse');
      expect(text(card)).toContain(NOBODY_COUNTED);
      expect(text(card)).not.toContain(PLAN_REASONS.denominator_zero);
      expect(text(card)).not.toMatch(/\d/);
      v.unmount();
    }
    {
      // The whole list with the same reason: the same sentence, never "None in this period".
      const v = engagement(misFixture({ engagement: { featureUse: { items: [], notMeasuredReason: 'denominator_zero' } } }));
      const card = cardOf(v.container, 'engagement.featureUse');
      expect(text(card)).toContain(NOBODY_COUNTED);
      expect(text(card)).not.toContain(PLAN_REASONS.denominator_zero);
      expect(text(card)).not.toContain(NONE);
      v.unmount();
    }
  });

  it('Sync_before_refusals_were_recorded_says_from_when', () => {
    // E13(1): a period starting before refusals were recorded (2026-08-27) answers `not_recorded` on #47 and #50;
    // both say from when refusals are counted, never the general "This is not recorded anywhere yet.".
    const SYNC_FROM = 'Refused changes are counted only from 27 August 2026; earlier days were not recorded.';
    const v = quality(misFixture({
      quality: {
        syncRefusedPct: notMeasured('not_recorded'),
        syncRefusedChanges: notMeasured('not_recorded'),
        syncAcceptedChanges: notMeasured('not_recorded'),
      },
    }));
    expect(text(v.getByTestId('kpi-quality.syncFailTile-value'))).toContain(SYNC_FROM);
    expect(text(itemOf(v.container, 'quality.syncFailChart'))).toContain(SYNC_FROM);
    expect(text(v.container)).not.toContain(PLAN_REASONS.not_recorded);
    v.unmount();
    // The shape the server sends (E13 re-review): accepted changes counted, refusals not recorded yet.
    const accepted = Array<number>(30).fill(4);
    const w = quality(misFixture({
      quality: {
        syncRefusedPct: notMeasured('not_recorded'),
        syncRefusedChanges: notMeasured('not_recorded'),
        syncAcceptedChanges: num(120, 110, accepted, accepted),
      },
    }));
    expect(text(w.getByTestId('kpi-quality.syncFailTile-value'))).toContain(SYNC_FROM);
    expect(text(itemOf(w.container, 'quality.syncFailChart'))).toContain(SYNC_FROM);
    expect(text(w.container)).not.toContain(PLAN_REASONS.not_recorded);
  });

  it('An_unmeasured_feature_row_draws_no_bar', () => {
    // E13(4): a feature row with no share (Compare `not_recorded`, or `denominator_zero`) draws NO bar, because an
    // empty bar would read as a measured 0%; a measured row keeps its bar.
    const d = misFixture();
    const v = engagement(d);
    const card = cardOf(v.container, 'engagement.featureUse');
    const barOf = (row: HTMLElement) => row.querySelectorAll('td')[0]?.querySelector('div > div') ?? null;
    const compare = rowWith(card, /compare/i);
    expect(compare).toHaveLength(1);
    expect(barOf(compare[0])).toBeNull();
    const measured = d.engagement.featureUse.items.find((x) => x.people !== null)!;
    const row = rowWith(card, new RegExp(`(^|\\D)${fmtInt(measured.people!)}(\\D|$)`));
    expect(row).toHaveLength(1);
    expect(barOf(row[0])).not.toBeNull();
  });

  it('Feature_by_role_table', () => {
    // #31: a feature by role table; roles in plain words (CR-2b role names), each served count in its cell.
    const d = misFixture();
    const v = engagement(d);
    const el = itemOf(v.container, 'engagement.featureByRole');
    const table = el.querySelector('table') as HTMLTableElement;
    expect(table).not.toBeNull();
    const heads = [...table.querySelectorAll('thead th')].map((h) => text(h).trim());
    const PLAIN: Record<string, string> = { PrimaryOwner: 'Owner', Worker: 'Worker', Mukadam: 'Mukadam' };
    for (const role of Object.values(PLAIN)) expect([role, heads.includes(role)]).toEqual([role, true]);
    expect(heads.join(' ')).not.toMatch(/PrimaryOwner/);
    const features = [...new Set(d.engagement.featureUseByRole.items.map((x) => x.feature))];
    const rows = bodyRows(el);
    expect(rows).toHaveLength(features.length);

    // Each served (feature, role) count sits under its role's column, and one feature's counts share a row.
    const rowOfFeature = new Map<string, number>();
    for (const pair of d.engagement.featureUseByRole.items) {
      const hits: [number, number][] = [];
      rows.forEach((r, ri) => [...r.children].forEach((c, ci) => { if (text(c).trim() === fmtInt(pair.people)) hits.push([ri, ci]); }));
      expect([pair.feature, pair.role, hits.length]).toEqual([pair.feature, pair.role, 1]);
      const [ri, ci] = hits[0];
      expect([pair.feature, pair.role, heads[ci]]).toEqual([pair.feature, pair.role, PLAIN[pair.role]]);
      if (rowOfFeature.has(pair.feature)) expect([pair.feature, ri]).toEqual([pair.feature, rowOfFeature.get(pair.feature)]);
      rowOfFeature.set(pair.feature, ri);
    }
    // No count the answer did not serve.
    const numbers = rows.flatMap((r) => [...r.children].slice(1).map((c) => text(c).trim()).filter((t) => /\d/.test(t)));
    expect(numbers.sort()).toEqual(d.engagement.featureUseByRole.items.map((x) => fmtInt(x.people)).sort());
  });

  it('Crops_table', () => {
    // #59: a table of crop, farms, acres; names as entered (a Marathi name stays its own row, 1e/Review Focus 4).
    const items = [
      { cropName: 'Grapes', farms: 211, acres: 538.6 },
      { cropName: 'डाळिंब', farms: 117, acres: 286.4 },
      { cropName: 'Onion', farms: 88, acres: 164.7 },
    ];
    {
      const v = farms(misFixture({ farms: { cropsOnActiveFarms: { items, notMeasuredReason: null } } }));
      const card = cardOf(v.container, 'farms.crops');
      const rows = bodyRows(card);
      expect(rows).toHaveLength(3);
      items.forEach((c, i) => {
        const t = text(rows[i]);
        expect([c.cropName, t.includes(c.cropName), t.includes(fmtInt(c.farms)), t.includes(c.acres.toFixed(1))])
          .toEqual([c.cropName, true, true, true]);
      });
      v.unmount();
    }
    {
      // Task 2 Step 2: an empty list with no reason says "None in this period".
      const v = farms(misFixture({ farms: { cropsOnActiveFarms: { items: [], notMeasuredReason: null } } }));
      expect(text(cardOf(v.container, 'farms.crops'))).toContain(NONE);
      v.unmount();
    }
    {
      // A list's reason shows its sentence, never "None".
      const v = farms(misFixture({ farms: { cropsOnActiveFarms: { items: [], notMeasuredReason: 'farm_list_unreadable' } } }));
      const card = cardOf(v.container, 'farms.crops');
      expect(text(card)).toContain(PLAN_REASONS.farm_list_unreadable);
      expect(text(card)).not.toContain(NONE);
      expect(text(card)).not.toMatch(/\bnone\b/i);
      v.unmount();
    }
  });

  it('Entries_by_kind_bars', () => {
    // #26: bars per kind (kind keys of "The answer additions"), each with its entries; no raw key on screen.
    const d = misFixture();
    {
      const v = engagement(d);
      const card = cardOf(v.container, 'engagement.logsByType');
      const rows = bodyRows(card);
      expect(rows).toHaveLength(6);
      for (const k of d.engagement.logsByKind.items) {
        const hit = rowWith(card, new RegExp(`(^|\\D)${fmtInt(k.entries)}(\\D|$)`));
        expect([k.kind, hit.length]).toEqual([k.kind, 1]);
      }
      expect(new Set(rows.map((r) => text(r.querySelector('th')).trim())).size).toBe(6);
      expect(text(card)).not.toMatch(/other_work|not_recognised|_/);
      v.unmount();
    }
    {
      const v = engagement(misFixture({ engagement: { logsByKind: { items: [], notMeasuredReason: null } } }));
      expect(text(cardOf(v.container, 'engagement.logsByType'))).toContain(NONE);
      v.unmount();
    }
    {
      const v = engagement(misFixture({ engagement: { logsByKind: { items: [], notMeasuredReason: 'too_many_farms_for_live_count' } } }));
      const card = cardOf(v.container, 'engagement.logsByType');
      expect(text(card)).toContain(PLAN_REASONS.too_many_farms_for_live_count);
      expect(text(card)).not.toContain(NONE);
      v.unmount();
    }
  });

  it('District_items_name_their_blocker', () => {
    // Task 2 Step 3: #40, #58 and #62's district clause stay "Not measured yet" with the blocker sentences.
    const d = misFixture();
    {
      const v = render(<RetentionSection view={retentionView(d)} compare={false} checkedAt={CHECKED} />);
      const el = itemOf(v.container, 'retention.quietByDistrict');
      expect(text(el)).toMatch(/not measured yet/i);
      expect(text(el)).toContain(S_DISTRICT);
      v.unmount();
    }
    {
      const v = farms(d);
      const el = itemOf(v.container, 'farms.byDistrict');
      expect(text(el)).toMatch(/not measured yet/i);
      expect(text(el)).toContain(S_FARM_DISTRICT);
      v.unmount();
    }
    const headline = headlineFor('farms', d, false);
    expect(headline).toMatch(/Districts are not measured yet\./);
    expect(headline).toContain(S_DISTRICT);
  });
});
