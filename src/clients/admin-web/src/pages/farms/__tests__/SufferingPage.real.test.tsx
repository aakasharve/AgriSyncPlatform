import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import SufferingPage from '../SufferingPage';

/**
 * CR-2e Task 2 (page part): Suffering lists the farms the server served (three or more problems in 7 days,
 * platform owners only), with names from the contacts route and the four areas. U1 and U2 are real.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const F2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'last 7 days', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 30 };

interface Line { key: string; what: string; why: string }
const LINES = JSON.parse(raw) as Line[];
const line = (key: string) => LINES.find((l) => l.key === key)!;

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

const served = [
  { farmId: F1, problemCount: 9, syncProblems: 4, entryProblems: 3, voiceProblems: 1, otherProblems: 1, lastProblemAt: '2026-08-31T09:15:00Z' },
  { farmId: F2, problemCount: 3, syncProblems: 0, entryProblems: 0, voiceProblems: 2, otherProblems: 1, lastProblemAt: '2026-08-30T07:00:00Z' },
];

function render() {
  return renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
}

function rowsOf(): HTMLTableRowElement[] {
  const table = screen.getByRole('table', { name: 'Farms with repeated problems' });
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter((tr) => !tr.id.includes('detail'));
}

describe('Suffering is real (U1, U2)', () => {
  it('Suffering_lists_served_farms_with_names_and_areas', async () => {
    stub = installContactsStub(
      (r) => (r.path.endsWith('/admin/farms/suffering') ? { data: served, meta: META } : { data: null, meta: META }),
      { [F1]: 'Bhosale Mala', [F2]: 'Pawar Shet' },
    );
    render();
    await screen.findByRole('table', { name: 'Farms with repeated problems' }, SETTLE);
    await waitFor(() => expect(document.body.textContent).toContain('Bhosale Mala'), SETTLE);
    expect(document.body.textContent).toContain('Pawar Shet');

    // Names were asked for once, for the two served farms, from the contacts route (not from the suffering answer).
    const calls = stub.contactCalls();
    expect(calls).toHaveLength(1);
    expect(stub.idsOf(calls[0])).toEqual([F1, F2]);

    // The four areas and the count, read off the cells of ONE row (the biggest first).
    const [first, second] = rowsOf();
    const cells = (tr: HTMLTableRowElement) => [...tr.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim());
    expect(cells(first)[0]).toContain('Bhosale Mala');
    expect(cells(first).slice(1, 6)).toEqual(['9', '4', '3', '1', '1']);
    expect(cells(second)[0]).toContain('Pawar Shet');
    expect(cells(second).slice(1, 6)).toEqual(['3', '0', '0', '2', '1']);

    // The two reviewed lines are on the page, as real (no "Not built yet").
    for (const key of ['suffering-watchlist', 'suffering-areas']) {
      const el = document.querySelector<HTMLElement>(`[data-metric="${key}"]`)!;
      expect(el, key).not.toBeNull();
      expect(el.textContent).toContain(line(key).what);
      expect(el.textContent).toContain(line(key).why);
    }
    expect(document.body.textContent).not.toContain('Not built yet');
  });

  it('a farm the server knows no name for shows its short id, never a blank', async () => {
    stub = installContactsStub(
      (r) => (r.path.endsWith('/admin/farms/suffering') ? { data: served, meta: META } : { data: null, meta: META }),
      {},
    );
    render();
    await screen.findByRole('table', { name: 'Farms with repeated problems' }, SETTLE);
    await waitFor(() => expect(stub!.contactCalls()).toHaveLength(1), SETTLE);
    const [first] = rowsOf();
    expect(first.querySelector('td')!.textContent).toContain(F1.slice(0, 8));
  });

  it('An_empty_answer_says_no_farm_has_repeated_problems_this_week', async () => {
    stub = installContactsStub(() => ({ data: [], meta: META }));
    render();
    // A true empty answer is a real none, worded with its window.
    await screen.findByText(/No farm has repeated problems in the last 7 days/, undefined, SETTLE);
    expect(screen.queryByRole('table', { name: 'Farms with repeated problems' })).toBeNull();
    expect(document.body.textContent).not.toContain('Not built yet');
    // Nothing to name, so no contacts request.
    expect(stub.contactCalls()).toHaveLength(0);
  });

  it('a failed request says it could not load and never says none', async () => {
    stub = installContactsStub(() => ({ status: 500, data: {} }));
    render();
    const list = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-list="suffering"]');
      expect(el).not.toBeNull();
      expect(within(el!).getByRole('alert')).toHaveAttribute('data-state', 'load-failed');
      return el!;
    }, SETTLE);
    expect(list.textContent).not.toMatch(/No farm has repeated problems/);
  });
});
