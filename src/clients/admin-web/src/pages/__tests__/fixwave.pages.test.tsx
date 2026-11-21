import { act, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';
import { installContactsStub, type ContactsStub } from '@/test/contactsStub';
import type { FarmSummary } from '@/hooks/useFarms';
import type { MeScopeResponse } from '@/hooks/useAdminScope';
import FarmerHealthDrilldown from '@/features/farmer-health/FarmerHealthDrilldown';
import type { FarmerHealthDto, FarmerHealthTimelineDayDto } from '@/features/farmer-health/farmer-health.types';
import OpsErrorsPage from '../ops/OpsErrorsPage';
import OpsLivePage from '../ops/OpsLivePage';
import OpsVoicePage from '../ops/OpsVoicePage';
import AppVersionsPage from '../ops/AppVersionsPage';
import FarmsListPage from '../farms/FarmsListPage';
import SufferingPage from '../farms/SufferingPage';
import SettingsAdminsPage from '../settings/SettingsAdminsPage';
import UsersPage from '../users/UsersPage';
import HomePage from '../HomePage';
import HistoryPage from '../people/HistoryPage';
import { parseInstantMs } from '@/lib/indiaTime';

/**
 * CR-3 deploy-readiness fix wave, console half: the page items (W-1, W-5, W-8, W-12, W-13).
 * Every expected sentence is a literal from the brief, never read from the code under test.
 * Test numbers are 9000000xxx; no real person appears.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const WAIT = { timeout: 15_000 };
const STOPPED_AT = '2026-11-10T06:30:00Z'; // 12:00 pm India time
const SENTENCE = 'Not measured: the server stopped recording app events since 10 Nov 2026, 12:00 pm India time.';
const FLAG = { analyticsNotMeasuredReason: 'analytics_not_recording', analyticsStoppedAtUtc: STOPPED_AT };

const META = { source: 'live', window: 'last 24h', lastRefreshedUtc: '2026-11-22T06:00:00.000Z', ttlSeconds: 30 };
const body = () => document.body.textContent ?? '';

let stub: StubbedAdapter | ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

/* ───────────────────────────────────────────────────────────── API errors */

describe('W-1 / W-8 / W-12 API Errors', () => {
  const ev = { eventType: 'api.error', endpoint: 'POST /shramsafal/sync/push', statusCode: 500, latencyMs: 900, farmId: null, occurredAtUtc: '2026-11-22T05:00:00Z' };
  const envelope = (meta: Record<string, unknown>, total = 1, items = [ev]) => ({
    data: { items, totalCount: total, page: 1, pageSize: 50 },
    meta: { ...META, ...meta },
  });

  it('W1_errors_not_recording_shows_not_measured_never_a_total_or_an_empty_list', async () => {
    stub = installAdapter(async () => ({ status: 200, data: envelope(FLAG, 0, []) }));
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    expect((await screen.findByTestId('analytics-not-measured', undefined, WAIT)).textContent).toBe(SENTENCE);
    expect(screen.queryByRole('table', { name: 'API errors' })).toBeNull();
    expect(body()).not.toContain('No errors in this window');
    expect(body()).not.toMatch(/\b0 calls\b/);
  });

  it('W1_errors_recording_shows_the_list_and_W8_says_test_phones_are_included', async () => {
    stub = installAdapter(async () => ({ status: 200, data: envelope({}) }));
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    await screen.findByRole('table', { name: 'API errors' }, WAIT);
    expect(screen.queryByTestId('analytics-not-measured')).toBeNull();
    expect(screen.getByTestId('errors-test-phones').textContent).toBe(
      'Test phones included: errors from test phones are counted here, because this list measures the server.',
    );
  });

  it('W12_sorting_line_is_not_shown_while_the_list_says_could_not_load', async () => {
    const qc = makeTestQueryClient();
    let fail = false;
    const many = Array.from({ length: 50 }, (_, i) => ({ ...ev, occurredAtUtc: `2026-11-22T05:${String(i).padStart(2, '0')}:00Z` }));
    stub = installAdapter(async () => (fail ? { status: 500, data: { message: 'x' } } : { status: 200, data: envelope({}, 120, many) }));
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}`, queryClient: qc });
    await screen.findByText(/Sorting a column orders the 50 calls on this page, not all 120/, undefined, WAIT);
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['ops', 'errors'] }); });
    await waitFor(() => expect(body()).toMatch(/Couldn.t load/), WAIT);
    expect(body()).not.toContain('Sorting a column orders');
  });
});

/* ───────────────────────────────────────────────────────────────── Suffering */

describe('W-1 Suffering', () => {
  const row = { farmId: 'aaaaaaaa-0000-0000-0000-000000000001', problemCount: 9, syncProblems: 4, entryProblems: 3, voiceProblems: 1, otherProblems: 1, lastProblemAt: '2026-11-21T09:15:00Z' };

  it('W1_suffering_not_recording_is_not_measured_not_an_empty_watchlist', async () => {
    stub = installContactsStub((r) => (r.path.endsWith('/admin/farms/suffering') ? { data: [], meta: { ...META, ...FLAG } } : { data: null, meta: META }), {});
    renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
    expect((await screen.findByTestId('analytics-not-measured', undefined, WAIT)).textContent).toBe(SENTENCE);
    expect(body()).not.toContain('No farm has repeated problems');
    expect(screen.queryByRole('table', { name: 'Farms with repeated problems' })).toBeNull();
  });

  it('W1_suffering_recording_still_lists_farms', async () => {
    stub = installContactsStub((r) => (r.path.endsWith('/admin/farms/suffering') ? { data: [row], meta: META } : { data: null, meta: META }), { [row.farmId]: 'Example Mala' });
    renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
    await screen.findByRole('table', { name: 'Farms with repeated problems' }, WAIT);
    expect(screen.queryByTestId('analytics-not-measured')).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── Farms */

function farm(i: number, over: Partial<FarmSummary> = {}): FarmSummary {
  return {
    farmId: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
    name: `Example Farm ${i}`,
    ownerPhone: '9000000001',
    plan: 'trial',
    wvfd7d: 3,
    engagementTier: 'B',
    errors24h: 7,
    lastLogAt: '2026-11-20T09:00:00Z',
    createdAt: '2026-01-12T09:00:00Z',
    ...over,
  };
}

describe('W-1 / W-5 / W-12 All Farms', () => {
  const farmsEnvelope = (items: FarmSummary[], totalCount: number, testFarmsShown: number | undefined, meta: Record<string, unknown> = {}) => ({
    data: { items, totalCount, ...(testFarmsShown === undefined ? {} : { testFarmsShown }), page: 1, pageSize: 40 },
    meta: { ...META, ...meta },
  });

  it('W1_farms_errors_24h_is_not_measured_in_every_cell_while_analytics_is_not_recording', async () => {
    stub = installAdapter(async () => ({ status: 200, data: farmsEnvelope([farm(1), farm(2)], 2, 0, FLAG) }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    const table = await screen.findByRole('table', { name: 'All farms' }, WAIT);
    const col = [...table.querySelectorAll('thead th')].findIndex((th) => (th.textContent ?? '').includes('Errors 24h'));
    const cells = [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')]
      .filter((tr) => !tr.id.includes('detail'))
      .map((tr) => tr.querySelectorAll('td')[col].textContent ?? '');
    expect(cells).toHaveLength(2);
    for (const c of cells) {
      expect(c).toContain('not measured');
      expect(c).not.toContain('7');
    }
    expect(screen.getByTestId('analytics-not-measured').textContent).toBe(`Errors 24h: ${SENTENCE}`);
  });

  it('W5_the_headline_total_is_the_servers_count_and_test_farms_are_named_and_paged', async () => {
    const items = Array.from({ length: 40 }, (_, i) => farm(i + 1));
    stub = installAdapter(async () => ({ status: 200, data: farmsEnvelope(items, 78, 3) }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    await screen.findByRole('table', { name: 'All farms' }, WAIT);
    expect(body()).toContain('78 farms');
    expect(body()).not.toContain('81 farms');
    expect(screen.getByTestId('test-farms-not-counted').textContent).toBe('3 test farms are in the list but not counted.');
    // Paging runs over 78 + 3 = 81 listed rows: three pages of 40, not two.
    expect(body()).toContain('Page 1 of 3');
  });

  it('W5_without_test_farms_there_is_no_such_line_and_an_older_server_pages_as_before', async () => {
    stub = installAdapter(async () => ({ status: 200, data: farmsEnvelope([farm(1)], 1, undefined) }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    await screen.findByRole('table', { name: 'All farms' }, WAIT);
    expect(screen.queryByTestId('test-farms-not-counted')).toBeNull();
  });

  it('W12_farms_sorting_line_is_not_shown_while_the_list_says_could_not_load', async () => {
    const qc = makeTestQueryClient();
    let fail = false;
    const items = Array.from({ length: 40 }, (_, i) => farm(i + 1));
    stub = installAdapter(async () => (fail ? { status: 500, data: { message: 'x' } } : { status: 200, data: farmsEnvelope(items, 120, 0) }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}`, queryClient: qc });
    await screen.findByText(/Sorting a column orders the 40 farms on this page, not all 120/, undefined, WAIT);
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['farms'] }); });
    await waitFor(() => expect(body()).toMatch(/Couldn.t load/), WAIT);
    expect(body()).not.toContain('Sorting a column orders');
  });
});

