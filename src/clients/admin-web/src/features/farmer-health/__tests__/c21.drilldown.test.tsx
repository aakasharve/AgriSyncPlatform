import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import type { FarmSummary } from '@/hooks/useFarms';
import FarmsListPage from '@/pages/farms/FarmsListPage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import FarmerHealthDrilldown from '../FarmerHealthDrilldown';

/**
 * CR-2e Task 3, page part (C21, C23): the one-farm page shows real values.
 *
 * Written from the spec alone. The answer below carries the real field names the
 * server sends: `farmerName` (the owner, nullable), `farmName`, `phone`, `score`
 * null, `timeline` rows with `verifications` and `errors`, `syncState.lastSyncAt`,
 * `aiHealth.{voice,receipt,patti}.{finishedJobs14d,savedJobs14d,savedPct14d,
 * notMeasuredReason}`, `verifications.{confirmed,verified,disputed,pending,
 * selfChecked}` and `workerSummary`.
 */

interface Entry { page: string; label: string; status: string; buildId: string; what?: string; why?: string }
const LINES = JSON.parse(raw) as Entry[];
const line = (id: string) => LINES.find((e) => e.buildId === id)!;

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = '22222222-2222-2222-2222-222222222222';
const WAIT = { timeout: 15_000 };

const OWNER = 'Zzowner Unique';
const FARM_NAME = 'Zzfarm Unique Mala';
const PHONE = '9811122233';

/** Fourteen India days from 2026-08-18; the marker counts are small and distinct. */
function fourteenDays() {
  const days = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10),
    closuresStarted: 0, closuresSubmitted: 0, proofAttached: 0, summariesViewed: 0, verifications: 0, errors: 0,
  }));
  days[10] = { ...days[10], closuresStarted: 2, verifications: 3, errors: 2 };
  days[12] = { ...days[12], closuresStarted: 4, verifications: 7, errors: 5 };
  days[13] = { ...days[13], closuresStarted: 1, verifications: 1, errors: 1 };
  return days;
}

const MEASURED_VOICE = { finishedJobs14d: 23, savedJobs14d: 19, savedPct14d: 82.6, notMeasuredReason: null };
const RECEIPT_NOT_RECORDED = { finishedJobs14d: 11, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' };
const PATTI_NOT_RECORDED = { finishedJobs14d: 4, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'saved_not_recorded' };

function answer(over: Record<string, unknown> = {}) {
  return {
    farmId: FARM,
    farmerName: OWNER,
    farmName: FARM_NAME,
    phone: PHONE,
    score: null,
    timeline: fourteenDays(),
    syncState: { lastSyncAt: '2026-08-30T09:05:00.0000000Z' },
    aiHealth: { voice: MEASURED_VOICE, receipt: RECEIPT_NOT_RECORDED, patti: PATTI_NOT_RECORDED },
    verifications: { confirmed: 41, verified: 52, disputed: 3, pending: 19, selfChecked: 67 },
    workerSummary: [
      { workerId: 'w-1', name: 'Zzworker First', assignmentCount: 29, firstSeenUtc: '2026-07-02T04:00:00.0000000Z' },
      { workerId: 'w-2', name: 'रामू', assignmentCount: 17, firstSeenUtc: '2026-07-09T04:00:00.0000000Z' },
    ],
    ...over,
  };
}

const scope = {
  outcome: 'Resolved',
  scope: {
    userId: 'u1', orgId: ORG, orgType: 'FPO', orgRole: 'Owner', isPlatformAdmin: true,
    modules: ['farmer.health', 'farms.list'].map((key) => ({ key, canRead: true, canWrite: false, canExport: false })),
  },
  memberships: [{ orgId: ORG, orgName: 'Nashik Grape FPO', orgType: 'FPO', orgRole: 'Owner' }],
};

let stub: StubbedAdapter | null = null;
afterEach(() => {
  vi.useRealTimers();
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(body: unknown, status = 200) {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/me/scope')) return { status: 200, data: scope };
    if (req.url.includes('/admin/farmer-health/')) return { status, data: body };
    return { status: 404, data: {} };
  });
}

function mount() {
  renderWithProviders(
    <Routes><Route path="/farmer-health/:farmId" element={<FarmerHealthDrilldown />} /></Routes>,
    { route: `/farmer-health/${FARM}?org=${ORG}` },
  );
}

async function shown(body: unknown = answer(), status = 200) {
  serve(body, status);
  mount();
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /^Loading/ })).toHaveLength(0), WAIT);
  await waitFor(() => expect(document.querySelector('[data-band="header"]')).not.toBeNull(), WAIT);
}

const feedRequests = () => (stub?.requests ?? []).filter((r) => r.url.includes('/admin/farmer-health/'));
const metric = (key: string) => document.querySelector<HTMLElement>(`[data-metric="${key}"]`);
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

