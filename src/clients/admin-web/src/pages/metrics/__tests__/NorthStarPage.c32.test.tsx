import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import NorthStarPage from '../NorthStarPage';

/**
 * CR-2e Task 6, amendment C32 (page part): the North Star page counts checked farm-days when it is opened.
 * Expected text is the plan's (C32 "Page" and "Lines"), not read from the page.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'counted when opened', lastRefreshedUtc: '2026-11-19T04:00:00.000Z', ttlSeconds: 0 };
const WVFD_PATH = '/admin/metrics/wvfd';
const F = (n: number) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

const CAN_STILL_RISE = "Last week's number can still rise until Tuesday night, while its last entries can still be confirmed.";
const TIER_RULE = 'A: 5 or more checked days, B: 3-4, C: 1-2, D: none';
const SELF_ONLY_WORDS = 'Days confirmed only by the person who saved them';

const NAMES: Record<string, string> = {
  [F(1)]: 'Bhosale Mala',
  [F(2)]: 'Pawar Shet',
  [F(3)]: 'Jadhav Wadi',
  [F(4)]: 'Kale Baug',
  [F(5)]: 'Shinde Rai',
};

interface Week { weekStart: string; avgWvfd: number | null; avgSelfOnlyDays: number | null; activeFarms: number; isPartial: boolean }
interface FarmRow { farmId: string; checkedDays: number; selfOnlyDays: number; engagementTier: string }

const WEEKS: Week[] = [
  { weekStart: '2026-10-19', avgWvfd: 2, avgSelfOnlyDays: 1, activeFarms: 4, isPartial: false },
  { weekStart: '2026-10-26', avgWvfd: null, avgSelfOnlyDays: null, activeFarms: 0, isPartial: false },
  { weekStart: '2026-11-02', avgWvfd: 2.5, avgSelfOnlyDays: 1.5, activeFarms: 6, isPartial: false },
  { weekStart: '2026-11-09', avgWvfd: 3.25, avgSelfOnlyDays: 0.5, activeFarms: 8, isPartial: false },
  { weekStart: '2026-11-16', avgWvfd: 1, avgSelfOnlyDays: 0.25, activeFarms: 3, isPartial: true },
];
const FARMS: FarmRow[] = [
  { farmId: F(1), checkedDays: 5, selfOnlyDays: 1, engagementTier: 'A' },
  { farmId: F(5), checkedDays: 6, selfOnlyDays: 0, engagementTier: 'A' },
  { farmId: F(2), checkedDays: 3, selfOnlyDays: 2, engagementTier: 'B' },
  { farmId: F(3), checkedDays: 1, selfOnlyDays: 0, engagementTier: 'C' },
  { farmId: F(4), checkedDays: 0, selfOnlyDays: 4, engagementTier: 'D' },
];

function answer(over: Record<string, unknown> = {}) {
  return {
    data: {
      currentWvfd: 3.25, currentSelfOnlyDays: 0.5, priorWvfd: 2.5, goalWvfd: null,
      weeks: WEEKS, farms: FARMS, countedAtUtc: '2026-11-19T04:00:00Z', notMeasuredReason: null,
      ...over,
    },
    meta: META,
  };
}

let stub: ContactsStub | null = null;
afterEach(() => {
  vi.useRealTimers();
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(body: unknown) {
  stub = installContactsStub((r) => (r.path.endsWith(WVFD_PATH) ? body : { data: null, meta: META }), NAMES);
}
const wvfdCalls = () => stub!.requests.filter((r) => r.path.endsWith(WVFD_PATH));
const render = (queryClient?: QueryClient) =>
  renderWithProviders(<NorthStarPage />, { route: `/metrics/nsm?org=${ORG}`, ...(queryClient ? { queryClient } : {}) });

/** Waits for the measured page (the sentence under W1 is on it only when numbers were counted). */
const ready = () => screen.findByText(CAN_STILL_RISE, undefined, SETTLE);
const panelOfMetric = (key: string) => document.querySelector(`[data-metric="${key}"]`)!.closest('section')!;
const text = (el: Element) => el.textContent ?? '';

