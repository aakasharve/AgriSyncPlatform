import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import raw from './fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import HomePage from '@/pages/HomePage';
import NorthStarPage from '@/pages/metrics/NorthStarPage';
import FarmsListPage from '@/pages/farms/FarmsListPage';
import OpsLivePage from '@/pages/ops/OpsLivePage';
import OpsErrorsPage from '@/pages/ops/OpsErrorsPage';
import FarmerHealthPage from '@/features/farmer-health/FarmerHealthPage';

/**
 * B24 (founder, 2026-11-17): every idea stays on its page as "Not built yet" with its two lines and no
 * number; a double is not shown; a page made only of ideas and doubles asks the old feeds for nothing.
 * Expected text is pinned from the reviewed lines file (fixtures/b24-metric-lines.json), not from the code.
 */

interface Entry { page: string; key: string; label: string; status: string; buildId: string; what?: string; why?: string }
const ENTRIES = (JSON.parse(raw) as Entry[]).filter((e) => !e.page.startsWith('MIS'));
const byId = (id: string) => ENTRIES.find((e) => e.buildId === id)!;

const ORG = '11111111-1111-1111-1111-111111111111';
const WAIT = { timeout: 15_000 };

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

const META = { source: 'live', window: '24h', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 60 };

/** Old feeds that still answer with plenty of values, so a page that reads them would draw them. */
function serveBusyFeeds() {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/admin/farms/suffering')) {
      return { status: 200, data: { data: [{ farmId: 'f1', name: 'Zzfarm', errorCount: 7, syncErrors: 2, logErrors: 0, voiceErrors: 5, lastErrorAt: '2026-08-31T09:15:00Z' }], meta: META } };
    }
    if (req.url.includes('/admin/farms/silent-churn')) {
      return { status: 200, data: { data: { countedAtUtc: '2026-09-01T08:30:00Z', farms: [{ farmId: 'f1', name: 'Zzfarm', ownerPhone: '9876543210', band: '7-13', daysSilent: 9, lastEntryUtc: null, planCode: null, planStatus: null }], notMeasuredReason: null }, meta: META } };
    }
    if (req.url.includes('/admin/farms')) {
      return { status: 200, data: { data: { items: [], totalCount: 0, page: 1, pageSize: 40 }, meta: META } };
    }
    return { status: 200, data: { data: null, meta: META } };
  });
  return stub;
}

function urls(): string[] {
  return (stub?.requests ?? []).map((r) => r.url);
}

/** The smallest element that holds the label, "Not built yet" (or `word`), the what line and the why line. */
function panelFor(id: string, word = 'Not built yet'): HTMLElement {
  const e = byId(id);
  const hits = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
    const t = el.textContent ?? '';
    return t.includes(e.label) && t.includes(word) && t.includes(e.what!) && t.includes(e.why!);
  });
  expect(hits.length, `panel for ${id} ${e.label}`).toBeGreaterThan(0);
  return hits.reduce((a, b) => ((a.textContent ?? '').length <= (b.textContent ?? '').length ? a : b));
}

/** Panel text with the label, the word and the two reviewed lines taken out: what is left must hold no digit. */
function residue(id: string, word = 'Not built yet'): string {
  const e = byId(id);
  return (panelFor(id, word).textContent ?? '').replace(e.label, '').replace(e.what!, '').replace(e.why!, '').replace(word, '');
}

function expectIdea(id: string, word = 'Not built yet') {
  const rest = residue(id, word);
  expect(rest, `${id} panel residue`).not.toMatch(/\d/);
  expect(rest.toLowerCase(), `${id} panel residue`).not.toMatch(/none|nobody|no data|—|–|\bn\/a\b/);
  expect(panelFor(id, word).querySelector('svg, canvas, table, ul, ol')).toBeNull();
}

function expectNoDoubleLabelsOf(page: string) {
  for (const e of ENTRIES.filter((x) => x.page === page && x.status === 'double')) {
    expect(screen.queryByText(e.label), `${e.buildId} ${e.label}`).toBeNull();
  }
}