describe('the one-farm page, real values (C21)', () => {
  it('The_page_shows_name_checks_workers_and_reading', async () => {
    await shown();

    // P1: the owner's name, the farm's name and the owner's phone
    const p1 = metric('fh-name-phone')!;
    expect(p1, 'P1 block').not.toBeNull();
    expect(p1.textContent).toContain(OWNER);
    expect(p1.textContent).toContain(FARM_NAME);
    expect(p1.textContent).toContain(PHONE);
    expect(p1.textContent).not.toMatch(/Not built yet/);

    // P6: the five counts, served values, each on its own row
    const p6 = metric('fh-verification-counts')!;
    expect(p6, 'P6 block').not.toBeNull();
    const rowText = (key: string) => txt(p6.querySelector(`[data-count="${key}"]`));
    expect(rowText('confirmed')).toMatch(/Confirmed\s*41$/);
    expect(rowText('verified')).toMatch(/Verified\s*52$/);
    expect(rowText('disputed')).toMatch(/Disputed\s*3$/);
    expect(rowText('pending')).toMatch(/[Ww]aiting[^0-9]*19$/);
    expect(rowText('selfChecked')).toMatch(/Checked only by the person who saved it\s*67$/);

    // P7: workers by name with their mention counts, most-named first
    const p7 = metric('fh-workers')!;
    expect(p7, 'P7 block').not.toBeNull();
    const names = [...p7.querySelectorAll('li')].map((li) => txt(li));
    expect(names).toHaveLength(2);
    expect(names[0]).toContain('Zzworker First');
    expect(names[0]).toMatch(/29/);
    expect(names[1]).toContain('रामू');
    expect(names[1]).toMatch(/17/);

    // P10 and P11: the voice share and the counts of what was read
    const rates = metric('fh-reading-rates')!;
    expect(rates, 'P10 block').not.toBeNull();
    expect(txt(rates.querySelector('[data-reading="voice"]'))).toContain('82.6%');
    const counts = metric('fh-reading-count')!;
    expect(counts, 'P11 block').not.toBeNull();
    expect(txt(counts.querySelector('[data-count="voice"]'))).toMatch(/23$/);
    expect(txt(counts.querySelector('[data-count="receipt"]'))).toMatch(/11$/);
    expect(txt(counts.querySelector('[data-count="patti"]'))).toMatch(/4$/);

    // P3 and P8 are still real
    expect(document.querySelector('[data-band="timeline"] table')).not.toBeNull();
    expect(txt(metric('fh-last-activity'))).toMatch(/30 Aug|Aug 30|30\/08|30-08|2026-08-30/);
  });

  it('a null owner name says Name not recorded, and never the farm name or the farm id in its place', async () => {
    await shown(answer({ farmerName: null }));
    const p1 = metric('fh-name-phone')!;
    expect(txt(p1.querySelector('[data-field="farmer-name"]'))).toBe('Name not recorded');
    expect(p1.textContent).toContain(FARM_NAME);
    expect(p1.textContent).toContain(PHONE);
    expect(p1.textContent).not.toContain(OWNER);
  });

  it('Score_and_refused_uploads_stay_not_built_yet', async () => {
    // A server that still sent the old score and refused-upload fields must not get them drawn.
    const legacy = answer({
      score: { total: 5858, bucket: 'watchlist', flag: 'ok', weekStart: '2026-08-24', pillars: { triggerFit: 6.4, actionSimplicity: 14, proof: 9.5, reward: 3.2, investment: 0, repeat: 25 } },
      syncState: {
        lastSyncAt: '2026-08-30T09:05:00.0000000Z', pendingPushes: 0, failedPushesLast7d: 6143,
        lastErrors: [{ ts: '2026-08-30T08:00:00Z', endpoint: '/sync/zzpush', status: 500, message: 'zzboom' }],
      },
    });
    await shown(legacy);

    for (const [key, id] of [['fh-score', 'P2'], ['fh-failed-uploads', 'P9']] as const) {
      const el = metric(key)!;
      expect(el, `${id} block`).not.toBeNull();
      expect(el).toHaveAttribute('data-state', 'not-built-yet');
      expect(el.textContent).toContain('Not built yet');
      expect(el.textContent).toContain(line(id).label);
      expect(el.textContent).toContain(line(id).what!);
      expect(el.textContent).toContain(line(id).why!);
      // nothing in the block but the label, the mark and the two lines: no value
      expect(txt(el), `${id} block carries more than its lines`).toBe(
        txt({ textContent: `${line(id).label}Not built yet${line(id).what}${line(id).why}` } as Element),
      );
    }
    const all = document.body.textContent ?? '';
    for (const v of ['5858', '6143', 'zzboom', '/sync/zzpush']) expect(all, v).not.toContain(v);
    // and nothing else on the page is "Not built yet" except these two
    expect(document.querySelectorAll('[data-state="not-built-yet"]')).toHaveLength(2);
  });

  it('A_kind_not_measured_says_so_never_a_percent', async () => {
    // receipt and patti: saved_not_recorded
    await shown();
    const rates = metric('fh-reading-rates')!;
    for (const kind of ['receipt', 'patti']) {
      const li = rates.querySelector(`[data-reading="${kind}"]`)!;
      expect(li, kind).not.toBeNull();
      expect(li.textContent, `${kind} shows a percent`).not.toContain('%');
      expect(li.querySelector('[data-share]'), `${kind} share element`).toBeNull();
      const words = txt(li).replace(/^[^:]*:\s*/, '');
      expect(words, `${kind} says nothing in words`).toMatch(/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/);
    }
    // their job counts are real and stay
    expect(txt(metric('fh-reading-count')!.querySelector('[data-count="receipt"]'))).toMatch(/11$/);
    // the measured kind keeps its percent
    expect(txt(rates.querySelector('[data-reading="voice"]'))).toContain('82.6%');
  });

  it('A_kind_not_measured_says_so_never_a_percent: a voice kind with nothing read shows words', async () => {
    const quiet = { finishedJobs14d: 0, savedJobs14d: null, savedPct14d: null, notMeasuredReason: 'denominator_zero' };
    await shown(answer({ aiHealth: { voice: quiet, receipt: RECEIPT_NOT_RECORDED, patti: PATTI_NOT_RECORDED } }));
    const rates = metric('fh-reading-rates')!;
    const voice = rates.querySelector('[data-reading="voice"]')!;
    expect(voice.textContent, 'a share was drawn for a kind that read nothing').not.toContain('%');
    expect(voice.querySelector('[data-share]')).toBeNull();
    const words = txt(voice).replace(/^[^:]*:\s*/, '');
    expect(words).toMatch(/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/);
    // the whole block has no percent at all now
    expect(rates.textContent).not.toContain('%');
    // the count of recordings read is a real zero
    expect(txt(metric('fh-reading-count')!.querySelector('[data-count="voice"]'))).toMatch(/0$/);
  });

  it('the five check counts render the served numbers, including a true zero', async () => {
    await shown(answer({ verifications: { confirmed: 0, verified: 8, disputed: 0, pending: 0, selfChecked: 14 } }));
    const p6 = metric('fh-verification-counts')!;
    const val = (key: string) => txt(p6.querySelector(`[data-count="${key}"] dd`));
    expect(val('confirmed')).toBe('0');
    expect(val('verified')).toBe('8');
    expect(val('disputed')).toBe('0');
    expect(val('pending')).toBe('0');
    expect(val('selfChecked')).toBe('14');
    expect(p6.textContent).toContain('Checked only by the person who saved it');
  });

  it('the Checked and Errors rows render the served values with the same scale rules as the real rows', async () => {
    await shown();
    const tl = document.querySelector<HTMLElement>('[data-band="timeline"]')!;
    expect(tl.querySelectorAll('[data-cell]')).toHaveLength(6 * 14);
    expect(tl.textContent).not.toMatch(/Not built yet/);

    const cell = (row: string, i: number) => tl.querySelector<HTMLElement>(`[data-cell="${row}:${fourteenDays()[i].date}"]`)!;
    // the served values sit in the cells, and in the tooltip
    expect(cell('verifications', 10).textContent?.trim()).toBe('3');
    expect(cell('verifications', 12).textContent?.trim()).toBe('7');
    expect(cell('verifications', 13).textContent?.trim()).toBe('1');
    expect(cell('errors', 10).textContent?.trim()).toBe('2');
    expect(cell('errors', 12).textContent?.trim()).toBe('5');
    expect(cell('errors', 13).textContent?.trim()).toBe('1');
    expect(cell('verifications', 12).title).toMatch(/Checked.*: 7$/);
    expect(cell('errors', 12).title).toMatch(/Errors.*: 5$/);
    // each row is shaded against its own busiest day; zero days carry no shade
    for (const row of ['verifications', 'errors']) {
      expect(cell(row, 12).style.backgroundColor, `${row} busiest`).toContain('95%');
      expect(cell(row, 10).style.backgroundColor, `${row} smaller day`).not.toContain('95%');
      expect(cell(row, 10).style.backgroundColor, `${row} smaller day shade`).not.toBe('');
      expect(cell(row, 0).style.backgroundColor, `${row} zero day`).toBe('');
      expect(cell(row, 0).textContent?.trim()).toBe('');
    }
    // errors are the failure colour, checks are not
    expect(cell('errors', 12).style.backgroundColor).toContain('--color-red-vivid');
    expect(cell('verifications', 12).style.backgroundColor).not.toContain('--color-red-vivid');
    // the exact-figures table carries the same numbers
    const table = tl.querySelector('[data-timeline-table]')!;
    const row12 = [...table.querySelectorAll('tbody tr')][12];
    // columns: Started, Submitted, Proof, Summary, Checked, Errors
    expect([...row12.querySelectorAll('td')].map((c) => c.textContent?.trim())).toEqual(['4', '0', '0', '0', '7', '5']);
  });
});