describe('Confirmed_days_show_numbers_and_chart (W1, W2, W3, W4, W6, W7)', () => {
  it('Confirmed_days_show_numbers_and_chart', async () => {
    serve(answer());
    render();
    await ready();
    await screen.findByText('Bhosale Mala', undefined, SETTLE);

    // W1: the last complete week's average, with its two lines under it.
    const w1 = panelOfMetric('wvfd-average');
    expect(text(w1)).toContain('3.25');
    expect(text(w1)).toContain('Average days per farm last week with an entry checked by a person within 48 hours.');

    // W2: the change from the week before (3.25 against 2.5).
    const w2 = panelOfMetric('wvfd-change');
    expect(text(w2)).toMatch(/\+\s?0\.75/);
    expect(text(w2)).toContain('Change in that average from the week before.');

    // W3: farms that saved an entry in that week (8 in the last complete week).
    const w3 = panelOfMetric('wvfd-farms');
    expect(text(w3)).toMatch(/(?<![\d.])8(?![\d.])/);
    expect(text(w3)).toContain('Farms that saved at least one entry in that week.');

    // W4: weeks with at least one active farm: 4 of the 5 weeks (one week had no farm saving an entry).
    const w4 = panelOfMetric('wvfd-weeks');
    expect(text(w4)).toMatch(/(?<![\d.])4(?![\d.])/);
    expect(text(w4)).toContain('Weeks in the chosen time with at least one farm saving an entry.');

    // The chart: one point per week that has a number, for each of the two series; the empty week has no point.
    const chart = screen.getByRole('img', { name: /days.*by week/i });
    expect(chart.querySelectorAll('circle')).toHaveLength(8);
    expect(chart.querySelectorAll('polyline').length).toBeGreaterThan(0);
    // The current week is labelled "so far" on the chart and in the weeks table.
    expect(text(chart)).toMatch(/so far/i);
    const rows = document.querySelectorAll('tr[data-week]');
    expect(rows).toHaveLength(5);
    expect(text(document.querySelector('tr[data-week="2026-11-16"]')!)).toMatch(/so far/i);
    expect(text(document.querySelector('tr[data-week="2026-11-09"]')!)).not.toMatch(/so far/i);
  });

  it('shows the tier counts with their rule, and every farm with name, checked days, self-confirmed days and tier (W6, W7)', async () => {
    serve(answer());
    render();
    await ready();
    await screen.findByText('Bhosale Mala', undefined, SETTLE);

    expect(document.body.textContent).toContain(TIER_RULE);
    const w6 = panelOfMetric('wvfd-tiers');
    expect(text(w6)).toContain('Farms grouped A to D by how many checked days they had last week.');
    const tierLi = (t: string) => [...w6.querySelectorAll('li')].find((li) => /^\s*Tier /.test(text(li)) && text(li).includes(`Tier ${t}`))!;
    expect(text(tierLi('A'))).toMatch(/\b2\b/);
    expect(text(tierLi('B'))).toMatch(/\b1\b/);
    expect(text(tierLi('C'))).toMatch(/\b1\b/);
    expect(text(tierLi('D'))).toMatch(/\b1\b/);

    const w7 = panelOfMetric('wvfd-farm-list');
    expect(text(w7)).toContain("Each farm's checked days last week, with self-confirmed days shown apart.");
    const table = within(w7).getByRole('table');
    const cells = (name: string) => [...within(table).getByText(name).closest('tr')!.querySelectorAll('td')].map((c) => text(c).trim());
    expect(cells('Bhosale Mala')).toEqual(['Bhosale Mala', '5', '1', 'A']);
    expect(cells('Pawar Shet')).toEqual(['Pawar Shet', '3', '2', 'B']);
    expect(cells('Jadhav Wadi')).toEqual(['Jadhav Wadi', '1', '0', 'C']);
    // A farm with no checked day is a real 0 and tier D, not a blank.
    expect(cells('Kale Baug')).toEqual(['Kale Baug', '0', '4', 'D']);
    expect(within(table).getAllByRole('row')).toHaveLength(1 + FARMS.length);
  });

  it('asks for the names of the farms in ONE contacts call, and counts days in ONE wvfd call', async () => {
    serve(answer());
    render();
    await ready();
    await screen.findByText('Bhosale Mala', undefined, SETTLE);
    expect(wvfdCalls()).toHaveLength(1);
    expect(wvfdCalls()[0].url).toContain('weeks=12');
    expect(stub!.contactCalls()).toHaveLength(1);
    expect(stub!.idsOf(stub!.contactCalls()[0])).toEqual(FARMS.map((f) => f.farmId).sort());
  });

  it('a week with no farm saving an entry has no number, never a 0', async () => {
    serve(answer({
      currentWvfd: null, currentSelfOnlyDays: null, priorWvfd: null, farms: [],
      weeks: WEEKS.map((w) => ({ ...w, avgWvfd: null, avgSelfOnlyDays: null, activeFarms: 0 })),
    }));
    render();
    await screen.findAllByText(/No farm saved an entry/i, undefined, SETTLE);
    const w1 = panelOfMetric('wvfd-average');
    expect(text(w1)).not.toMatch(/(^|[^\d.])0(\.0+)?(?![\d.])/);
    expect(text(panelOfMetric('wvfd-change'))).not.toMatch(/\+|-\s?\d|\b0 days\b|No change/);
    const chart = screen.getByRole('img', { name: /days.*by week/i });
    expect(chart.querySelectorAll('circle')).toHaveLength(0);
  });
});

