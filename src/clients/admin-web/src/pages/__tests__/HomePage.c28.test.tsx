import { waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { adminApi } from '@/lib/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import HomePage from '../HomePage';

/**
 * CR-2e C28 (review round 1 on Task 4), console part. Expected text comes from the C28 amendment, not from the
 * code under test. Items (1) names from the silent answer, (2) phone not fetched vs not recorded, (3) each half on
 * its own, (4) 403, (5) the rule line, (7) no invented zero, (8) no retry on audited reads.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'w', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 0 };
const SILENT = '/admin/farms/silent-churn';
const SUFFERING = '/admin/farms/suffering';
const NONE_TODAY = /No farm to call today/i;

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
const rowOf = (needle: string) => items().find((li) => (li.textContent ?? '').includes(needle))!;
const idleMs = (ms = 400) => new Promise((r) => setTimeout(r, ms));

type ContactsMode = 'hang' | 'fail' | { name: string; ownerPhone: string | null };
/** Replace only the contacts route's answer; every other request goes on to the stub. */
function overrideContacts(mode: ContactsMode) {
  const inner = adminApi.defaults.adapter as AxiosAdapter;
  adminApi.defaults.adapter = (async (config) => {
    const url = config.url ?? '';
    const path = url.split('?')[0];
    if (!path.endsWith('/admin/farms/contacts')) return inner(config);
    const ids = String((config.params as Record<string, string> | undefined)?.ids ?? '');
    stub!.requests.push({ path, url, params: { ids } });
    if (mode === 'hang') return new Promise(() => {});
    if (mode === 'fail') {
      const response = { data: {}, status: 500, statusText: '500', headers: {}, config };
      return Promise.reject({ response, config, isAxiosError: true, message: 'Request failed with status code 500' });
    }
    const data = ids.split(',').filter(Boolean).map((i) => ({ farmId: i, name: mode.name, ownerPhone: mode.ownerPhone }));
    return { data, status: 200, statusText: '200', headers: {}, config };
  }) as AxiosAdapter;
}

describe('C28 (1): a 30+ or never farm that also has repeated problems is named from the silent answer', () => {
  it('both rows carry the name and phone from the silent answer and no contacts request is made for them', async () => {
    serve(
      silentAnswer([
        silentFarm(3, '30+', 45, { ownerPhone: '9000000003' }),
        silentFarm(4, 'never', null, { ownerPhone: '9000000004' }),
      ]),
      { data: [sufferingRow(3), sufferingRow(4)], meta: META },
    );
    render();
    await waitFor(() => expect(items()).toHaveLength(2), SETTLE);
    await idleMs();
    expect(rowOf('Silent 3').textContent).toContain('9000000003');
    expect(rowOf('Silent 4').textContent).toContain('9000000004');
    expect(rowOf('Silent 3').textContent).toMatch(/problem/i);
    expect(rowOf('Silent 4').textContent).toMatch(/problem/i);
    expect(rowOf('Silent 3').textContent).not.toMatch(/Phone not/);
    expect(rowOf('Silent 4').textContent).not.toMatch(/Phone not/);
    expect(stub!.contactCalls()).toHaveLength(0);
  });
});

describe('C28 (2): "Phone not fetched" is not "Phone not recorded"', () => {
  it('a phone still being fetched reads "Phone not fetched"', async () => {
    serve(silentAnswer([]), { data: [sufferingRow(5)], meta: META });
    overrideContacts('hang');
    render();
    await waitFor(() => expect(items()).toHaveLength(1), SETTLE);
    await idleMs();
    expect(items()[0].textContent).toContain('Phone not fetched');
    expect(items()[0].textContent).not.toContain('Phone not recorded');
  });

  it('a phone whose fetch failed reads "Phone not fetched"', async () => {
    serve(silentAnswer([]), { data: [sufferingRow(5)], meta: META });
    overrideContacts('fail');
    render();
    await waitFor(() => expect(stub!.contactCalls().length).toBeGreaterThan(0), SETTLE);
    await idleMs();
    expect(items()).toHaveLength(1);
    expect(items()[0].textContent).toContain('Phone not fetched');
    expect(items()[0].textContent).not.toContain('Phone not recorded');
  });

  it('a real null phone reads "Phone not recorded"', async () => {
    serve(silentAnswer([]), { data: [sufferingRow(5)], meta: META });
    overrideContacts({ name: 'Pawar Shet', ownerPhone: null });
    render();
    await waitFor(() => expect(list().textContent).toContain('Pawar Shet'), SETTLE);
    expect(items()[0].textContent).toContain('Phone not recorded');
    expect(items()[0].textContent).not.toContain('Phone not fetched');
  });
});

describe('C28 (3): each half shows on its own', () => {
  it('silent half not measured: repeated-problem farms still show, under a note saying quiet farms could not be counted and why', async () => {
    serve(silentAnswer([], 'too_many_farms_for_live_count'), { data: [sufferingRow(5)], meta: META }, { [F(5)]: 'Pawar Shet' });
    render();
    await waitFor(() => expect(list().textContent).toContain('Pawar Shet'), SETTLE);
    expect(list().textContent).toMatch(/quiet farms could not be counted/i);
    expect(list().textContent).toMatch(/too many farms/i);
    expect(rowOf('Pawar Shet').textContent).toMatch(/problem/i);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('silent half failed: repeated-problem farms still show, under a note about quiet farms', async () => {
    serve({ status: 500, data: {} }, { data: [sufferingRow(5)], meta: META }, { [F(5)]: 'Pawar Shet' });
    render();
    await waitFor(() => expect(list().textContent).toContain('Pawar Shet'), SETTLE);
    expect(list().textContent).toMatch(/quiet farms/i);
    expect(list().textContent).toMatch(/could not|not counted|not shown/i);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('problems half failed: silent farms still show, under a note about farms with repeated problems', async () => {
    serve(silentAnswer([silentFarm(1, '7-13', 9)]), { status: 500, data: {} });
    render();
    await waitFor(() => expect(list().textContent).toContain('Silent 1'), SETTLE);
    expect(list().textContent).toMatch(/repeated problems/i);
    expect(list().textContent).toMatch(/could not|not counted|not shown/i);
    expect(rowOf('Silent 1').textContent).toMatch(/9 days/);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('silent not measured and no problem farms: never "No farm to call today"', async () => {
    serve(silentAnswer([], 'farm_list_unreadable'), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(/farms could not be read/i), SETTLE);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('problems failed and no silent farms: never "No farm to call today"', async () => {
    serve(silentAnswer([]), { status: 500, data: {} });
    render();
    await waitFor(() => expect(within(list()).getByRole('alert')).toBeTruthy(), SETTLE);
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('both halves real and empty: "No farm to call today"', async () => {
    serve(silentAnswer([]), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(NONE_TODAY), SETTLE);
  });
});

describe('C28 (4): a 403 on either half reads "not available for this account", with no Retry', () => {
  it('403 on the silent half', async () => {
    serve({ status: 403, data: {} }, { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(/not available for this account/i), SETTLE);
    expect(within(list()).queryByRole('button', { name: /retry/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('403 on the problems half', async () => {
    serve(silentAnswer([]), { status: 403, data: {} });
    render();
    await waitFor(() => expect(list().textContent).toMatch(/not available for this account/i), SETTLE);
    expect(within(list()).queryByRole('button', { name: /retry/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(NONE_TODAY);
  });

  it('a 500 still offers Retry (the 403 rule is not "never")', async () => {
    serve({ status: 500, data: {} }, { data: [], meta: META });
    render();
    await waitFor(() => expect(within(list()).getByRole('button', { name: /retry/i })).toBeTruthy(), SETTLE);
  });
});

describe('C28 (5): Home states its rule as visible text', () => {
  it('shows the rule line', async () => {
    serve(silentAnswer([]), { data: [], meta: META });
    render();
    await waitFor(() => expect(list().textContent).toMatch(NONE_TODAY), SETTLE);
    expect(within(list()).getByText('Quiet for 7 to 29 days, or 3 or more problems in the last 7 days.')).toBeTruthy();
  });
});

describe('C28 (7)/(8): no invented zero, no retry on audited reads', () => {
  it('a silent farm with no days value reads "not measured", never 0 days', async () => {
    serve(silentAnswer([silentFarm(1, '7-13', null)]), { data: [], meta: META });
    render();
    await waitFor(() => expect(items()).toHaveLength(1), SETTLE);
    expect(items()[0].textContent).toMatch(/not measured/i);
    expect(items()[0].textContent).not.toMatch(/\b0 days?\b/);
  });

  it('a failing silent and suffering read is asked once each, even when the client would retry', async () => {
    serve({ status: 500, data: {} }, { status: 500, data: {} });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0, gcTime: 0 } } });
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}`, queryClient });
    await waitFor(() => expect(within(list()).getByRole('alert')).toBeTruthy(), SETTLE);
    await idleMs(600);
    expect(stub!.requests.filter((r) => r.path.endsWith(SILENT))).toHaveLength(1);
    expect(stub!.requests.filter((r) => r.path.endsWith(SUFFERING))).toHaveLength(1);
  });

  it('a failing contacts request is made once, not repeated', async () => {
    serve(silentAnswer([]), { data: [sufferingRow(5)], meta: META });
    overrideContacts('fail');
    render();
    await waitFor(() => expect(stub!.contactCalls().length).toBeGreaterThan(0), SETTLE);
    await idleMs(600);
    expect(stub!.contactCalls()).toHaveLength(1);
  });
});