describe('the one-farm page, when the answer is not a farm (C21)', () => {
  it('a 403 shows the no-access state, with the header kept and no data', async () => {
    await shown({ code: 'admin_platform_only' }, 403);
    expect(screen.getByText('This screen is for Platform owners only.')).toBeInTheDocument();
    expect(document.querySelector('[data-band="header"]')!.textContent).toContain(FARM);
    expect(metric('fh-name-phone')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Farm not found/);
  });

  it('a 404 says the farm was not found', async () => {
    await shown({}, 404);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
    expect(document.querySelector('[data-band="header"]')!.textContent).toContain(FARM);
    expect(metric('fh-name-phone')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(feedRequests()).toHaveLength(1);
  });

  it('any other failure says it could not load, with Retry', async () => {
    await shown({}, 500);
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Farm not found/);
    expect(document.body.textContent).not.toMatch(/Platform owners only/);
    expect(metric('fh-name-phone')).toBeNull();
  });
});

describe('the one-farm page never polls (C21)', () => {
  it('The_page_does_not_poll', async () => {
    // fake timers from BEFORE mount, so a refetch interval set at mount would be caught
    vi.useFakeTimers();
    serve(answer());
    mount();
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(250);
    expect(metric('fh-name-phone'), 'the page did not render under fake timers').not.toBeNull();
    expect(feedRequests()).toHaveLength(1);

    // two minutes, in steps, so every interval a hook could have set comes due more than once
    for (let i = 0; i < 24; i++) await vi.advanceTimersByTimeAsync(5_000);
    expect(feedRequests(), 'the one-farm page asked again without being asked').toHaveLength(1);
  });
});