describe('Home at /home holds its one idea and none of its doubles (B24)', () => {
  it('B24_Home_shows_H8_as_Not_built_yet_and_no_H1_to_H7', async () => {
    serveBusyFeeds();
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
    await waitFor(() => panelFor('H8'), WAIT);
    expectIdea('H8');
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 (the call list) became real. Retired: its Not built yet assertion; covered by HomePage.callList.test.tsx.
    expectNoDoubleLabelsOf('Home');
  });

  it('B24_Home_makes_no_request_to_the_old_feeds', async () => {
    serveBusyFeeds();
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
    await waitFor(() => panelFor('H8'), WAIT);
    await new Promise((r) => setTimeout(r, 300));
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, so Home now asks the suffering and silent-churn reads; it still asks for nothing else.
    for (const u of urls()) {
      expect(u).not.toContain('/admin/ops/health');
      expect(u).not.toContain('/admin/metrics/wvfd');
      // CR-2e C28: Home asks only silent-churn, suffering, contacts and the scope; never the all-farms list.
      expect(u, `Home asked for ${u}`).toMatch(/\/admin\/farms\/(silent-churn|suffering|contacts)|\/me\/scope/);
    }
  });
});

describe('WVFD is seven ideas and asks for nothing (B24)', () => {
  it('B24_WVFD_shows_W1_to_W4_W6_W7_as_Not_built_yet_and_W5_as_Goal_not_set_yet', async () => {
    serveBusyFeeds();
    renderWithProviders(<NorthStarPage />, { route: `/metrics/nsm?org=${ORG}` });
    await waitFor(() => panelFor('W1'), WAIT);
    for (const id of ['W1', 'W2', 'W3', 'W4', 'W6', 'W7']) expectIdea(id);
    expectIdea('W5', 'Goal not set yet');
    expect(panelFor('W5', 'Goal not set yet').textContent).not.toContain('Not built yet');
    // D-151 b: no share of the goal is shown and the old 4.5 constant is gone.
    expect(document.body.textContent).not.toMatch(/4\.5/);
    expect(document.body.textContent).not.toMatch(/of goal/i);
  });

  it('B24_WVFD_makes_no_request_to_the_wvfd_feed', async () => {
    serveBusyFeeds();
    renderWithProviders(<NorthStarPage />, { route: `/metrics/nsm?org=${ORG}` });
    await waitFor(() => panelFor('W7'), WAIT);
    await new Promise((r) => setTimeout(r, 300));
    for (const u of urls()) expect(u).not.toContain('/admin/metrics/wvfd');
  });
});

describe('The Farmer Health landing is ideas only (B24; Silent Churn and Suffering are real since CR-2e)', () => {
  // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): S1, S2 and S3 became real. Retired: B24_Silent_Churn_shows_S1_S2_S3_as_ideas_and_never_draws_the_feed; covered by SilentChurnPage.real.test.tsx.

  // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): U1 became real. Retired: B24_Suffering_shows_U1_and_U2_as_ideas_and_never_draws_the_feed (U2 became real too); covered by SufferingPage.real.test.tsx.

  it('B24_Farmer_Health_landing_shows_FH1_FH2_FH4_FH5_as_ideas_without_FH3_FH6_and_no_cohort_call', async () => {
    serveBusyFeeds();
    renderWithProviders(<FarmerHealthPage />, { route: `/farmer-health?org=${ORG}` });
    await waitFor(() => panelFor('FH1'), WAIT);
    for (const id of ['FH1', 'FH2', 'FH4', 'FH5']) expectIdea(id);
    expectNoDoubleLabelsOf('Farmer Health');
    await new Promise((r) => setTimeout(r, 300));
    for (const u of urls()) {
      expect(u).not.toContain('farmer-health/cohort');
      expect(u).not.toContain('suffering');
    }
  });
});