/* ───────────────────────────────────────────────────────────── App versions */

describe('W-1 App Versions', () => {
  it('W1_app_versions_not_recording_shows_not_measured_with_no_count_and_no_wrong_reason', async () => {
    const answer = {
      days: 7, measuredSinceUtc: null, people: 0, phones: 0, otherDevices: 0, peopleWithUnknownDevice: 0,
      newestVersion: null, legacyVersionNumber: '0.9.0', versions: [], onOlderVersions: [],
    };
    stub = installAdapter(async () => ({ status: 200, data: { data: answer, meta: { ...META, ...FLAG } } }));
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });
    expect((await screen.findByTestId('analytics-not-measured', undefined, WAIT)).textContent).toBe(SENTENCE);
    expect(body()).not.toContain('Counting has not started');
    expect(body()).not.toContain('has not recorded any use by version');
    expect(body()).not.toContain('No one was seen using the app');
    for (const label of ['People who used the app', 'Phones signed in', 'People on an older version']) {
      const tile = screen.getByText(label).closest<HTMLElement>('[data-state]')!;
      expect(tile.getAttribute('data-state')).toBe('unmeasured');
      expect(tile.firstElementChild?.textContent).not.toMatch(/\d/);
    }
  });
});

/* ──────────────────────────────────────────────────────────────── Live health */