describe('Last_week_says_it_can_still_rise_until_tuesday', () => {
  it('Last_week_says_it_can_still_rise_until_tuesday', async () => {
    serve(answer());
    render();
    await ready();
    // The sentence sits with W1 (the headline), in the plan's words.
    expect(text(panelOfMetric('wvfd-average'))).toContain(CAN_STILL_RISE);
  });

  // C32 Page, W1, settled by C34: the panel heading is "Days checked by a person, per farm, last week"; the metric
  // line's label stays "Checked farm-days per farm".
  it('W1 is titled in the plan words', async () => {
    serve(answer());
    render();
    await ready();
    expect(text(panelOfMetric('wvfd-average'))).toContain('Days checked by a person, per farm, last week');
  });
});

describe('Self_confirmed_days_are_shown_apart_never_added', () => {
  it('Self_confirmed_days_are_shown_apart_never_added', async () => {
    serve(answer());
    render();
    await ready();
    await screen.findByText('Bhosale Mala', undefined, SETTLE);

    const w1 = panelOfMetric('wvfd-average');
    // Beside W1, in the plan's words, with its own number.
    expect(text(w1)).toContain(SELF_ONLY_WORDS);
    expect(text(w1)).toContain('0.5');
    // Never summed: 3.25 checked + 0.5 self-confirmed would be 3.75, and no total appears anywhere.
    expect(document.body.textContent).not.toContain('3.75');
    // The headline stays the checked number alone.
    expect(text(w1)).toContain('3.25');

    // The farm list keeps the two in separate cells and no cell holds their sum (Pawar Shet: 3 + 2 = 5).
    const pawar = [...within(panelOfMetric('wvfd-farm-list')).getByText('Pawar Shet').closest('tr')!.querySelectorAll('td')].map((c) => text(c).trim());
    expect(pawar).not.toContain('5');
    // The weeks table keeps two columns apart, and the chart draws two series (one point each for the four weeks).
    const week = [...document.querySelector('tr[data-week="2026-11-09"]')!.querySelectorAll('td')].map((c) => text(c).trim());
    expect(week.join('|')).toContain('3.25');
    expect(week.join('|')).toContain('0.5');
    expect(week).not.toContain('3.75');
    const chart = screen.getByRole('img', { name: /days.*by week/i });
    expect(chart.querySelectorAll('circle')).toHaveLength(8);
  });
});

describe('Goal_says_not_set_yet', () => {
  it('Goal_says_not_set_yet', async () => {
    serve(answer());
    render();
    await ready();
    const goal = panelOfMetric('wvfd-goal');
    expect(text(goal)).toContain('Goal not set yet');
    expect(text(goal)).not.toContain('Not built yet');
    expect(text(goal)).toContain('The weekly confirmed farm-days per farm the company aims for.');
    // No share of a goal, and the old made-up 4.5 is gone.
    expect(document.body.textContent).not.toMatch(/4\.5/);
    expect(document.body.textContent).not.toMatch(/of goal|% of|percent/i);
  });

  it('says it also when the days could not be counted', async () => {
    serve(answer({
      currentWvfd: null, currentSelfOnlyDays: null, priorWvfd: null, weeks: [], farms: [],
      notMeasuredReason: 'too_many_farms_for_live_count',
    }));
    render();
    await screen.findByText(/too many farms/i, undefined, SETTLE);
    expect(text(panelOfMetric('wvfd-goal'))).toContain('Goal not set yet');
  });
});

