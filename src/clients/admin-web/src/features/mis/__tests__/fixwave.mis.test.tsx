import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import { misToAiJson, misToAiText } from '@/features/mis/copyForAi';
import { fmtDec } from '@/features/mis/misFormat';
import { engagementView, farmsView, headlineFor, overviewView, retentionView } from '@/features/mis/misView';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { misEnvelope, misFixture, notMeasured } from '@/test/misFixture';
import { MIS_NOW, countedShown, misCalls, renderMis, serveMis } from '@/test/misPage';

/**
 * CR-3 deploy-readiness fix wave, console half: the Company MIS items (W-1, W-2, W-6, W-7, W-13, W-14).
 * Expected words are literals written by hand from the brief, never produced by the code under test.
 */

let stub: StubbedAdapter | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIS_NOW);
  resetMisPeriod();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
});

function serve(over: Parameters<typeof misFixture>[0], metaExtra: Record<string, unknown> = {}) {
  stub = serveMis(async () => {
    const env = misEnvelope(misFixture(over));
    return { status: 200, data: { ...env, meta: { ...env.meta, ...metaExtra } } };
  });
}

const NOT_RECORDING = { analyticsNotMeasuredReason: 'analytics_not_recording', analyticsStoppedAtUtc: '2026-11-10T06:30:00Z' };

describe('W-1 MIS: app events are not being recorded', () => {
  const stopped = {
    quality: {
      syncRefusedChanges: notMeasured('analytics_not_recording'),
      syncRefusedPct: notMeasured('analytics_not_recording'),
      appVersions: { items: [], notMeasuredReason: 'analytics_not_recording' },
    },
  };

  it('W1_mis_version_adoption_and_sync_refused_say_why_and_show_no_number', async () => {
    serve(stopped, NOT_RECORDING);
    renderMis('quality');
    await countedShown();
    const text = screen.getByTestId('mis-dashboard').textContent ?? '';
    expect(text).toContain('The server stopped recording app events, so this cannot be counted.');
    expect(text).not.toContain('The server gave a reason this page does not know yet.');
    const adoption = screen.getByTestId('mis-dashboard').querySelector('section[data-mis-item="quality.versionAdoption"]')!;
    expect(adoption.textContent).toContain('Not measured');
    expect(adoption.textContent).not.toContain('None in this period');
    expect(screen.getByTestId('kpi-quality.syncFailTile-value').textContent).toContain('not measured');
  });

  it('W1_mis_banner_names_the_stop_time_in_india_time', async () => {
    serve(stopped, NOT_RECORDING);
    renderMis('quality');
    await countedShown();
    expect(screen.getByTestId('mis-analytics-not-recording').textContent).toBe(
      'Not measured: the server stopped recording app events since 10 Nov 2026, 12:00 pm India time. App version adoption and refused sync changes are not measured.',
    );
  });

  it('W1_mis_no_banner_when_recording', async () => {
    serve({}, {});
    renderMis('quality');
    await countedShown();
    expect(screen.queryByTestId('mis-analytics-not-recording')).toBeNull();
  });

  it('W1_mis_banner_without_a_stop_time_does_not_invent_one', async () => {
    serve(stopped, { analyticsNotMeasuredReason: 'analytics_not_recording', analyticsStoppedAtUtc: null });
    renderMis('quality');
    await countedShown();
    expect(screen.getByTestId('mis-analytics-not-recording').textContent).toBe(
      'Not measured: the server stopped recording app events. App version adoption and refused sync changes are not measured.',
    );
  });

  it('W1_mis_an_unknown_flag_code_falls_closed_to_the_generic_sentence', async () => {
    serve(stopped, { analyticsNotMeasuredReason: 'something_new' });
    renderMis('quality');
    await countedShown();
    expect(screen.getByTestId('mis-analytics-not-recording').textContent).toContain('Not measured.');
  });

  it('W1_copy_for_ai_carries_the_same_sentence', () => {
    const d = misFixture(stopped);
    const text = misToAiText(d, 'quality', {
      analyticsSentence: 'Not measured: the server stopped recording app events since 10 Nov 2026, 12:00 pm India time.',
    });
    expect(text).toContain('Not measured: the server stopped recording app events since 10 Nov 2026, 12:00 pm India time. App version adoption and refused sync changes are not measured.');
    expect(text).toContain('App version adoption: not measured — The server stopped recording app events, so this cannot be counted.');
    const json = JSON.parse(misToAiJson(d, 'quality', { analyticsSentence: 'Not measured: the server stopped recording app events.' })) as { caveats: string[] };
    expect(json.caveats[0]).toContain('stopped recording app events');
  });
});