describe('W-1 / W-8 / W-12 Live Health', () => {
  const health = (over: Record<string, unknown> = {}) => ({
    voiceInvocations24h: 0, voiceFailures24h: 0, voiceFailureRatePct: 0, voiceAvgLatencyMs: 0, voiceP95LatencyMs: 0,
    recentErrors: [], topSufferingFarms: [], apiErrorSpike: null, voiceDegraded: false,
    computedAtUtc: '2026-11-22T06:00:00Z',
    alertR9: { rule: 'R9', state: 'clear', counted: 4, outOf: null, windowStartUtc: '2026-11-22T05:00:00Z', windowEndUtc: '2026-11-22T06:00:00Z', reason: null },
    ...over,
  });
  const serve = (h: () => unknown) => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/admin/ops/voice-check')) return neverSettles();
      if (req.url.includes('/admin/ops/health')) {
        const v = h();
        return v === 'never' ? neverSettles() : { status: 200, data: v };
      }
      return { status: 200, data: null };
    });
  };

  it('W1_live_health_not_recording_judges_nothing_and_shows_no_empty_lists', async () => {
    serve(() => health({
      ...FLAG,
      alertR9: { rule: 'R9', state: 'not_judged', counted: null, outOf: null, windowStartUtc: null, windowEndUtc: null, reason: 'analytics_not_recording' },
    }));
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    const checks = (await screen.findByRole('heading', { name: 'Automatic checks' }, WAIT)).closest('section')!;
    await waitFor(() => expect(within(checks).getByText(SENTENCE)).toBeInTheDocument(), WAIT);
    expect(within(checks).getByText('Not judged')).toBeInTheDocument();
    expect(within(checks).queryByText(/\bClear\b/)).toBeNull();
    expect(screen.getByTestId('analytics-not-measured').textContent).toBe(SENTENCE);
    expect(screen.getByTestId('analytics-not-measured-farms').textContent).toBe(SENTENCE);
    expect(body()).not.toContain('No errors in the last 2 hours');
    expect(body()).not.toContain('No farm has repeated problems');
  });

  it('W1_live_health_even_a_stale_clear_r9_is_not_shown_when_the_flag_is_set', async () => {
    serve(() => health(FLAG));
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    const checks = (await screen.findByRole('heading', { name: 'Automatic checks' }, WAIT)).closest('section')!;
    await waitFor(() => expect(within(checks).getByText(SENTENCE)).toBeInTheDocument(), WAIT);
    expect(within(checks).queryByText(/4 errors/)).toBeNull();
  });

  it('W8_r9_and_recent_events_say_test_phones_are_included', async () => {
    serve(() => health());
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await screen.findByRole('heading', { name: 'Automatic checks' }, WAIT);
    await waitFor(() => expect(body()).toContain('4 errors in the last hour'), WAIT);
    expect(body()).toContain('Test phones included: errors from test phones count, because this check measures the server.');
    expect(screen.getByTestId('events-test-phones').textContent).toBe(
      'Test phones included: events from test phones are listed, because this list measures the server.',
    );
  });

  it('W12_first_load_says_checking_now_not_the_server_did_not_send_it', async () => {
    serve(() => 'never');
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await screen.findByRole('heading', { name: 'Automatic checks' }, WAIT);
    expect(body()).toContain('Checking now.');
    expect(body()).not.toContain('The server did not send this check');
    expect(body()).not.toContain('The server did not send this list');
  });
});

/* ──────────────────────────────────────────────────────────────────── Voice */

