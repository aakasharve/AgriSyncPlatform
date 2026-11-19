import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter } from '@/test/stubAdapter';
import type { CapturedRequest, StubbedAdapter } from '@/test/stubAdapter';
import type { FarmSummary } from '@/hooks/useFarms';
import FarmsListPage from '../FarmsListPage';

/**
 * CR-2e Task 6, amendments C32 (F4, F5) and C33 (a farm "not measured", the 409 and 400 refusals). Expected text is the
 * plan's: "2 checked, 3 self-confirmed", "No entry last week", the two lines of F4 and F5, and the tier cut-offs.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live-aggregated', window: 'current', lastRefreshedUtc: '2026-11-19T04:00:00.000Z', ttlSeconds: 60 };
const F = (n: number) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

type Row = FarmSummary & { selfOnlyDays7d?: number | null; confirmedDaysNotMeasuredReason?: string | null };
function farm(n: number, name: string, over: Partial<Row> = {}): Row {
  return {
    farmId: F(n), name, ownerPhone: `90000000${String(n).padStart(2, '0')}`, plan: 'trial',
    wvfd7d: 3, selfOnlyDays7d: 2, engagementTier: 'B',
    errors24h: 0, lastLogAt: '2026-11-17T09:00:00Z', createdAt: '2024-03-12T09:00:00Z',
    ...over,
  };
}
const envelope = (items: Row[]) => ({ data: { items, totalCount: items.length, page: 1, pageSize: 40 }, meta: META });

let stub: StubbedAdapter | null = null;
afterEach(() => {
  vi.useRealTimers();
  stub?.restore();
  stub = null;
  localStorage.clear();
});

const farmsCalls = () => stub!.requests.filter((r) => /\/admin\/farms\?/.test(r.url));
const lastFarmsCall = (): CapturedRequest => farmsCalls()[farmsCalls().length - 1];
const queryOf = (r: CapturedRequest) => new URL(r.url, 'http://x').searchParams;

function serve(items: Row[]) {
  stub = installAdapter(async () => ({ status: 200, data: envelope(items) }));
}
/** A server that filters by the tier it is sent, like the real one. */
function serveByTier(all: Row[]) {
  stub = installAdapter(async (req) => {
    const tier = queryOf(req).get('tier');
    return { status: 200, data: envelope(tier ? all.filter((f) => f.engagementTier === tier) : all) };
  });
}
function renderFarms(route = `/farms?org=${ORG}`, queryClient?: QueryClient) {
  return renderWithProviders(<FarmsListPage />, { route, ...(queryClient ? { queryClient } : {}) });
}
const table = () => screen.findByRole('table', { name: 'All farms' }, SETTLE);
const headerIndex = (t: HTMLElement, label: string) =>
  within(t).getAllByRole('columnheader').findIndex((h) => (h.textContent ?? '').includes(label));
function cell(t: HTMLElement, rowName: string, headerLabel: string): string {
  const idx = headerIndex(t, headerLabel);
  expect(idx, `${headerLabel} header`).toBeGreaterThanOrEqual(0);
  return [...within(t).getByText(rowName).closest('tr')!.querySelectorAll('td')][idx].textContent!.trim();
}
const tierGroup = () => screen.getByRole('group', { name: /tier/i });