describe('Live Health keeps L6 and L8, parks L1, drops L2 to L5 (B24)', () => {
  it('B24_Live_Health_shows_L1_as_an_idea_and_none_of_L2_to_L5', async () => {
    serveBusyFeeds();
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await waitFor(() => panelFor('L1'), WAIT);
    expectIdea('L1');
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): L7 became real; its idea assertion is retired (OpsLivePage.repeated.test.tsx).
    expectNoDoubleLabelsOf('Live Health');
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it('B24_Live_Health_still_calls_the_health_feed_and_keeps_its_two_real_parts', async () => {
    serveBusyFeeds();
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await waitFor(() => expect(urls().some((u) => u.includes('/admin/ops/health'))).toBe(true), WAIT);
    for (const id of ['L6', 'L8']) {
      const e = byId(id);
      expect(document.body.textContent).toContain(e.what!);
      expect(document.body.textContent).toContain(e.why!);
    }
  });
});

describe('column ideas keep their header, print no value, and carry their lines under the table (B24)', () => {
  it('B24_All_Farms_marks_Tier_and_WVFD_7d_and_prints_no_served_value_for_them', async () => {
    stub = installAdapter(async () => ({
      status: 200,
      data: {
        data: {
          items: [{ farmId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Zzfarm', ownerPhone: '9876543210', plan: 'trial', wvfd7d: 4.7, engagementTier: 'B', errors24h: 11, lastLogAt: '2026-08-24T09:00:00Z', createdAt: '2024-03-12T09:00:00Z' }],
          totalCount: 1, page: 1, pageSize: 40,
        },
        meta: META,
      },
    }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    const table = await screen.findByRole('table', { name: 'All farms' }, WAIT);
    await screen.findByText('Zzfarm', undefined, WAIT);
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): F6 became real; it is asserted in FarmsListPage.errors.test.tsx.
    for (const id of ['F4', 'F5']) {
      const e = byId(id);
      const th = within(table).getAllByRole('columnheader').find((h) => (h.textContent ?? '').includes(e.label));
      expect(th, `${id} header kept`).toBeTruthy();
      expect(th!.textContent).toContain('Not built yet');
      expect(document.body.textContent).toContain(e.what!);
      expect(document.body.textContent).toContain(e.why!);
    }
    const row = within(table).getByText('Zzfarm').closest('tr')!;
    expect(row.textContent).not.toMatch(/4\.7|\bB\b/);
    // the real parts of the row still print their values
    expect(row.textContent).toContain('9876543210');
    // the tier filter is disabled
    const group = screen.getByRole('group', { name: /tier/i });
    const buttons = within(group).queryAllByRole('button');
    for (const b of buttons) expect(b).toBeDisabled();
    expect(group.textContent).toContain('Not built yet');
  });

  it('B24_API_Errors_keeps_the_error_list_and_the_E1_E2_lines', async () => {
    stub = installAdapter(async () => ({
      status: 200,
      data: {
        data: {
          items: [{ eventType: 'api.error', endpoint: 'POST /shramsafal/sync/push', statusCode: 500, latencyMs: 40, farmId: 'aaaaaaaa-0000-0000-0000-000000000001', occurredAtUtc: '2026-09-01T07:00:00Z' }],
          totalCount: 1, page: 1, pageSize: 40,
        },
        meta: META,
      },
    }));
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    const table = await screen.findByRole('table', { name: 'API errors' }, WAIT);
    await within(table).findAllByRole('columnheader', undefined, WAIT);
    // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): E3 became real. Retired: the Not built yet header and the withheld farm id; covered by OpsErrorsPage.farm.test.tsx.
    // B25: the farm test also proves an error row was rendered (the farm id above is withheld from a real row,
    // not from an empty table), and the standing note no longer claims an error "can name a farm".
    const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.querySelector('td'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('/shramsafal/sync/push');
    expect(rows[0].textContent).toContain('500');
    expect(document.body.textContent).not.toMatch(/can name a farm/i);
    for (const id of ['E1', 'E2']) expect(document.body.textContent).toContain(byId(id).what!);
  });
});