describe('Not_measured_shows_the_reason', () => {
  const NOT_MEASURED = { currentWvfd: null, currentSelfOnlyDays: null, priorWvfd: null, weeks: [], farms: [] };

  it('Not_measured_shows_the_reason', async () => {
    serve(answer({ ...NOT_MEASURED, notMeasuredReason: 'too_many_farms_for_live_count' }));
    render();
    await screen.findByText(/too many farms/i, undefined, SETTLE);
    expect(document.body.textContent).not.toContain('too_many_farms_for_live_count');
    // Words, not "none" and not 0: no number, chart, tier counts or list.
    expect(document.body.textContent).not.toContain(CAN_STILL_RISE);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('img', { name: /days.*by week/i })).toBeNull();
    expect(document.body.textContent).not.toContain(TIER_RULE);
    expect(document.body.textContent).not.toMatch(/(^|[^\d.])0(\.0+)?(?![\d.])/);
    expect(document.body.textContent).not.toMatch(/\bnone\b|\bnobody\b|No farm saved/i);
  });

  it('says the farm list could not be read, in words', async () => {
    serve(answer({ ...NOT_MEASURED, notMeasuredReason: 'farm_list_unreadable' }));
    render();
    await screen.findByText(/could not be read/i, undefined, SETTLE);
    expect(document.body.textContent).not.toContain('farm_list_unreadable');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/(^|[^\d.])0(\.0+)?(?![\d.])/);
  });

  it('a 403 reads "not available for this account" with no Retry button', async () => {
    serve({ status: 403, data: {} });
    render();
    await waitFor(() => expect(document.body.textContent).toMatch(/not available for this account/i), SETTLE);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('a 500 says it could not load, offers Retry, and shows no number', async () => {
    serve({ status: 500, data: {} });
    render();
    await screen.findByRole('button', { name: /retry/i }, SETTLE);
    expect(screen.getByRole('alert').textContent).toMatch(/could not load/i);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(document.body.textContent).not.toContain(CAN_STILL_RISE);
  });
});

describe('The_wvfd_page_does_not_poll_or_retry', () => {
  it('The_wvfd_page_does_not_poll', async () => {
    serve(answer());
    // A client whose own default WOULD poll every 5 s and refetch on focus: only the hook's own setting stops it.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: 5_000, refetchOnWindowFocus: true } },
    });
    // Fake timers and the spy are in place BEFORE mount, so a timer made while mounting is seen too.
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    render(client);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByText(CAN_STILL_RISE)).toBeTruthy();
    expect(wvfdCalls()).toHaveLength(1);

    // Well past any refetch interval, twice over, then a window focus.
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(wvfdCalls(), 'time passing made another wvfd request: the page polls').toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(wvfdCalls(), 'a window focus made another wvfd request').toHaveLength(1);
  });

  it('The_wvfd_page_does_not_retry', async () => {
    serve({ status: 500, data: {} });
    // The app's own default (App.tsx): retry once, wait 1 s. The hook must override it.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1, gcTime: 0 } },
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    render(client);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(wvfdCalls()).toHaveLength(1);
    // The default retry would wait 1 s and ask again; wait well past that.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('alert').textContent).toMatch(/could not load/i);
    expect(wvfdCalls(), 'a failing read was asked again: the page retries').toHaveLength(1);
  });

  it('a Retry press asks once more (by hand only)', async () => {
    serve({ status: 500, data: {} });
    render();
    const retry = await screen.findByRole('button', { name: /retry/i }, SETTLE);
    expect(wvfdCalls()).toHaveLength(1);
    fireEvent.click(retry);
    await waitFor(() => expect(wvfdCalls()).toHaveLength(2), SETTLE);
  });
});