describe('W-8 / W-12 Voice pipeline tiles', () => {
  const day = (date: string) => ({ date, invocations: 100, failures: 4, successRatePct: 96, avgLatencyMs: 1200 });
  const voiceEnvelope = () => ({
    data: { days: [day('2026-11-21'), day('2026-11-22')] },
    meta: { source: 'live-aggregated', window: 'last 14 days', lastRefreshedUtc: '2026-11-22T06:00:00.0000000Z', ttlSeconds: 300 },
  });
  const tile = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[data-kpis="voice"] > [data-state]')].find((t) =>
      [...t.querySelectorAll('div')].some((d) => d.textContent === label),
    )!;

  it('W8_calls_and_failed_say_test_phones_are_included', async () => {
    stub = installAdapter(async () => ({ status: 200, data: voiceEnvelope() }));
    renderWithProviders(<OpsVoicePage />, { route: `/ops/voice?org=${ORG}` });
    await waitFor(() => expect(tile('Calls')?.getAttribute('data-state')).toBe('ok'), WAIT);
    expect(tile('Calls').textContent).toContain('Test phones included');
    expect(tile('Failed calls').textContent).toContain('Test phones included');
  });

  it('W12_tiles_say_loading_during_the_first_load_and_show_no_number', async () => {
    stub = installAdapter(async () => neverSettles());
    renderWithProviders(<OpsVoicePage />, { route: `/ops/voice?org=${ORG}` });
    await waitFor(() => expect(tile('Calls')?.textContent).toContain('Loading the voice numbers.'), WAIT);
    for (const l of ['Calls', 'Failed calls', 'Success rate', 'Avg latency']) {
      expect(tile(l).getAttribute('data-state')).toBe('unmeasured');
      expect(tile(l).textContent).not.toContain('not measured ');
    }
    expect(tile('Calls').textContent).not.toContain('read at');
  });

  it('W12_after_a_failed_repoll_the_tiles_do_not_keep_old_numbers_as_current', async () => {
    const qc = makeTestQueryClient();
    let fail = false;
    stub = installAdapter(async () => (fail ? { status: 500, data: { message: 'x' } } : { status: 200, data: voiceEnvelope() }));
    renderWithProviders(<OpsVoicePage />, { route: `/ops/voice?org=${ORG}`, queryClient: qc });
    await waitFor(() => expect(tile('Calls')?.getAttribute('data-state')).toBe('ok'), WAIT);
    expect(tile('Calls').firstElementChild?.textContent).toBe('200');
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['ops', 'voice'] }); });
    await waitFor(() => expect(tile('Calls').getAttribute('data-state')).toBe('unmeasured'), WAIT);
    expect(tile('Calls').textContent).toContain('Could not load these numbers just now. Nothing here is shown as current.');
    expect(tile('Calls').firstElementChild?.textContent).not.toContain('200');
    expect(tile('Success rate').getAttribute('data-state')).toBe('unmeasured');
  });
});

/* ──────────────────────────────────────────────────────────────────── Home */

describe('W-1 Home call list', () => {
  it('W1_home_problems_half_follows_the_suffering_answer_and_is_not_an_empty_half', async () => {
    const scope = {
      outcome: 'Resolved',
      scope: {
        userId: 'u1', orgId: ORG, orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true,
        modules: ['farms.silent-churn', 'farms.suffering'].map((key) => ({ key, canRead: true, canExport: false, canWrite: false })),
      },
      memberships: [],
    };
    stub = installContactsStub((r) => {
      if (r.path.endsWith('/me/scope')) return scope;
      if (r.path.endsWith('/admin/farms/silent-churn')) {
        return { data: { countedAtUtc: '2026-11-22T06:00:00Z', farms: [], notMeasuredReason: null }, meta: META };
      }
      if (r.path.endsWith('/admin/farms/suffering')) return { data: [], meta: { ...META, ...FLAG } };
      return { data: null, meta: META };
    }, {});
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
    await waitFor(
      () => expect(body()).toContain(`Farms with repeated problems could not be counted. ${SENTENCE}`),
      WAIT,
    );
    expect(body()).not.toMatch(/No farm to call today/i);
  });
});

/* ──────────────────────────────────────────────────────────── Drilldown */