describe('All_farms_shows_tier_and_checked_days_and_no_entry (F4, F5)', () => {
  it('All_farms_shows_tier_and_checked_days_and_no_entry', async () => {
    serve([
      farm(1, 'Bhosale Mala', { wvfd7d: 2, selfOnlyDays7d: 3, engagementTier: 'C' }),
      farm(2, 'Pawar Shet', { wvfd7d: 6, selfOnlyDays7d: 0, engagementTier: 'A' }),
      // Days confirmed only by the person who saved them: a real 0 checked days, tier D.
      farm(3, 'Kale Baug', { wvfd7d: 0, selfOnlyDays7d: 4, engagementTier: 'D' }),
      // Saved no counted entry last week: no number and no tier, never tier D and never 0.
      farm(4, 'Jadhav Wadi', { wvfd7d: null, selfOnlyDays7d: null, engagementTier: null }),
    ]);
    renderFarms();
    const t = await table();
    await screen.findByText('Jadhav Wadi', undefined, SETTLE);

    // F4 and F5 are real: headed in the plan's words and not marked "Not built yet".
    expect(headerIndex(t, 'Tier')).toBeGreaterThanOrEqual(0);
    expect(headerIndex(t, 'Checked days last week')).toBeGreaterThanOrEqual(0);
    expect(within(t).queryAllByRole('columnheader').some((h) => /Not built yet/.test(h.textContent ?? ''))).toBe(false);
    expect(document.body.textContent).not.toContain('Not built yet');

    // Self-confirmed days sit apart in the same cell and are never added in.
    expect(cell(t, 'Bhosale Mala', 'Checked days last week')).toBe('2 checked, 3 self-confirmed');
    expect(cell(t, 'Bhosale Mala', 'Checked days last week')).not.toMatch(/\b5\b/);
    expect(cell(t, 'Bhosale Mala', 'Tier')).toBe('C');
    expect(cell(t, 'Pawar Shet', 'Checked days last week')).toBe('6 checked, 0 self-confirmed');
    expect(cell(t, 'Pawar Shet', 'Tier')).toBe('A');
    expect(cell(t, 'Kale Baug', 'Checked days last week')).toBe('0 checked, 4 self-confirmed');
    expect(cell(t, 'Kale Baug', 'Tier')).toBe('D');

    // No counted entry last week: says so, in both cells.
    expect(cell(t, 'Jadhav Wadi', 'Checked days last week')).toBe('No entry last week');
    expect(cell(t, 'Jadhav Wadi', 'Tier')).toBe('No entry last week');

    // The two lines of each, verbatim from the plan, sit under the table.
    const f4 = document.querySelector('[data-metric="farms-tier"]')!;
    expect(f4.textContent).toContain("Each farm's A to D group by checked days last week.");
    const f5 = document.querySelector('[data-metric="farms-wvfd7d"]')!;
    expect(f5.textContent).toContain("Each farm's days last week with an entry checked by a person.");
  });
});

describe('A_farm_row_not_measured_says_so (C33 1)', () => {
  it('A_farm_row_not_measured_says_so', async () => {
    serve([
      farm(1, 'Bhosale Mala', { wvfd7d: 3, selfOnlyDays7d: 1, engagementTier: 'B' }),
      farm(2, 'Pawar Shet', {
        wvfd7d: null, selfOnlyDays7d: null, engagementTier: null, confirmedDaysNotMeasuredReason: 'farm_unreadable',
      }),
      farm(3, 'Jadhav Wadi', { wvfd7d: null, selfOnlyDays7d: null, engagementTier: null }),
    ]);
    renderFarms();
    const t = await table();
    await screen.findByText('Pawar Shet', undefined, SETTLE);

    // The unreadable farm's row says "not measured" in both cells; it never says "No entry last week", and it has no tier.
    for (const col of ['Checked days last week', 'Tier']) {
      const words = cell(t, 'Pawar Shet', col);
      expect(words, col).toMatch(/not measured/i);
      expect(words, col).not.toMatch(/No entry last week/i);
      expect(words, col).not.toMatch(/\b[A-D]\b|\b0\b/);
    }
    // The other rows are unaffected: a counted farm keeps its numbers, a farm with no entry still says so.
    expect(cell(t, 'Bhosale Mala', 'Checked days last week')).toBe('3 checked, 1 self-confirmed');
    expect(cell(t, 'Bhosale Mala', 'Tier')).toBe('B');
    expect(cell(t, 'Jadhav Wadi', 'Checked days last week')).toBe('No entry last week');
    // One unreadable farm does not turn the page into a failure.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });
});

describe('The_tier_filter_is_live (F4)', () => {
  it('The_tier_filter_is_live', async () => {
    const all = [
      farm(1, 'Bhosale Mala', { wvfd7d: 6, engagementTier: 'A' }),
      farm(2, 'Pawar Shet', { wvfd7d: 3, engagementTier: 'B' }),
      farm(3, 'Jadhav Wadi', { wvfd7d: 1, engagementTier: 'C' }),
    ];
    serveByTier(all);
    renderFarms();
    await table();
    await screen.findByText('Pawar Shet', undefined, SETTLE);

    // The four buttons work: none is disabled, none is marked "Not built yet".
    const group = tierGroup();
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => (b.textContent ?? '').trim())).toEqual(['Tier A', 'Tier B', 'Tier C', 'Tier D']);
    for (const b of buttons) expect(b).not.toBeDisabled();
    expect(group.textContent).not.toContain('Not built yet');
    expect(queryOf(farmsCalls()[0]).get('tier')).toBeNull();

    // Choosing Tier B is SENT to the server, and the rows are the server's.
    fireEvent.click(within(group).getByRole('button', { name: 'Tier B' }));
    await waitFor(() => expect(queryOf(lastFarmsCall()).get('tier')).toBe('B'), SETTLE);
    expect(queryOf(lastFarmsCall()).get('page')).toBe('1');
    await waitFor(() => expect(screen.queryByText('Bhosale Mala')).toBeNull(), SETTLE);
    expect(screen.getByText('Pawar Shet')).toBeTruthy();
    expect(within(tierGroup()).getByRole('button', { name: 'Tier B' })).toHaveAttribute('aria-pressed', 'true');

    // Pressing it again clears the filter and asks for every farm.
    fireEvent.click(within(tierGroup()).getByRole('button', { name: 'Tier B' }));
    await waitFor(() => expect(queryOf(lastFarmsCall()).get('tier')).toBeNull(), SETTLE);
    await screen.findByText('Bhosale Mala', undefined, SETTLE);
  });

  it('a tier chosen on page 2 asks for page 1', async () => {
    serveByTier([farm(1, 'Bhosale Mala', { engagementTier: 'A' })]);
    renderFarms(`/farms?org=${ORG}&page=2`);
    await waitFor(() => expect(farmsCalls().length).toBeGreaterThan(0), SETTLE);
    expect(queryOf(farmsCalls()[0]).get('page')).toBe('2');
    fireEvent.click(within(tierGroup()).getByRole('button', { name: 'Tier A' }));
    await waitFor(() => expect(queryOf(lastFarmsCall()).get('tier')).toBe('A'), SETTLE);
    expect(queryOf(lastFarmsCall()).get('page')).toBe('1');
  });

  it('a tier in the address that is not A, B, C or D is never sent to the server', async () => {
    serveByTier([farm(1, 'Bhosale Mala', { engagementTier: 'A' })]);
    renderFarms(`/farms?org=${ORG}&tier=Z`);
    await screen.findByText('Bhosale Mala', undefined, SETTLE);
    for (const r of farmsCalls()) expect(queryOf(r).get('tier'), r.url).toBeNull();
  });
});

