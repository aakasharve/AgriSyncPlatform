import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import { installContactsStub, type ContactsStub } from '@/test/contactsStub';
import type { FarmSummary } from '@/hooks/useFarms';
import type { OpsHealthData } from '@/hooks/useOpsHealth';
import AppVersionsPage from '@/pages/ops/AppVersionsPage';
import SufferingPage from '@/pages/farms/SufferingPage';
import OpsLivePage from '@/pages/ops/OpsLivePage';
import FarmsListPage from '@/pages/farms/FarmsListPage';
import { FarmerTimeline } from '@/features/farmer-health/components/FarmerTimeline';
import { METRIC_LINES } from '@/app/metricLines';

/**
 * Gate 1 bar (founder 2026-11-25): "each number on admin console is real. If that is not real yet, just disable and
 * display the message why isn't real yet, and the numbers should not lie." Box inventory
 * `_COFOUNDER/.../session-notes/gate1-box-inventory-2026-11-25.md`, risks R6-R9. Each test fails on the console as it
 * was at join 3ae676a1 and pins the words that make the box honest. Every value is made up.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'last 7 days', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 30 };

let adapter: StubbedAdapter | null = null;
let contacts: ContactsStub | null = null;
afterEach(() => {
  adapter?.restore();
  adapter = null;
  contacts?.restore();
  contacts = null;
  localStorage.clear();
});

const farmId = (n: number) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('R6: App Versions "People on an older version" says it is a lower bound', () => {
  it('Older_version_figure_says_only_apps_that_report_their_version_are_counted', async () => {
    const answer = {
      days: 7,
      measuredSinceUtc: '2026-11-12T00:00:00Z',
      people: 41, phones: 37, otherDevices: 5, peopleWithUnknownDevice: 3,
      newestVersion: '1.0.19', legacyVersionNumber: '0.9.0',
      versions: [
        { appVersion: '1.0.19', people: 29, isNewest: true },
        { appVersion: '1.0.18', people: 8, isNewest: false },
      ],
      onOlderVersions: [],
    };
    adapter = installAdapter(async () => ({ status: 200, data: { data: answer, meta: META } }));
    renderWithProviders(<AppVersionsPage />, { route: '/ops/app-versions' });
    await screen.findByRole('table', { name: 'App versions in use' }, SETTLE);

    const tile = screen.getByText('People on an older version').closest<HTMLElement>('[data-state]')!;
    expect(tile.firstElementChild?.textContent).toBe('8');
    // The figure is real but partial: an app that does not report its version, or a phone not seen since counting
    // began, is not in it. It must say so, or a 0 reads as "everyone is up to date".
    expect(within(tile).getByText(/At least this many/)).toBeInTheDocument();
    expect(within(tile).getByText(/only apps that report their version/i)).toBeInTheDocument();
    expect(within(tile).getByText(/12 Nov 2026/)).toBeInTheDocument();
  });
});

describe('R9: a list the server caps says so when it is full', () => {
  const sufferingRow = (n: number) => ({
    farmId: farmId(n), problemCount: 3, syncProblems: 1, entryProblems: 1, voiceProblems: 1, otherProblems: 0,
    lastProblemAt: '2026-08-31T09:15:00Z',
  });

  it('Suffering_says_first_50_when_the_server_sent_50_farms', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => sufferingRow(i + 1));
    contacts = installContactsStub((r) => (r.path.endsWith('/admin/farms/suffering') ? { data: rows, meta: META } : { data: null, meta: META }), {});
    renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
    await screen.findByRole('table', { name: 'Farms with repeated problems' }, SETTLE);
    const note = await screen.findByTestId('list-capped', undefined, SETTLE);
    expect(note.textContent).toMatch(/at most 50 farms/);
    expect(note.textContent).toMatch(/may be more/);
  });

  it('Suffering_says_nothing_about_a_cap_when_the_list_is_short', async () => {
    const rows = [sufferingRow(1), sufferingRow(2)];
    contacts = installContactsStub((r) => (r.path.endsWith('/admin/farms/suffering') ? { data: rows, meta: META } : { data: null, meta: META }), {});
    renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
    await screen.findByRole('table', { name: 'Farms with repeated problems' }, SETTLE);
    expect(screen.queryByTestId('list-capped')).toBeNull();
  });

  const health = (n: number): OpsHealthData => ({
    voiceInvocations24h: 0, voiceFailures24h: 0, voiceFailureRatePct: 0, voiceAvgLatencyMs: 0, voiceP95LatencyMs: 0,
    recentErrors: [], apiErrorSpike: false, voiceDegraded: false,
    computedAtUtc: new Date(Date.now() - 60_000).toISOString(),
    topSufferingFarms: Array.from({ length: n }, (_, i) => ({
      farmId: farmId(i + 1), errorCount: 2, syncErrors: 1, logErrors: 1, voiceErrors: 0, otherErrors: 0,
      lastErrorAt: '2026-09-01T10:00:00Z',
    })),
  } as OpsHealthData);

  it('Live_health_says_first_10_when_the_server_sent_10_farms', async () => {
    contacts = installContactsStub(() => health(10), {});
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await screen.findByRole('table', { name: 'Farms with repeated problems, last 24 hours' }, SETTLE);
    const note = await screen.findByTestId('repeated-capped', undefined, SETTLE);
    expect(note.textContent).toMatch(/at most 10 farms/);
    expect(note.textContent).toMatch(/may be more/);
  });

  it('Live_health_says_nothing_about_a_cap_when_the_list_is_short', async () => {
    contacts = installContactsStub(() => health(2), {});
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    await screen.findByRole('table', { name: 'Farms with repeated problems, last 24 hours' }, SETTLE);
    expect(screen.queryByTestId('repeated-capped')).toBeNull();
  });
});

describe('R8: All Farms "Last Log" says test accounts are in it', () => {
  it('Last_log_line_says_test_accounts_are_included_and_silent_churn_differs', async () => {
    const line = METRIC_LINES.find((l) => l.key === 'farms-last-log')!;
    expect(line.what).toMatch(/test accounts included/);
    expect(line.what).toMatch(/Silent Churn/);

    const farm = {
      farmId: farmId(1), name: 'Bhosale Mala', ownerPhone: '9876543210', plan: 'trial', wvfd7d: null,
      engagementTier: null, errors24h: 0, lastLogAt: '2026-08-24T09:00:00Z', createdAt: '2024-03-12T09:00:00Z',
    } as FarmSummary;
    adapter = installAdapter(async () => ({
      status: 200,
      data: { data: { items: [farm], totalCount: 1, page: 1, pageSize: 40 }, meta: { ...META, source: 'live-aggregated' } },
    }));
    renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
    await screen.findByText('Bhosale Mala', undefined, SETTLE);
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-metric="farms-last-log"]');
      expect(el?.textContent).toContain('test accounts included');
    }, SETTLE);
  });
});

describe('R7: the drilldown timeline says which rows the app reported', () => {
  it('Timeline_says_started_submitted_proof_and_summary_are_reported_by_the_app', () => {
    const day = (date: string, n: number) => ({
      date, closuresStarted: n, closuresSubmitted: n, proofAttached: 0, summariesViewed: n, verifications: 1, errors: 0,
    });
    render(<FarmerTimeline timeline={[day('2026-09-01', 2), day('2026-09-02', 0)]} />);
    const note = screen.getByTestId('app-reported-rows');
    expect(note.textContent).toMatch(/Started, Submitted, Proof and Summary/);
    expect(note.textContent).toMatch(/reported by the app/);
    expect(note.textContent).toMatch(/offline|older app/);
  });
});