describe('W-1 Farmer health drilldown', () => {
  const FARM = '22222222-2222-2222-2222-222222222222';
  const days: FarmerHealthTimelineDayDto[] = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10),
    closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: i === 13 ? 2 : 0, errors: 0,
  }));
  const dto = (over: Partial<FarmerHealthDto> = {}): FarmerHealthDto => ({
    farmId: FARM, farmerName: 'Example Farmer', farmName: 'Example Mala', phone: '9000000012', score: null,
    timeline: days, syncState: { lastSyncAt: '2026-11-21T09:05:00.0000000Z' }, aiHealth: null,
    verifications: { confirmed: 1, verified: 2, disputed: 0, pending: 1, selfChecked: 3 }, workerSummary: [],
    ...over,
  });
  const scope: MeScopeResponse = {
    outcome: 'Resolved',
    scope: {
      userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: false,
      modules: ['farmer.health', 'ops.errors', 'ops.voice'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
    },
    memberships: [{ orgId: ORG, orgName: 'Example FPO', orgType: 'FPO', orgRole: 'Owner' }],
  };
  const render = (d: FarmerHealthDto) => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/me/scope')) return { status: 200, data: scope };
      if (req.url.includes('/admin/farmer-health/')) return { status: 200, data: d };
      return { status: 404, data: {} };
    });
    return renderWithProviders(
      <Routes>
        <Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} />
      </Routes>,
      { route: `/farmer-health/${FARM}?org=${ORG}` },
    );
  };

  it('W1_drilldown_not_recording_hides_the_closure_columns_and_errors_and_keeps_checked', async () => {
    render(dto({ ...FLAG }));
    await waitFor(() => expect(document.querySelector('[data-band="timeline"]')).not.toBeNull(), WAIT);
    const band = document.querySelector<HTMLElement>('[data-band="timeline"]')!;
    expect(within(band).getByTestId('analytics-not-measured').textContent).toBe(
      `Started, Submitted, Proof, Summary and Errors are not shown: ${SENTENCE}`,
    );
    const rowHeads = [...band.querySelectorAll('table[aria-label="Activity by event type and day"] tbody th[scope="row"]')].map((th) => th.textContent?.trim());
    expect(rowHeads).toEqual(['Checked']);
    expect(band.textContent).not.toContain('Nothing was counted in these six rows');
  });

  it('W1_drilldown_with_nothing_but_the_flag_says_not_measured_not_nothing_counted', async () => {
    render(dto({ ...FLAG, timeline: days.map((d) => ({ ...d, verifications: 0 })) }));
    await waitFor(() => expect(document.querySelector('[data-band="timeline"]')).not.toBeNull(), WAIT);
    const band = document.querySelector<HTMLElement>('[data-band="timeline"]')!;
    expect(band.textContent).toContain('The 14-day activity is not measured');
    expect(band.textContent).toContain(SENTENCE);
    expect(band.textContent).not.toContain('Nothing was counted in these six rows');
  });

  it('W1_drilldown_recording_keeps_all_six_rows', async () => {
    render(dto());
    await waitFor(() => expect(document.querySelector('[data-band="timeline"]')).not.toBeNull(), WAIT);
    const band = document.querySelector<HTMLElement>('[data-band="timeline"]')!;
    expect([...band.querySelectorAll('table[aria-label="Activity by event type and day"] tbody th[scope="row"]')]).toHaveLength(6);
  });
});

/* ────────────────────────────────────────────────────────────── Settings */

describe('W-13 My access with a scope that did not resolve', () => {
  it('W13_says_the_parts_could_not_be_read_not_0_parts', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { outcome: 'NoMembership', scope: null, memberships: [] } }));
    renderWithProviders(<SettingsAdminsPage />, { route: `/settings/admins?org=${ORG}` });
    expect((await screen.findByTestId('settings-parts-open', undefined, WAIT)).textContent).toBe(
      'Your access comes from your organisation. The parts open to you could not be read.',
    );
    expect(body()).not.toMatch(/0 parts/);
  });

  it('W13_a_resolved_scope_still_counts_its_parts', async () => {
    const resolved = {
      outcome: 'Resolved',
      scope: {
        userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: false,
        modules: [
          { key: 'farms.list', canRead: true, canExport: false, canWrite: false },
          { key: 'ops.errors', canRead: false, canExport: false, canWrite: false },
        ],
      },
      memberships: [],
    };
    stub = installAdapter(async () => ({ status: 200, data: resolved }));
    renderWithProviders(<SettingsAdminsPage />, { route: `/settings/admins?org=${ORG}` });
    expect((await screen.findByTestId('settings-parts-open', undefined, WAIT)).textContent).toBe(
      'Your access comes from your organisation. 1 part is open to you.',
    );
  });
});

describe('W-12 Users', () => {
  it('W12_users_sorting_line_is_not_shown_while_the_list_says_could_not_load', async () => {
    const qc = makeTestQueryClient();
    let fail = false;
    const items = Array.from({ length: 50 }, (_, i) => ({
      userId: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
      phone: '9000000001', displayName: `Example User ${i}`, email: null, apps: ['ShramSafal'], createdAt: '2026-01-12T09:00:00Z', lastLoginAt: null,
    }));
    stub = installAdapter(async () => (fail
      ? { status: 500, data: { message: 'x' } }
      : { status: 200, data: { data: { items, totalCount: 120, page: 1, pageSize: 50 }, meta: META } }));
    renderWithProviders(<UsersPage />, { route: `/users?org=${ORG}`, queryClient: qc });
    await screen.findByText(/Sorting a column orders the 50 .* on this page, not all 120/, undefined, WAIT);
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['users'] }); });
    await waitFor(() => expect(body()).toMatch(/Couldn.t load/), WAIT);
    expect(body()).not.toContain('Sorting a column orders');
  });
});