describe('All Farms rows link to the one-farm page (C21)', () => {
  const farm = (over: Partial<FarmSummary>): FarmSummary => ({
    farmId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'भोसले मळा', ownerPhone: '9876543210', plan: 'trial',
    wvfd7d: 4.2, engagementTier: 'A', errors24h: 0, lastLogAt: '2026-08-24T09:00:00Z', createdAt: '2024-03-12T09:00:00Z', ...over,
  });

  function Probe() {
    const l = useLocation();
    return <span data-testid="url">{l.pathname}</span>;
  }

  it('All_farms_rows_link_to_the_one_farm_page', async () => {
    const user = userEvent.setup();
    const items = [
      farm({ farmId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'First farm' }),
      farm({ farmId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Second farm' }),
    ];
    stub = installAdapter(async () => ({
      status: 200,
      data: {
        data: { items, totalCount: items.length, page: 1, pageSize: 40 },
        meta: { source: 'live-aggregated', window: 'current', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 60 },
      },
    }));
    renderWithProviders(
      <>
        <Routes>
          <Route path="/farms" element={<FarmsListPage />} />
          <Route path="/farmer-health/:farmId" element={<div data-testid="one-farm-page" />} />
        </Routes>
        <Probe />
      </>,
      { route: `/farms?org=${ORG}` },
    );

    const table = await screen.findByRole('table', { name: 'All farms' }, WAIT);
    const rows = () => [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter((tr) => !tr.id.includes('detail'));
    await waitFor(() => expect(rows()).toHaveLength(2), WAIT);

    // each row opens to a link whose address is the one-farm page for THAT row's farm id
    for (const item of items) {
      const row = rows().find((r) => r.textContent?.includes(item.name))!;
      await user.click(row);
      await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'), WAIT);
      const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/farmer-health/"]')].map((a) => a.getAttribute('href')!);
      expect(hrefs.some((h) => h.split('?')[0] === `/farmer-health/${item.farmId}`), `${item.name}: ${hrefs.join(' ')}`).toBe(true);
    }

    // following the second farm's link lands on the one-farm page, not on Home or a list
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/farmer-health/"]')].find((a) =>
      a.getAttribute('href')!.includes('bbbbbbbb-0000-0000-0000-000000000002'))!;
    await user.click(link);
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/farmer-health/bbbbbbbb-0000-0000-0000-000000000002'), WAIT);
    expect(within(document.body).getByTestId('one-farm-page')).toBeInTheDocument();
  });
});
