import { renderHook, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import { useNavBadges } from '@/app/navBadges';
import HomePage from '../HomePage';

/**
 * CR-2e Task 4 (page part, C26): Home's call list (H9) is real. It merges the silent farms in bands 7-13 and 14-29
 * with the Suffering 7-day list, by farm id, each row saying why it is listed. "No farm to call today" appears only
 * when BOTH answers are real and empty; a failed or not-measured answer is shown as such, never as "nobody".
 * H8 (monthly revenue) is still "Not built yet". Expected text comes from the spec and the reviewed lines file.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'w', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 0 };
const SILENT = '/admin/farms/silent-churn';
const SUFFERING = '/admin/farms/suffering';
const NONE_TODAY = /No farm to call today/i;

interface Entry { page: string; key: string; label: string; status: string; buildId: string; what?: string; why?: string }
const ENTRIES = JSON.parse(raw) as Entry[];
const byId = (id: string) => ENTRIES.find((e) => e.buildId === id)!;

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

type Farm = {
  farmId: string; name: string; ownerPhone: string | null; band: '7-13' | '14-29' | '30+' | 'never';
  daysSilent: number | null; lastEntryUtc: string | null; planCode: string | null; planStatus: number | null;
};
const silentFarm = (n: number, band: Farm['band'], daysSilent: number | null, over: Partial<Farm> = {}): Farm => ({
  farmId: F(n), name: `Silent ${n}`, ownerPhone: '9000000001', band, daysSilent,
  lastEntryUtc: daysSilent === null ? null : '2026-08-20T06:00:00Z', planCode: null, planStatus: null, ...over,
});
const silentAnswer = (farms: Farm[], notMeasuredReason: string | null = null) => ({
  data: { countedAtUtc: '2026-09-01T08:30:00Z', farms, notMeasuredReason },
  meta: META,
});
const sufferingRow = (n: number) => ({
  farmId: F(n), problemCount: 5, syncProblems: 2, entryProblems: 1, voiceProblems: 1, otherProblems: 1,
  lastProblemAt: '2026-08-31T09:15:00Z',
});

/** A platform admin who may read both lists (Home fails closed unless the scope says so). */
const SCOPE = {
  outcome: 'Resolved',
  scope: {
    userId: 'u1', orgId: ORG, orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true,
    modules: ['farms.silent-churn', 'farms.suffering'].map((key) => ({ key, canRead: true, canExport: false, canWrite: false })),
  },
  memberships: [],
};

type Served = unknown | { status: number; data: unknown };
function serve(silent: Served, suffering: Served, names: Record<string, string> = {}) {
  stub = installContactsStub((r) => {
    if (r.path.endsWith('/me/scope')) return SCOPE;
    if (r.path.endsWith(SILENT)) return silent;
    if (r.path.endsWith(SUFFERING)) return suffering;
    return { data: null, meta: META };
  }, names);
}
const render = () => renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
const list = () => document.querySelector<HTMLElement>('[data-metric="home-call-list"]')!;
const items = () => [...list().querySelectorAll<HTMLElement>('li')];

describe('Home call list is real (H9)', () => {
  it('Home_call_list_merges_silent_and_repeated_problem_farms', async () => {
    serve(
      silentAnswer([
        silentFarm(1, '7-13', 9),
        silentFarm(2, '14-29', 20),
        silentFarm(3, '30+', 45),
        silentFarm(4, 'never', null),
      ]),
      { data: [sufferingRow(2), sufferingRow(5)], meta: META },
      { [F(5)]: 'Pawar Shet' },
    );
    render();
    await waitFor(() => expect(list().textContent).toContain('Silent 1'), SETTLE);
    await waitFor(() => expect(list().textContent).toContain('Pawar Shet'), SETTLE);

    // Three farms: two silent in the two call bands (one also hitting problems) and one with problems only.
    // The farm silent 30+ days and the farm that never saved an entry are NOT on the call list.
    expect(items()).toHaveLength(3);
    expect(list().textContent).not.toContain('Silent 3');
    expect(list().textContent).not.toContain('Silent 4');

    const rowOf = (name: string) => items().find((li) => (li.textContent ?? '').includes(name))!;
    // Each row says why it is listed.
    expect(rowOf('Silent 1').textContent).toMatch(/9 days/);
    expect(rowOf('Silent 1').textContent).not.toMatch(/problem/i);
    // A farm on both lists is ONE row with both reasons (merged by farm id).
    const both = items().filter((li) => li.getAttribute('data-farm-id') === F(2) || (li.textContent ?? '').includes('Silent 2'));
    expect(both).toHaveLength(1);
    expect(both[0].textContent).toMatch(/20 days/);
    expect(both[0].textContent).toMatch(/problem/i);
    // A farm with problems only: named from the contacts route, with its reason and no invented silence.
    expect(rowOf('Pawar Shet').textContent).toMatch(/problem/i);
    expect(rowOf('Pawar Shet').textContent).not.toMatch(/quiet|silent/i);

    // Phones are shown for silent farms.
    expect(rowOf('Silent 1').textContent).toContain('9000000001');

    // The farm already named by the silent answer is not asked of the contacts route again; the other is.
    const asked = stub!.contactCalls().flatMap((c) => stub!.idsOf(c));
    expect(asked).toContain(F(5));
    expect(asked).not.toContain(F(1));
    expect(asked).not.toContain(F(2));
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('a silent farm with no phone says "Phone not recorded"', async () => {
    serve(silentAnswer([silentFarm(1, '7-13', 9, { ownerPhone: null })]), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toContain('Silent 1'), SETTLE);
    expect(items()[0].textContent).toContain('Phone not recorded');
  });

  it('says "no farm to call today" only when both answers are real and empty', async () => {
    serve(silentAnswer([]), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(NONE_TODAY), SETTLE);
    expect(items()).toHaveLength(0);
  });

  it('farms silent only 30+ days or never, with no problems, make an empty call list (real and empty)', async () => {
    serve(silentAnswer([silentFarm(3, '30+', 45), silentFarm(4, 'never', null)]), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(NONE_TODAY), SETTLE);
  });

  it('a not-measured silent answer is shown with its reason and never as "no farm to call today"', async () => {
    serve(silentAnswer([], 'too_many_farms_for_live_count'), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(/too many farms/i), SETTLE);
    expect(list().textContent).toMatch(/not counted|not measured/i);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
    expect(items()).toHaveLength(0);
  });

  it('an unreadable farm list is shown with its reason and never as "no farm to call today"', async () => {
    serve(silentAnswer([], 'farm_list_unreadable'), { data: [sufferingRow(5)], meta: META }, { [F(5)]: 'Pawar Shet' });
    render();
    await waitFor(() => expect(list().textContent).toMatch(/farms could not be read/i), SETTLE);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('a failed silent answer is shown as a failure and never as "no farm to call today"', async () => {
    serve({ status: 500, data: {} }, { data: [], meta: META });
    render();
    await waitFor(() => expect(within(list()).getByRole('alert').textContent).toMatch(/could not load/i), SETTLE);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
    expect(items()).toHaveLength(0);
  });

  it('a failed Suffering answer is shown as a failure even when the silent answer is empty', async () => {
    serve(silentAnswer([]), { status: 500, data: {} });
    render();
    await waitFor(() => expect(within(list()).getByRole('alert').textContent).toMatch(/could not load/i), SETTLE);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('H8 stays "Not built yet" with its two lines and no number, and H9 is real', () => {
    serve(silentAnswer([]), { data: [], meta: META });
    render();
    const h8 = byId('H8');
    expect(h8.status).toBe('idea');
    expect(byId('H9').status).toBe('real');
    const hits = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const t = el.textContent ?? '';
      return t.includes(h8.label) && t.includes('Not built yet') && t.includes(h8.what!) && t.includes(h8.why!);
    });
    expect(hits.length).toBeGreaterThan(0);
    const smallest = hits.reduce((a, b) => ((a.textContent ?? '').length <= (b.textContent ?? '').length ? a : b));
    const rest = (smallest.textContent ?? '').replace(h8.label, '').replace(h8.what!, '').replace(h8.why!, '').replace('Not built yet', '');
    expect(rest).not.toMatch(/\d/);
    // The call list carries H9's two reviewed lines, not "Not built yet".
    expect(list().textContent).toContain(byId('H9').what!);
    expect(list().textContent).toContain(byId('H9').why!);
    expect(list().textContent).not.toContain('Not built yet');
  });

  it('the nav badges stay empty and ask for nothing, even with silent farms served (C8)', async () => {
    serve(silentAnswer([silentFarm(1, '7-13', 9)]), { data: [], meta: META });
    const { result } = renderHook(() => useNavBadges());
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current).toEqual({});
    expect(stub!.requests).toHaveLength(0);
  });
});