/* ═════════════════════════════════════════════════════════════ fix round 1 */

describe('round 1 I1: Live Health service row under the flag', () => {
  const r9flag = { rule: 'R9', state: 'not_judged', counted: null, outOf: null, windowStartUtc: null, windowEndUtc: null, reason: 'analytics_not_recording' };
  const health = (over: Record<string, unknown> = {}) => ({
    voiceInvocations24h: 0, voiceFailures24h: 0, voiceFailureRatePct: 0, voiceAvgLatencyMs: 0, voiceP95LatencyMs: 0,
    recentErrors: [], topSufferingFarms: [], apiErrorSpike: null, voiceDegraded: false,
    computedAtUtc: '2026-11-22T06:00:00Z', alertR9: r9flag, ...FLAG, ...over,
  });
  const serve = (qc: ReturnType<typeof makeTestQueryClient>, fail: () => boolean) => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/admin/ops/voice-check')) return neverSettles();
      if (req.url.includes('/admin/ops/health')) return fail() ? { status: 500, data: { message: 'x' } } : { status: 200, data: health() };
      return { status: 200, data: null };
    });
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}`, queryClient: qc });
  };

  it('I1_the_analytics_events_row_is_not_reporting_and_has_no_zero_rows', async () => {
    serve(makeTestQueryClient(), () => false);
    const table = await screen.findByRole('table', { name: 'Feeds this console depends on' }, WAIT);
    const row = [...table.querySelectorAll('tbody > tr')].find((tr) => (tr.textContent ?? '').includes('analytics.events · errors'))!;
    expect(row.textContent).toContain('Not recording');
    expect(row.textContent).not.toContain('Reporting');
    expect(table.textContent).not.toContain('an empty table means no events in the last two hours');
    expect(table.textContent).toContain(SENTENCE);
    expect(table.textContent).toContain('not measured');
    expect(table.textContent).not.toMatch(/Rows\s*0/);
  });

  it('I1_feed_down_does_not_offer_0_events_as_the_last_good_reading', async () => {
    const qc = makeTestQueryClient();
    let fail = false;
    serve(qc, () => fail);
    await screen.findByRole('table', { name: 'Feeds this console depends on' }, WAIT);
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['ops', 'health'] }); });
    await waitFor(() => expect(body()).toContain('Feed down since'), WAIT);
    expect(body()).toContain('events not measured at');
    expect(body()).not.toMatch(/\b0 events at/);
  });
});

describe('round 1 I2: API Errors shows no total while not measured', () => {
  it('I2_no_sort_line_and_no_window_total_under_the_flag_with_a_non_zero_total', async () => {
    const ev = { eventType: 'api.error', endpoint: 'POST /x', statusCode: 500, latencyMs: 9, farmId: null, occurredAtUtc: '2026-11-22T05:00:00Z' };
    const items = Array.from({ length: 50 }, (_, i) => ({ ...ev, occurredAtUtc: `2026-11-22T05:${String(i).padStart(2, '0')}:00Z` }));
    stub = installAdapter(async () => ({ status: 200, data: { data: { items, totalCount: 312, page: 1, pageSize: 50 }, meta: { ...META, ...FLAG } } }));
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    await screen.findByTestId('analytics-not-measured', undefined, WAIT);
    expect(body()).not.toContain('Sorting a column orders');
    expect(body()).not.toContain('312');
  });
});

describe('round 1 I3: All Farms counted number on a single page', () => {
  it('I3_a_one_page_list_states_the_counted_farms_and_the_test_farms_apart', async () => {
    const items = Array.from({ length: 12 }, (_, i) => farm(i + 1));
    stub = installAdapter(async () => ({ status: 200, data: { data: { items, totalCount: 9, testFarmsShown: 3, page: 1, pageSize: 40 }, meta: META } }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    await screen.findByRole('table', { name: 'All farms' }, WAIT);
    expect(body()).toContain('12 listed');
    expect(body()).toContain('9 farms counted');
    expect(screen.getByTestId('test-farms-not-counted').textContent).toBe('3 test farms are in the list but not counted.');
    expect(body()).not.toMatch(/(^|\D)12 farms(\D|$)/);
  });

  it('I3_without_test_farms_the_one_page_count_is_unchanged', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { data: { items: [farm(1), farm(2)], totalCount: 2, testFarmsShown: 0, page: 1, pageSize: 40 }, meta: META } }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    await screen.findByRole('table', { name: 'All farms' }, WAIT);
    expect(body()).not.toContain('counted');
  });
});

describe('round 1 m1 and parse: History window', () => {
  it('m1_when_the_read_limit_cuts_the_lines_it_does_not_say_exactly', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { lines: [], hitLimit: true, limit: 500 } }));
    renderWithProviders(<HistoryPage />, { route: '/people/history?action=phones_shown&fromUtc=2026-11-15T10:00:00Z&toUtc=2026-11-22T10:01:00Z&countedLooksOnly=true' });
    const note = await screen.findByTestId('history-exact-window', undefined, WAIT);
    await waitFor(() => expect(note.textContent).toContain('Showing only the newest lines of the lines the trust report counted'), WAIT);
    expect(note.textContent).toContain('at most 500');
    expect(note.textContent).not.toContain('Showing exactly');
  });

  it('parse_seven_fractional_digits_pass_through_to_the_request_unchanged', async () => {
    const from = '2026-11-15T10:00:00.1234567Z';
    const to = '2026-11-22T10:01:00.7654321Z';
    const s = installAdapter(async () => ({ status: 200, data: { lines: [], hitLimit: false, limit: 500 } }));
    stub = s;
    renderWithProviders(<HistoryPage />, { route: `/people/history?fromUtc=${from}&toUtc=${to}&countedLooksOnly=true` });
    await waitFor(() => expect(s.requests.length).toBeGreaterThan(0), WAIT);
    const url = s.requests[0].url;
    expect(url).toContain(`fromUtc=${encodeURIComponent(from)}`);
    expect(url).toContain(`toUtc=${encodeURIComponent(to)}`);
    expect(url).not.toContain('days=');
    // Reading for display never turns the fraction into NaN, even for an engine that refuses 7 digits.
    expect(parseInstantMs(from)).toBe(Date.parse('2026-11-15T10:00:00.123Z'));
    expect(parseInstantMs('nonsense')).toBeNaN();
  });
});

describe('round 1 m3: drilldown with no last entry', () => {
  it('m3_the_sentence_is_true_for_a_farm_whose_only_entries_are_by_test_accounts', async () => {
    const FARM = '22222222-2222-2222-2222-222222222222';
    const timeline = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10),
      closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: 1, errors: 0,
    }));
    const dto = {
      farmId: FARM, farmerName: 'Example Farmer', farmName: 'Example Mala', phone: '9000000012', score: null, timeline,
      syncState: { lastSyncAt: null }, aiHealth: null, verifications: null, workerSummary: [],
    };
    const scope = {
      outcome: 'Resolved',
      scope: { userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: false, modules: ['farmer.health', 'ops.errors', 'ops.voice'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })) },
      memberships: [{ orgId: ORG, orgName: 'Example FPO', orgType: 'FPO', orgRole: 'Owner' }],
    };
    stub = installAdapter(async (req) => (req.url.includes('/me/scope') ? { status: 200, data: scope } : req.url.includes('/admin/farmer-health/') ? { status: 200, data: dto } : { status: 404, data: {} }));
    renderWithProviders(
      <Routes>
        <Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} />
      </Routes>,
      { route: `/farmer-health/${FARM}?org=${ORG}` },
    );
    await waitFor(() => expect(body()).toContain('No entry by a farmer has reached the server yet; entries by test accounts are left out.'), WAIT);
    expect(body()).not.toContain('No entry from this farm has reached the server yet.');
  });
});

describe('round 1 m7: Home fetches no owner phones for a half it does not show', () => {
  it('m7_problems_not_measured_means_no_contact_fetch_for_the_suffering_farms', async () => {
    const F1 = 'aaaaaaaa-0000-0000-0000-000000000001';
    const scope = {
      outcome: 'Resolved',
      scope: { userId: 'u1', orgId: ORG, orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true, modules: ['farms.silent-churn', 'farms.suffering'].map((key) => ({ key, canRead: true, canExport: false, canWrite: false })) },
      memberships: [],
    };
    const cs = installContactsStub((r) => {
      if (r.path.endsWith('/me/scope')) return scope;
      if (r.path.endsWith('/admin/farms/silent-churn')) return { data: { countedAtUtc: '2026-11-22T06:00:00Z', farms: [], notMeasuredReason: null }, meta: META };
      if (r.path.endsWith('/admin/farms/suffering')) {
        return { data: [{ farmId: F1, problemCount: 5, syncProblems: 1, entryProblems: 1, voiceProblems: 1, otherProblems: 2, lastProblemAt: '2026-11-21T09:00:00Z' }], meta: { ...META, ...FLAG } };
      }
      return { data: null, meta: META };
    }, { [F1]: 'Example Mala' });
    stub = cs;
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
    await waitFor(() => expect(body()).toContain('Farms with repeated problems could not be counted.'), WAIT);
    await new Promise((r) => setTimeout(r, 200));
    expect(cs.contactCalls()).toHaveLength(0);
  });
});

/* ═════════════════════════════════════════════════════════════ fix round 2 */

describe('round 2', () => {
  it('R3_no_exact_window_note_while_History_is_loading_or_failed', async () => {
    stub = installAdapter(async () => neverSettles());
    renderWithProviders(<HistoryPage />, { route: '/people/history?action=phones_shown&fromUtc=2026-11-15T10:00:00Z&toUtc=2026-11-22T10:01:00Z&countedLooksOnly=true' });
    await screen.findByRole('status', { name: /Loading/ }, WAIT);
    expect(screen.queryByTestId('history-exact-window')).toBeNull();
    stub.restore();
    stub = installAdapter(async () => ({ status: 500, data: { message: 'x' } }));
    renderWithProviders(<HistoryPage />, { route: '/people/history?action=phones_shown&fromUtc=2026-11-15T10:00:00Z&toUtc=2026-11-22T10:01:00Z&countedLooksOnly=true' });
    await screen.findByText(/Couldn.t load History/, undefined, WAIT);
    expect(screen.queryByText(/Showing exactly/)).toBeNull();
  });

  it('R3_the_limit_line_states_the_number_of_lines_actually_shown_for_counted_looks', async () => {
    const lines = Array.from({ length: 3 }, (_, i) => ({
      atUtc: `2026-11-19T05:0${i}:00Z`, action: 'phones_shown', actorName: 'Example: A', subjectName: null, details: { page: 'farms' },
    }));
    stub = installAdapter(async () => ({ status: 200, data: { lines, hitLimit: true, limit: 500 } }));
    renderWithProviders(<HistoryPage />, { route: '/people/history?action=phones_shown&fromUtc=2026-11-15T10:00:00Z&toUtc=2026-11-22T10:01:00Z&countedLooksOnly=true' });
    await waitFor(() => expect(body()).toContain('Showing 3 lines, the newest the server read (at most 500). Older counted lines are not shown.'), WAIT);
    expect(body()).not.toContain('Showing the newest 500');
  });

  it('R7_a_server_that_hands_back_seven_fractional_digits_to_a_strict_engine_still_gets_its_window_unchanged', async () => {
    // A strict engine (older Safari) refuses more than three fractional digits. Old code judged the window by Date.parse and fell back to days=7.
    const real = Date.parse;
    const spy = vi.spyOn(Date, 'parse').mockImplementation((s: string) => (/\.\d{4,}/.test(s) ? Number.NaN : real(s)));
    try {
      const from = '2026-11-15T10:00:00.1234567Z';
      const to = '2026-11-22T10:01:00.7654321Z';
      const s = installAdapter(async () => ({ status: 200, data: { lines: [], hitLimit: false, limit: 500 } }));
      stub = s;
      renderWithProviders(<HistoryPage />, { route: `/people/history?fromUtc=${from}&toUtc=${to}&countedLooksOnly=true` });
      await waitFor(() => expect(s.requests.length).toBeGreaterThan(0), WAIT);
      const url = s.requests[0].url;
      expect(url).toContain(`fromUtc=${encodeURIComponent(from)}`);
      expect(url).toContain(`toUtc=${encodeURIComponent(to)}`);
      expect(url).not.toContain('days=');
      expect(parseInstantMs(from)).toBe(real('2026-11-15T10:00:00.123Z'));
    } finally {
      spy.mockRestore();
    }
  });

  it('item4_no_contact_lookup_for_a_problems_half_that_failed_or_is_forbidden', async () => {
    const F1 = 'aaaaaaaa-0000-0000-0000-000000000001';
    const scope = {
      outcome: 'Resolved',
      scope: { userId: 'u1', orgId: ORG, orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true, modules: ['farms.silent-churn', 'farms.suffering'].map((key) => ({ key, canRead: true, canExport: false, canWrite: false })) },
      memberships: [],
    };
    const qc = makeTestQueryClient();
    let fail = false;
    const cs = installContactsStub((r) => {
      if (r.path.endsWith('/me/scope')) return scope;
      if (r.path.endsWith('/admin/farms/silent-churn')) return { data: { countedAtUtc: '2026-11-22T06:00:00Z', farms: [], notMeasuredReason: null }, meta: META };
      if (r.path.endsWith('/admin/farms/suffering')) {
        if (fail) return { status: 500, data: { message: 'x' } } as never;
        return { data: [{ farmId: F1, problemCount: 5, syncProblems: 1, entryProblems: 1, voiceProblems: 1, otherProblems: 2, lastProblemAt: '2026-11-21T09:00:00Z' }], meta: META };
      }
      return { data: null, meta: META };
    }, { [F1]: 'Example Mala' });
    stub = cs;
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}`, queryClient: qc });
    await waitFor(() => expect(cs.contactCalls().length).toBe(1), WAIT);
    // A later failed re-read keeps the older rows in hand; the half no longer shows, so the lookup key empties.
    fail = true;
    await act(async () => { await qc.refetchQueries({ queryKey: ['farms', 'suffering'] }); });
    await waitFor(() => expect(body()).toMatch(/Could not load the farms with repeated problems list/), WAIT);
    const before = cs.contactCalls().length;
    await new Promise((r) => setTimeout(r, 200));
    expect(cs.contactCalls().length).toBe(before);
  });
});
