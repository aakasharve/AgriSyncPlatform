import { screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import SilentChurnPage from '../SilentChurnPage';

/**
 * CR-2e C28 (review round 1 on Task 4), Silent Churn part: plan words (6), no invented zero (7), 403 with no
 * Retry (4), and no retry on the audited read (8). Expected text comes from the C28 amendment.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F = (n: number) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'counted when opened', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 0 };
const SILENT_PATH = '/admin/farms/silent-churn';

interface Line { key: string; what: string }
const LINES = JSON.parse(raw) as Line[];

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
const farm = (n: number, over: Partial<Farm>): Farm => ({
  farmId: F(n), name: `Farm ${n}`, ownerPhone: '9000000001', band: '7-13', daysSilent: 9,
  lastEntryUtc: '2026-08-23T06:00:00Z', planCode: null, planStatus: null, ...over,
});
const answer = (farms: Farm[]) => ({
  data: { countedAtUtc: '2026-09-01T08:30:00Z', farms, notMeasuredReason: null },
  meta: META,
});
function serve(body: unknown) {
  stub = installContactsStub((r) => (r.path.endsWith(SILENT_PATH) ? body : { data: null, meta: META }));
}
const silentCalls = () => stub!.requests.filter((r) => r.path.endsWith(SILENT_PATH));
const render = () => renderWithProviders(<SilentChurnPage />, { route: `/farms/silent-churn?org=${ORG}` });

describe('C28 (6): plan words, never the raw code', () => {
  const WORDS: [string | null, number | null, string][] = [
    ['free', null, 'Free plan'],
    ['free', 2, 'Free plan'],
    ['pro_monthly', 1, 'Trial'],
    ['pro_monthly', 2, 'Paid, active'],
    ['pro_monthly', 3, 'Paid, payment overdue'],
    ['pro_monthly', 4, 'Expired'],
    ['pro_monthly', 5, 'Cancelled'],
    ['pro_monthly', 6, 'Suspended'],
    [null, null, 'No plan recorded'],
  ];

  it('every plan code and status reads as the C28 words and the raw code is never shown', async () => {
    const farms = WORDS.map(([planCode, planStatus], i) =>
      farm(i + 1, { name: `Plan farm ${i + 1}`, planCode, planStatus }),
    );
    serve(answer(farms));
    render();
    await screen.findByText('Plan farm 1', undefined, SETTLE);
    WORDS.forEach(([code, status, words], i) => {
      const row = screen.getByText(`Plan farm ${i + 1}`).closest('tr')!;
      expect(row.textContent, `${code}/${status}`).toContain(words);
      expect(row.textContent, `${code}/${status}`).not.toContain('pro_monthly');
      if (words !== 'Free plan') expect(row.textContent, `${code}/${status}`).not.toMatch(/\bfree\b/i);
    });
    expect(document.body.textContent).not.toContain('pro_monthly');
  });

  it('a plan code with no status still reads as no plan, never the raw code', async () => {
    serve(answer([farm(1, { name: 'Odd farm', planCode: 'pro_monthly', planStatus: null })]));
    render();
    const row = (await screen.findByText('Odd farm', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).not.toContain('pro_monthly');
  });

  it('S3 reads "grouped by days silent and by plan"', () => {
    expect(LINES.find((l) => l.key === 'silent-groups')!.what).toBe(
      'Counts of silent farms grouped by days silent and by plan.',
    );
  });
});

describe('C28 (7): no invented zero', () => {
  it('a missing days value reads "not measured", never 0 days', async () => {
    serve(answer([farm(1, { name: 'Bhosale Mala', band: '14-29', daysSilent: null })]));
    render();
    const row = (await screen.findByText('Bhosale Mala', undefined, SETTLE)).closest('tr')!;
    expect(row.textContent).toMatch(/not measured/i);
    expect(row.textContent).not.toMatch(/\b0 days?\b/);
  });
});

describe('C28 (4)/(8): 403 has no Retry; the audited read is not retried', () => {
  it('a 403 reads "not available for this account" with no Retry button', async () => {
    serve({ status: 403, data: {} });
    render();
    await waitFor(() => expect(document.body.textContent).toMatch(/not available for this account/i), SETTLE);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('a 500 still offers Retry', async () => {
    serve({ status: 500, data: {} });
    render();
    await screen.findByRole('button', { name: /retry/i }, SETTLE);
  });

  it('a failing read is asked once even when the client would retry', async () => {
    serve({ status: 500, data: {} });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0, gcTime: 0 } } });
    renderWithProviders(<SilentChurnPage />, { route: `/farms/silent-churn?org=${ORG}`, queryClient });
    await screen.findByRole('alert', undefined, SETTLE);
    await new Promise((r) => setTimeout(r, 600));
    expect(silentCalls()).toHaveLength(1);
  });
});
