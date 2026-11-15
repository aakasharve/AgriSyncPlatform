import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, focusManager, onlineManager, type UseQueryResult } from '@tanstack/react-query';
import {
  COMPANY_MIS_PATH, classifyMisError, useCompanyMis, type CompanyMis,
} from '@/hooks/useCompanyMis';
import type { AdminResponse } from '@/lib/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import { misEnvelope } from '@/test/misFixture';

/**
 * CR-2b Task 1 — the one request behind all seven Company MIS pages.
 * Written from the plan (Global Constraints "One fetch per range", Task 1) and
 * CR-2a "The response contract" only.
 *
 * Every load counts the whole company and writes an audit row on the server,
 * so the plan pins: one request per (org, from, to); no polling, no refetch on
 * focus or reconnect, no retry.
 */

const FROM = '2026-10-17';
const TO = '2026-11-15';

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

/** A client whose DEFAULTS would retry and refetch, so only the hook's own options can keep it to one request. */
function eagerClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 3,
        retryDelay: 1,
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });
}

type Result = UseQueryResult<AdminResponse<CompanyMis>>;

function Probe({ range, onResult }: { range: { from: string; to: string }; onResult?: (r: Result) => void }) {
  const r = useCompanyMis(range);
  onResult?.(r);
  return null;
}

const misRequests = () => (stub?.requests ?? []).filter((r) => r.url.includes(COMPANY_MIS_PATH));

describe('useCompanyMis: one request per range (CR-2b Task 1)', () => {
  it('Calls_the_company_route_with_both_dates', async () => {
    stub = installAdapter(async () => ({ status: 200, data: misEnvelope() }));
    renderWithProviders(<Probe range={{ from: FROM, to: TO }} />, { queryClient: eagerClient() });

    await waitFor(() => expect(misRequests()).toHaveLength(1));
    expect(misRequests()[0].method).toBe('get');
    expect(misRequests()[0].url).toBe(`/shramsafal/admin/mis/company?from=${FROM}&to=${TO}`);
  });

  it('Files_the_answer_under_org_and_both_dates', async () => {
    stub = installAdapter(async () => ({ status: 200, data: misEnvelope() }));
    const client = eagerClient();
    renderWithProviders(<Probe range={{ from: FROM, to: TO }} />, { queryClient: client });

    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(1));
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['mis', 'company', 'none', FROM, TO]);
    await waitFor(() =>
      expect(client.getQueryData(['mis', 'company', 'none', FROM, TO])).toEqual(misEnvelope()),
    );
  });

  it('One_range_is_fetched_once', async () => {
    stub = installAdapter(async () => ({ status: 200, data: misEnvelope() }));
    const client = eagerClient();
    let last: Result | null = null;
    renderWithProviders(
      <>
        <Probe range={{ from: FROM, to: TO }} onResult={(r) => { last = r; }} />
        <Probe range={{ from: FROM, to: TO }} />
      </>,
      { queryClient: client },
    );
    await waitFor(() => expect((last as Result | null)?.isSuccess).toBe(true));
    expect(misRequests()).toHaveLength(1);

    // The window loses and regains focus, the network drops and comes back.
    act(() => {
      focusManager.setFocused(false);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });

    // Ten minutes pass.
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 30));

    expect(misRequests()).toHaveLength(1);
  });

  it('Never_polls_never_retries', async () => {
    stub = installAdapter(async () => ({ status: 500, data: { message: 'boom' } }));
    const client = eagerClient();
    let last: Result | null = null;
    renderWithProviders(<Probe range={{ from: FROM, to: TO }} onResult={(r) => { last = r; }} />, { queryClient: client });

    await waitFor(() => expect((last as Result | null)?.isError).toBe(true));
    await new Promise((r) => setTimeout(r, 60));
    expect(misRequests()).toHaveLength(1);

    const q = client.getQueryCache().getAll()[0] as unknown as {
      observers: Array<{ options: { refetchInterval?: unknown; retry?: unknown; staleTime?: unknown } }>;
    };
    expect(q.observers[0].options.refetchInterval).toBe(false);
    expect(q.observers[0].options.retry).toBe(0);
    expect(q.observers[0].options.staleTime).toBe(Infinity);
  });

  it('A_new_range_is_a_new_request', async () => {
    stub = installAdapter(async () => ({ status: 200, data: misEnvelope() }));
    const client = eagerClient();
    const view = renderWithProviders(<Probe range={{ from: FROM, to: TO }} />, { queryClient: client });
    await waitFor(() => expect(misRequests()).toHaveLength(1));

    const { QueryClientProvider } = await import('@tanstack/react-query');
    const { MemoryRouter } = await import('react-router-dom');
    const { ActiveOrgProvider } = await import('@/app/ActiveOrgProvider');
    const { AdminAuthProvider } = await import('@/app/AdminAuthProvider');
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActiveOrgProvider>
            <AdminAuthProvider>
              <Probe range={{ from: '2026-11-09', to: TO }} />
            </AdminAuthProvider>
          </ActiveOrgProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(misRequests()).toHaveLength(2));
    expect(misRequests()[1].url).toBe(`/shramsafal/admin/mis/company?from=2026-11-09&to=${TO}`);
    await new Promise((r) => setTimeout(r, 30));
    expect(misRequests()).toHaveLength(2);
  });
});

describe('useCompanyMis: what went wrong, in words (CR-2b Task 1)', () => {
  async function failWith(status: number, data: unknown) {
    stub = installAdapter(async () => ({ status, data }));
    let last: Result | null = null;
    renderWithProviders(<Probe range={{ from: FROM, to: TO }} onResult={(r) => { last = r; }} />, { queryClient: eagerClient() });
    await waitFor(() => expect((last as Result | null)?.isError).toBe(true));
    return last as unknown as Result;
  }

  it('Platform_only_is_denied_in_plain_words', async () => {
    const r = await failWith(403, { code: 'admin_platform_only' });
    const problem = classifyMisError(r.error);
    expect(problem.kind).toBe('denied');
    expect(problem.message).toBe('This screen is for Platform owners only.');
    expect(problem.kind === 'denied' && problem.remedy.length > 0).toBe(true);
    expect(r.data).toBeUndefined();
  });

  it('A_bad_range_is_named', async () => {
    const r = await failWith(400, { code: 'mis_range_invalid', message: 'to is after today' });
    const problem = classifyMisError(r.error);
    expect(problem).toEqual({
      kind: 'badRange',
      message: 'That date range cannot be counted. Pick an end date no later than today and at most 180 days.',
    });
    expect(r.data).toBeUndefined();
  });

  it('A_server_failure_is_failed_not_empty', async () => {
    const r = await failWith(500, { message: 'read failed' });
    expect(r.data).toBeUndefined();
    expect(classifyMisError(r.error)).toEqual({
      kind: 'failed',
      message: 'The numbers could not be counted just now. Nothing on this page is a zero.',
    });
    expect(misRequests()).toHaveLength(1);
  });
});