describe('the three refusals of the tier filter (C33 1, 8; C32)', () => {
  const refuse = (status: number, code: string) => {
    stub = installAdapter(async () => ({ status, data: { code, message: 'refused' } }));
  };
  const noRowsAndNoFalseEmpty = () => {
    expect(screen.queryByRole('table', { name: 'All farms' })).toBeNull();
    expect(screen.queryByText(/No farms found|No farms returned/i)).toBeNull();
    expect(screen.queryByText(/Nothing matches/i)).toBeNull();
  };

  it('409 tier_filter_not_measured says the filter could not count every farm, in a plain note, and lists no farm', async () => {
    refuse(409, 'tier_filter_not_measured');
    renderFarms(`/farms?org=${ORG}&tier=B`);
    const note = await screen.findByText(/tier filter/i, undefined, SETTLE);
    expect(note.closest('[role="status"]'), 'the note is a status, not an alert').toBeTruthy();
    expect(note.textContent).toMatch(/tier filter/i);
    expect(note.textContent).toMatch(/could not count|not measured/i);
    // It is not the too-many note: the two refusals read differently.
    expect(note.textContent).not.toMatch(/too many|that many/i);
    noRowsAndNoFalseEmpty();
    // It is an answer, not a failure: no error alert and no Retry button.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    // The filter stays on screen, so it can be cleared.
    expect(within(tierGroup()).getByRole('button', { name: 'Tier B' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('409 tier_filter_too_many_farms says there are too many farms to count live, and not the other note', async () => {
    refuse(409, 'tier_filter_too_many_farms');
    renderFarms(`/farms?org=${ORG}&tier=B`);
    const note = await screen.findByText(/tier filter/i, undefined, SETTLE);
    expect(note.closest('[role="status"]'), 'the note is a status, not an alert').toBeTruthy();
    expect(note.textContent).toMatch(/tier filter/i);
    expect(note.textContent).toMatch(/too many|that many/i);
    noRowsAndNoFalseEmpty();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(note.textContent).not.toMatch(/could not count every farm/i);
  });

  it('400 tier_invalid is a failed load with Retry, never "No farms found" and never an empty list', async () => {
    refuse(400, 'tier_invalid');
    renderFarms(`/farms?org=${ORG}&tier=B`);
    const alert = await screen.findByRole('alert', undefined, SETTLE);
    expect(alert.textContent).toBeTruthy();
    noRowsAndNoFalseEmpty();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('a 409 is asked once even when the app default would retry', async () => {
    refuse(409, 'tier_filter_not_measured');
    // The app's own default (App.tsx): retry once, wait 1 s. The hook must override it.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1, gcTime: 0 } },
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    renderFarms(`/farms?org=${ORG}&tier=B`, client);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByText(/tier filter/i)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(farmsCalls(), 'a refused tier filter was asked again: the page retries').toHaveLength(1);
  });
});
