import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import SilentChurnPage from '../SilentChurnPage';

/**
 * CR-2e Task 4 (page part, C26/C27): Silent Churn lists the farms the server counted live, grouped by band
 * (7-13, 14-29, 30+, never) and by plan, with counts, names, phones, days silent, last entry and the plan in
 * words. A not-measured answer shows its reason, never "nobody". The hook does not poll (each load writes audit rows).
 * Expected text comes from the spec and the reviewed lines file, not from the code under test.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'counted when opened', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 0 };
const SILENT_PATH = '/admin/farms/silent-churn';

interface Line { key: string; what: string; why: string; status: string }
const LINES = JSON.parse(raw) as Line[];
const line = (key: string) => LINES.find((l) => l.key === key)!;

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
  localStorage.clear();
});

type Farm = {
  farmId: string; name: string; ownerPhone: string | null; band: '7-13' | '14-29' | '30+' | 'never';
  daysSilent: number | null; lastEntryUtc: string | null; planCode: string | null; planStatus: number | null;
};
function farm(n: number, over: Partial<Farm>): Farm {
  return {
    farmId: F(n), name: `Farm ${n}`, ownerPhone: '9000000001', band: '7-13', daysSilent: 9,
    lastEntryUtc: '2026-08-23T06:00:00Z', planCode: null, planStatus: null, ...over,
  };
}
const answer = (farms: Farm[], notMeasuredReason: string | null = null) => ({
  data: { countedAtUtc: '2026-09-01T08:30:00Z', farms, notMeasuredReason },
  meta: META,
});

function serve(body: unknown) {
  stub = installContactsStub((r) => (r.path.endsWith(SILENT_PATH) ? body : { data: null, meta: META }));
}
const silentCalls = () => stub!.requests.filter((r) => r.path.endsWith(SILENT_PATH));
const render = () => renderWithProviders(<SilentChurnPage />, { route: `/farms/silent-churn?org=${ORG}` });
const band = (b: string) => document.querySelector<HTMLElement>(`[data-band="${b}"]`)!;

const MIXED = [
  farm(1, { name: 'Bhosale Mala', band: '7-13', daysSilent: 9, planCode: 'pro', planStatus: 1 }),
  farm(2, { name: 'Pawar Shet', band: '7-13', daysSilent: 11, planCode: 'pro', planStatus: 1 }),
  farm(3, { name: 'Jadhav Baug', band: '14-29', daysSilent: 20, planCode: 'pro', planStatus: 2 }),
  farm(4, { name: 'Kale Wadi', band: '30+', daysSilent: 45, planCode: null, planStatus: null }),
  farm(5, { name: 'Gaikwad Mala', band: 'never', daysSilent: null, lastEntryUtc: null, planCode: null, planStatus: null }),
];

describe('Silent Churn is real (S1, S2, S3)', () => {
  it('Silent_farms_are_grouped_by_band_and_plan', async () => {
    serve(answer(MIXED));
    render();
    await screen.findByText('Bhosale Mala', undefined, SETTLE);

    // Each farm sits under its own band, with its days silent.
    const b713 = band('7-13');
    expect(within(b713).getByText('Bhosale Mala')).toBeTruthy();
    expect(within(b713).getByText('Pawar Shet')).toBeTruthy();
    expect(within(b713).queryByText('Jadhav Baug')).toBeNull();
    expect(within(band('14-29')).getByText('Jadhav Baug')).toBeTruthy();
    expect(within(band('30+')).getByText('Kale Wadi')).toBeTruthy();
    expect(within(band('never')).getByText('Gaikwad Mala')).toBeTruthy();

    const rowOf = (name: string) => screen.getByText(name).closest('tr')!;
    expect(rowOf('Bhosale Mala').textContent).toContain('9 days');
    expect(rowOf('Pawar Shet').textContent).toContain('11 days');
    expect(rowOf('Jadhav Baug').textContent).toContain('20 days');
    expect(rowOf('Kale Wadi').textContent).toContain('45 days');
    expect(rowOf('Gaikwad Mala').textContent).not.toMatch(/\b\d+ days?\b/);

    // Counts per band: the two 7-13 farms are two.
    expect(band('7-13').textContent).toMatch(/\(2 farms\)/);
    expect(band('14-29').textContent).toMatch(/\(1 farm\)/);
    expect(band('30+').textContent).toMatch(/\(1 farm\)/);
    expect(band('never').textContent).toMatch(/\(1 farm\)/);
    expect(document.querySelector('[data-band-count="7-13"]')!.textContent).toMatch(/\b2 farms\b/);

    // Counts per plan: two on a trial, one active, two with no plan recorded.
    const planCount = (re: RegExp) =>
      [...document.querySelectorAll<HTMLElement>('[data-plan-count]')].find((e) => re.test(e.textContent ?? ''));
    expect(planCount(/Trial/)!.textContent).toMatch(/\b2 farms\b/);
    expect(planCount(/Paid, active/)!.textContent).toMatch(/\b1 farm\b/);
    expect(planCount(/no plan recorded/i)!.textContent).toMatch(/\b2 farms\b/);

    // The plan in words, on the row.
    expect(rowOf('Bhosale Mala').textContent).toContain('Trial');
    expect(rowOf('Jadhav Baug').textContent).toContain('Paid, active');

    // The phone is shown, and the three reviewed lines are on the page as real (no "Not built yet").
    expect(rowOf('Bhosale Mala').textContent).toContain('9000000001');
    for (const key of ['silent-watchlist', 'silent-plan', 'silent-groups']) {
      expect(line(key).status, key).toBe('real');
      const el = document.querySelector<HTMLElement>(`[data-metric="${key}"]`)!;
      expect(el, key).not.toBeNull();
      expect(el.textContent).toContain(line(key).what);
      expect(el.textContent).toContain(line(key).why);
    }
    expect(document.body.textContent).not.toContain('Not built yet');
  });

  it('both plan fields null says "No plan recorded", never trial', async () => {
    serve(answer([farm(4, { name: 'Kale Wadi', band: '30+', daysSilent: 45, planCode: null, planStatus: null })]));
    render();
    const row = (await screen.findByText('Kale Wadi', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).toContain('No plan recorded');
    expect(row.textContent).not.toContain('Trial');
  });

  it('an owner phone of null says "Phone not recorded", never a blank', async () => {
    serve(answer([farm(1, { name: 'Bhosale Mala', ownerPhone: null })]));
    render();
    const row = (await screen.findByText('Bhosale Mala', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).toContain('Phone not recorded');
  });

  it('a farm that never saved an entry shows no invented date or days', async () => {
    serve(answer([farm(5, { name: 'Gaikwad Mala', band: 'never', daysSilent: null, lastEntryUtc: null })]));
    render();
    const row = (await screen.findByText('Gaikwad Mala', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).not.toMatch(/\b\d+ days?\b/);
    expect(row.textContent).not.toMatch(/Invalid|NaN|undefined|null/);
    expect(row.textContent).toMatch(/never|no entry/i);
  });

  it('a measured empty answer says no farm is silent, with a time', async () => {
    serve(answer([]));
    render();
    await screen.findByText(/No farm has been silent/i, undefined, SETTLE);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('Not_measured_shows_the_reason_not_nobody', async () => {
    for (const [reason, words] of [
      ['farm_list_unreadable', /farms could not be read/i],
      ['too_many_farms_for_live_count', /too many farms/i],
    ] as const) {
      serve(answer([], reason));
      const { unmount } = render();
      await waitFor(() => expect(document.body.textContent).toMatch(words), SETTLE);
      expect(document.body.textContent, reason).toMatch(/not counted|not measured/i);
      // Never the empty-list wording, never a "none" or a table.
      expect(document.body.textContent, reason).not.toMatch(/No farm has been silent|nobody|no silent farms|0 farms/i);
      expect(screen.queryAllByRole('table'), reason).toHaveLength(0);
      unmount();
      stub!.restore();
      stub = null;
    }
  });

  it('a failed request says it could not load and never says none', async () => {
    serve({ status: 500, data: {} });
    render();
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/could not load/i);
    }, SETTLE);
    expect(document.body.textContent).not.toMatch(/No farm has been silent|nobody/i);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('The_silent_list_does_not_poll', async () => {
    serve(answer(MIXED));
    // Fake timers and the spies are in place BEFORE mount, so a timer made while mounting is seen too.
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      render();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByText('Bhosale Mala')).toBeTruthy();
      expect(silentCalls()).toHaveLength(1);

      // Well past any refetch interval, twice over.
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      expect(silentCalls(), 'time passing made another silent-farms request: the page polls').toHaveLength(1);
      expect(intervalSpy, 'the page set an interval').not.toHaveBeenCalled();
    } finally {
      intervalSpy.mockRestore();
    }
  });
});