describe('W-2 MIS: today is not a whole day', () => {
  it('W2_a_range_ending_today_says_today_so_far_and_shows_no_compare_change', async () => {
    serve({ lastDayComplete: false });
    renderMis('overview');
    await countedShown();
    for (const k of ['dau', 'wau', 'mau', 'stickiness']) {
      const tile = screen.getByTestId(`kpi-overview.${k}`);
      expect(within(tile).getByText('Today so far')).toBeInTheDocument();
      expect(within(tile).getByTestId('mis-not-compared').textContent).toBe('not compared: today is not over');
      expect(tile.textContent).not.toMatch(/better|worse|\bfrom \d/);
    }
    // A tile that is not an "as of the last day" number keeps its compare change.
    expect(within(screen.getByTestId('kpi-overview.logsRecorded')).queryByText('Today so far')).toBeNull();
    expect(screen.getByTestId('mis-hero-as-of').textContent).toBe('As of today so far, 15 Nov 2026');
    expect(screen.getByTestId('mis-last-day-partial').textContent).toBe('The last day is today and is not over yet.');
  });

  it('W2_a_complete_last_day_keeps_its_compare_change', async () => {
    serve({ lastDayComplete: true });
    renderMis('overview');
    await countedShown();
    const dau = screen.getByTestId('kpi-overview.dau');
    expect(within(dau).queryByText('Today so far')).toBeNull();
    expect(within(dau).getByText('from 129')).toBeInTheDocument();
    expect(screen.queryByTestId('mis-last-day-partial')).toBeNull();
    expect(screen.getByTestId('mis-hero-as-of').textContent).toBe('As of 15 Nov 2026');
  });

  it('W2_the_last_point_of_a_day_line_is_marked_today_so_far', () => {
    const view = overviewView(misFixture({ lastDayComplete: false }));
    if (view.hero.line.kind !== 'chart') throw new Error('expected a chart');
    const { titles, labels } = view.hero.line.data;
    expect(titles[titles.length - 1]).toBe('Sun 15 Nov (today so far)');
    expect(labels[labels.length - 1]).toBe('15 Nov (today so far)');
    expect(titles[titles.length - 2]).toBe('Sat 14 Nov');
    const whole = overviewView(misFixture());
    if (whole.hero.line.kind !== 'chart') throw new Error('expected a chart');
    expect(whole.hero.line.data.titles[whole.hero.line.data.titles.length - 1]).toBe('Sun 15 Nov');
  });

  it('W2_copy_for_ai_says_today_so_far_where_the_page_does', () => {
    const d = misFixture({ lastDayComplete: false });
    const text = misToAiText(d, 'overview');
    expect(text).toContain('The last day of the range is today and is not over');
    expect(text).toContain('Daily active people: 143 (today so far, not compared) — ');
    expect(text).toContain('Active farms: 412 (today so far, not compared) — ');
    expect(misToAiText(misFixture(), 'overview')).not.toContain('today so far');
  });

  it('W2_the_page_offers_today_only_as_its_own_button_and_the_default_ends_yesterday', async () => {
    serve({});
    renderMis('overview');
    await countedShown();
    expect(screen.getByRole('button', { name: 'To today (so far)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true');
    // The first request asks for 30 days ending yesterday (India time), not today.
    expect(misCalls(stub!)[0].url).toContain('from=2026-10-16&to=2026-11-14');
    fireEvent.click(screen.getByRole('button', { name: 'To today (so far)' }));
    expect(screen.getByRole('button', { name: 'To today (so far)' }).getAttribute('aria-pressed')).toBe('true');
    await vi.waitFor(() => expect(misCalls(stub!)).toHaveLength(2));
    expect(misCalls(stub!)[1].url).toContain('from=2026-10-17&to=2026-11-15');
  });
});

describe('W-6 MIS: sync failures and test phones', () => {
  it('W6_sync_tile_says_accepted_includes_test_phones_and_refused_leaves_them_out', async () => {
    serve({ quality: { syncAcceptedIncludesTestPhones: true } });
    renderMis('quality');
    await countedShown();
    const tile = screen.getByTestId('kpi-quality.syncFailTile');
    expect(tile.textContent).toContain('Accepted changes include test phones; refused changes leave test accounts out.');
    expect(tile.textContent).not.toContain('Every upload counts, test accounts included.');
  });

  it('W6_without_the_flag_the_older_line_stays', async () => {
    serve({});
    renderMis('quality');
    await countedShown();
    expect(screen.getByTestId('kpi-quality.syncFailTile').textContent).toContain('Every upload counts, test accounts included.');
  });

  it('W6_copy_for_ai_has_the_same_line', () => {
    const text = misToAiText(misFixture({ quality: { syncAcceptedIncludesTestPhones: true } }), 'quality');
    expect(text).toContain('Accepted changes include test phones; refused changes leave test accounts out.');
  });
});

describe('W-7 MIS: no test account is set up', () => {
  it('W7_zero_left_out_says_test_phones_are_counted', async () => {
    serve({ excludedTestAccounts: 0 });
    renderMis('overview');
    await countedShown();
    expect(screen.getByTestId('mis-test-accounts').textContent).toBe(
      'No test accounts are set up to be left out, so test phones are counted',
    );
    expect(screen.getByTestId('mis-test-accounts').textContent).not.toMatch(/\b0\b/);
  });

  it('W7_copy_for_ai_says_it_too_and_json_keeps_the_number_with_a_note', () => {
    const d = misFixture({ excludedTestAccounts: 0 });
    expect(misToAiText(d, 'overview')).toContain('No test accounts are set up to be left out, so test phones are counted.');
    const j = JSON.parse(misToAiJson(d, 'overview')) as { testAccountsLeftOut: number; testAccountsNote: string };
    expect(j.testAccountsLeftOut).toBe(0);
    expect(j.testAccountsNote).toBe('No test accounts are set up to be left out, so test phones are counted.');
  });
});

describe('W-13 MIS: small numbers are not zeros', () => {
  it('W13_a_measured_value_between_0_and_0_05_prints_less_than_0_1', () => {
    expect(fmtDec(0.04)).toBe('less than 0.1');
    expect(fmtDec(0.0001)).toBe('less than 0.1');
    expect(fmtDec(0.04, 2)).toBe('0.04');
    expect(fmtDec(0.004, 2)).toBe('less than 0.01');
  });

  it('W13_a_true_zero_and_ordinary_values_are_unchanged', () => {
    expect(fmtDec(0)).toBe('0');
    expect(fmtDec(0.05)).toBe('0.1');
    expect(fmtDec(8.1)).toBe('8.1');
    expect(fmtDec(12)).toBe('12');
    expect(fmtDec(12604.5)).toBe('12604.5');
  });

  it('W13_net_farm_change_is_named_a_change_not_new_farms', async () => {
    serve({});
    renderMis('overview');
    await countedShown();
    const text = screen.getByTestId('mis-dashboard').textContent ?? '';
    expect(text).toContain('Change in farms registered');
    expect(text).not.toContain('New farms in this range');
  });
});

describe('W-14 MIS: entries are counted on the day they reached the server', () => {
  it('W14_daily_active_people_and_the_sign_up_cohort_lines_say_reached_the_server', async () => {
    serve({});
    renderMis('overview');
    await countedShown();
    expect(screen.getByTestId('kpi-overview.dau').textContent).toContain('People with at least one entry that reached the server on the last day chosen.');
    expect(screen.getByTestId('kpi-overview.dau').textContent).not.toContain('saved at least one entry');
  });

  it('W14_retention_and_habit_lines_say_reached_the_server', async () => {
    serve({});
    renderMis('retention');
    await countedShown();
    const text = screen.getByTestId('mis-dashboard').textContent ?? '';
    expect(text).toContain('Share of new sign-ups with an entry reaching the server on the day after they signed up.');
    expect(text).toContain('Share of sign-ups with an entry reaching the server on the thirtieth day after signing up.');
    expect(text).toContain('For each week\'s sign-ups, the share with an entry reaching the server on day 1, 7, 14, 30.');
    expect(text).not.toMatch(/who saved an entry on/);
  });
});

describe('W-14 MIS: FPO history uses the links as they are today', () => {
  it('W14_the_farms_page_says_it_uses_todays_fpo_links', async () => {
    serve({});
    renderMis('farms');
    await countedShown();
    const text = screen.getByTestId('mis-dashboard').textContent ?? '';
    expect(text).toContain("Uses today's FPO links, also for earlier days and the period before.");
    expect(text).toContain("today's FPO links, not as they were on earlier days");
  });

  it('W14_copy_for_ai_says_it_too', () => {
    const text = misToAiText(misFixture(), 'farms');
    expect(text.match(/today's FPO links/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('round 1 I4: every as-of-last-day number follows the W-2 rule', () => {
  const partial = () => misFixture({ lastDayComplete: false });

  it('I4_retention_bands_quiet_and_silent_tiles_are_today_so_far_and_not_compared', async () => {
    serve({ lastDayComplete: false });
    renderMis('retention');
    await countedShown();
    for (const k of ['retention.quiet', 'retention.silent30']) {
      const tile = screen.getByTestId(`kpi-${k}`);
      expect(within(tile).getByText('Today so far')).toBeInTheDocument();
      expect(within(tile).getByTestId('mis-not-compared').textContent).toBe('not compared: today is not over');
    }
    const bands = screen.getByTestId('mis-dashboard').querySelector('section[data-mis-item="retention.bands"]')!;
    expect(bands.textContent).toContain('(today so far)');
    expect(bands.textContent).toContain('not compared: today is not over');
    expect(bands.textContent).not.toMatch(/\(better\)|\(worse\)/);
    // d1 and d30 are cohort shares, not as-of numbers: they keep their compare change.
    expect(within(screen.getByTestId('kpi-retention.d1')).queryByText('Today so far')).toBeNull();
  });

  it('I4_the_win_back_line_marks_its_last_point', () => {
    const v = retentionView(partial());
    if (v.winBack.kind !== 'chart') throw new Error('expected a chart');
    const { titles, labels } = v.winBack.data;
    expect(titles[titles.length - 1]).toMatch(/\(today so far\)$/);
    expect(labels[labels.length - 1]).toMatch(/\(today so far\)$/);
    expect(titles[0]).not.toContain('today so far');
  });

  it('I4_engagement_headline_and_farms_acres_tile', () => {
    expect(headlineFor('engagement', partial(), true)).toContain('(7 days to today so far, not compared)');
    expect(headlineFor('engagement', misFixture(), true)).not.toContain('today so far');
    const acres = farmsView(partial()).tiles.find((t) => t.item === 'farms.acres')!;
    expect(acres.todaySoFar).toBe(true);
    expect(acres.delta).toEqual({ notCompared: 'not compared: today is not over' });
    expect(engagementView(partial()).perFarm.kind).toBe('chart');
  });

  it('I4_copy_for_ai_agrees', () => {
    const r = misToAiText(partial(), 'retention');
    expect(r).toContain('Silent 30 days or more');
    expect(r).toMatch(/Where every registered farm stands: .*\(today so far, not compared\)/);
    expect(misToAiText(partial(), 'engagement')).toMatch(/Entries per active farm, per week: .*\(today so far, not compared\)/);
    expect(misToAiText(partial(), 'farms')).toMatch(/Acres covered: .*\(today so far, not compared\)/);
    expect(misToAiText(misFixture(), 'retention')).not.toContain('today so far');
  });
});

describe('round 1 m4 and m6: what is counted, in words', () => {
  it('m4_sign_ups_and_verified_describe_accounts_made_with_a_verified_phone', async () => {
    serve({});
    renderMis('overview');
    await countedShown();
    const tile = screen.getByTestId('kpi-overview.signUps').textContent ?? '';
    expect(tile).toContain('Accounts made in the chosen days, among accounts with a verified phone.');
    expect(tile).not.toContain('SMS code');
    expect(screen.getByTestId('mis-dashboard').textContent).toContain('Sign-ups are accounts made on that day, among accounts with a verified phone');
    expect(headlineFor('acquisition', misFixture(), false)).toMatch(/^271 people signed up with a verified phone/);
  });

  it('m6_wau_mau_and_active_farms_say_reached_the_server', async () => {
    serve({});
    renderMis('overview');
    await countedShown();
    for (const k of ['wau', 'mau']) {
      expect(screen.getByTestId(`kpi-overview.${k}`).textContent).toContain('at least one entry that reached the server');
    }
    const text = screen.getByTestId('mis-dashboard').textContent ?? '';
    expect(text).toContain('Farms with an entry that reached the server in the 7 days to the last day chosen.');
    expect(headlineFor('overview', misFixture(), false)).toMatch(/^412 farms had an entry reach the server in the 7 days to/);
  });
});
