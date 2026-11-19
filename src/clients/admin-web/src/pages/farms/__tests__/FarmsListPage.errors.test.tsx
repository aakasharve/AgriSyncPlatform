import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter } from '@/test/stubAdapter';
import type { StubbedAdapter } from '@/test/stubAdapter';
import type { FarmSummary } from '@/hooks/useFarms';
import FarmsListPage from '../FarmsListPage';

/**
 * CR-2e Task 1 (page part), C9: All Farms "Errors 24h" shows the count the server served (F6, real), under its two
 * lines, with no "Not built yet". The page never polls and never asks the contacts route (the farm names are
 * already in this answer).
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const SETTLE = { timeout: 15_000 };
const F6 = (JSON.parse(raw) as { key: string; what: string; why: string }[]).find((l) => l.key === 'farms-errors24h')!;

function farm(over: Partial<FarmSummary> = {}): FarmSummary {
  return {
    farmId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Bhosale Mala', ownerPhone: '9876543210', plan: 'trial',
    wvfd7d: null, engagementTier: null, errors24h: 11, lastLogAt: '2026-08-24T09:00:00Z', createdAt: '2024-03-12T09:00:00Z',
    ...over,
  } as FarmSummary;
}

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function serve(items: FarmSummary[]) {
  stub = installAdapter(async () => ({
    status: 200,
    data: {
      data: { items, totalCount: items.length, page: 1, pageSize: 40 },
      meta: { source: 'live-aggregated', window: 'current', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 60 },
    },
  }));
}

async function renderFarms() {
  renderWithProviders(<FarmsListPage />, { route: `/farms?org=${ORG}` });
  const table = await screen.findByRole('table', { name: 'All farms' }, SETTLE);
  await screen.findByText('Bhosale Mala', undefined, SETTLE);
  return table;
}

describe('All Farms Errors 24h (F6, real)', () => {
  it('Errors_24h_shows_the_served_count', async () => {
    serve([farm({ errors24h: 11 }), farm({ farmId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Pawar Shet', errors24h: 0 })]);
    const table = await renderFarms();

    const headers = within(table).getAllByRole('columnheader');
    const idx = headers.findIndex((h) => (h.textContent ?? '').includes('Errors 24h'));
    expect(idx, 'Errors 24h header').toBeGreaterThanOrEqual(0);
    expect(headers[idx].textContent).not.toContain('Not built yet');

    const rowFor = (name: string) => within(table).getByText(name).closest('tr')!;
    const cell = (name: string) => [...rowFor(name).querySelectorAll('td')][idx];
    expect(cell('Bhosale Mala').textContent!.trim()).toBe('11');
    // A served zero is a real zero for a farm that named no problem; it is not hidden.
    expect(cell('Pawar Shet').textContent!.trim()).toBe('0');

    // Its two lines sit under the table, and say the count covers requests that named the farm.
    const el = document.querySelector<HTMLElement>('[data-metric="farms-errors24h"]')!;
    expect(el.textContent).toContain(F6.what);
    expect(el.textContent).toContain(F6.why);
    expect(el.textContent).not.toContain('Not built yet');
    expect(F6.what).toMatch(/requests that named this farm/);
  });

  it('is not given a value from a missing count, and asks the contacts route for nothing', async () => {
    serve([farm({ errors24h: undefined as unknown as number })]);
    const table = await renderFarms();
    const headers = within(table).getAllByRole('columnheader');
    const idx = headers.findIndex((h) => (h.textContent ?? '').includes('Errors 24h'));
    const text = [...within(table).getByText('Bhosale Mala').closest('tr')!.querySelectorAll('td')][idx].textContent!;
    expect(text).not.toMatch(/\b0\b/);
    await waitFor(() => expect(stub!.requests.length).toBeGreaterThan(0));
    expect(stub!.requests.some((r) => r.url.includes('/farms/contacts'))).toBe(false);
  });
});
