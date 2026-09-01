import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { useOpsHealth } from '@/hooks/useOpsHealth';
import { useOpsErrors } from '@/hooks/useOpsErrors';
import { useFarmsList, useSilentChurn, useSuffering } from '@/hooks/useFarms';
import { useOpsVoice } from '@/hooks/useOpsVoice';
import { useUsersList } from '@/hooks/useUsers';
import { useWvfd } from '@/hooks/useWvfd';
import { useCohortPatterns } from '@/features/farmer-health/hooks/useCohortPatterns';
import { useFarmerHealth } from '@/features/farmer-health/hooks/useFarmerHealth';
import { farmerHealthApi } from '@/features/farmer-health/api/farmerHealthApi';
import ScheduleTemplatesPage from '@/pages/schedules/ScheduleTemplatesPage';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, neverSettles, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * CHARACTERISATION TEST — Preservation Register A23, A26, A27, A28.
 *
 * Four contracts that live in numbers and strings rather than in pixels:
 *
 *  A23 — the polling cadences. This console runs against a 2-vCPU box. Turning
 *        a 5-minute refetch into a 30-second one is invisible on screen and
 *        multiplies load tenfold on the endpoint that already costs the most.
 *  A26 — farmer-health does NOT live under /shramsafal/admin/. Normalising the
 *        prefix "for consistency" 404s the entire feature.
 *  A27 — /ops/health is the ONE endpoint with no AdminResponse envelope.
 *        Wrapping it, or unwrapping the others, breaks the caller silently.
 *  A28 — the abort signal, retry 0 and the enabled gate that lets the farmer
 *        search box mount a query without firing it.
 *
 * Cadences are read off the live query observer, not off the source text, so a
 * refactor that moves a literal into a constant stays green while a change to
 * the actual number goes red.
 *
 * ── CHANGED IN TASK 12, WITH THE BEHAVIOUR IT DESCRIBES ───────────────────
 * Every key asserted here gained an ORG SEGMENT (Preservation Register A7).
 * The cadences, the prefixes, the envelope shapes, the abort signal and the
 * enabled gate are all untouched — only the key each of them is filed under.
 * The org sits immediately after the resource prefix and before the variables,
 * so `['farms']` still works as an invalidation prefix.
 *
 * `'none'` is the org segment when nothing is selected, which is the state
 * every test here mounts in: they render bare hooks with no `?org=`, and that
 * is deliberate — a test that supplied an org would stop proving that the key
 * carries the segment at all.
 */

/** No `?org=` is set anywhere in this file, so every key ends up under 'none'. */
const NO_ORG = 'none';

interface ObserverOptions {
  staleTime?: number;
  refetchInterval?: number | false;
  retry?: number | boolean;
  enabled?: boolean;
}

function mountHook(use: () => unknown, queryClient: QueryClient = makeTestQueryClient()) {
  function Probe() {
    use();
    return null;
  }
  const view = renderWithProviders(<Probe />, { queryClient });
  return { queryClient, unmount: view.unmount };
}

/** The single query the mounted hook created, and the options it is running on. */
function onlyQuery(queryClient: QueryClient) {
  const queries = queryClient.getQueryCache().getAll();
  expect(queries).toHaveLength(1);
  return queries[0] as unknown as {
    queryKey: readonly unknown[];
    observers: Array<{ options: ObserverOptions }>;
  };
}

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

describe('per-surface polling cadences (A23)', () => {
  it.each([
    ['ops/health', () => useOpsHealth(), 25_000, 30_000],
    ['ops/errors', () => useOpsErrors({ page: 1, pageSize: 50 }), 25_000, 30_000],
    ['farms/suffering', () => useSuffering(), 60_000, 60_000],
    ['ops/voice', () => useOpsVoice(), 300_000, 300_000],
    ['metrics/wvfd', () => useWvfd(), 300_000, 300_000],
    ['farmer-health/cohort', () => useCohortPatterns(), 60_000, 300_000],
  ] as const)('%s polls on its own cadence', async (_name, use, staleTime, refetchInterval) => {
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    const { queryClient } = mountHook(use);
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    const options = onlyQuery(queryClient).observers[0].options;
    expect(options.staleTime).toBe(staleTime);
    expect(options.refetchInterval).toBe(refetchInterval);
  });

  it.each([
    ['farms/list', () => useFarmsList(1, 40), 60_000],
    ['farms/silent-churn', () => useSilentChurn(), 300_000],
    ['users/list', () => useUsersList(1, 50), 60_000],
    ['farmer-health/drilldown', () => useFarmerHealth('farm-1'), 60_000],
  ] as const)('%s does NOT poll', async (_name, use, staleTime) => {
    // Only six surfaces poll. Adding an interval to a list screen is a load
    // change nobody would see in review.
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    const { queryClient } = mountHook(use);
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    const options = onlyQuery(queryClient).observers[0].options;
    expect(options.staleTime).toBe(staleTime);
    expect(options.refetchInterval).toBeUndefined();
  });
});

describe('endpoint prefixes (A26)', () => {
  it.each([
    ['useOpsHealth', () => useOpsHealth(), '/shramsafal/admin/ops/health'],
    ['useOpsErrors', () => useOpsErrors({ page: 1, pageSize: 50 }), '/shramsafal/admin/ops/errors?page=1&pageSize=50'],
    ['useSuffering', () => useSuffering(), '/shramsafal/admin/farms/suffering'],
    ['useSilentChurn', () => useSilentChurn(), '/shramsafal/admin/farms/silent-churn'],
    ['useFarmsList', () => useFarmsList(1, 40), '/shramsafal/admin/farms?page=1&pageSize=40'],
    ['useUsersList', () => useUsersList(1, 50), '/shramsafal/admin/users?page=1&pageSize=50'],
    ['useOpsVoice', () => useOpsVoice(), '/shramsafal/admin/ops/voice?days=14'],
    ['useWvfd', () => useWvfd(), '/shramsafal/admin/metrics/wvfd?weeks=12'],
  ] as const)('%s calls %s', async (_name, use, url) => {
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    mountHook(use);

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub.requests[0].url).toBe(url);
  });

  it('serves farmer-health from /admin/farmer-health/, NOT from /shramsafal/admin/', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    await farmerHealthApi.getCohort();
    await farmerHealthApi.getFarmerHealth('farm-1');

    expect(stub.requests.map((r) => r.url)).toEqual([
      '/admin/farmer-health/cohort',
      '/admin/farmer-health/farm-1',
    ]);
    for (const request of stub.requests) {
      expect(request.url.startsWith('/shramsafal/')).toBe(false);
    }
  });

  it('percent-encodes the farm id into the drilldown path', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    await farmerHealthApi.getFarmerHealth('farm/1');

    expect(stub.requests[0].url).toBe('/admin/farmer-health/farm%2F1');
  });

  it('reads schedule templates from reference-data, and gets a RAW array with no envelope', async () => {
    // ScheduleTemplatesPage.tsx:17 — the one admin screen whose endpoint returns
    // no AdminResponse at all. It therefore has no meta.source and no
    // meta.lastRefreshed to put in a freshness chip.
    stub = installAdapter(async () => ({
      status: 200,
      data: [
        {
          templateId: 't1', name: 'Grapes', cropType: 'GRAPES', version: '1',
          isPublished: true, taskCount: 3, estimatedDurationDays: 90,
        },
      ],
    }));
    const queryClient = makeTestQueryClient();

    renderWithProviders(<ScheduleTemplatesPage />, { queryClient });

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub.requests[0].url).toBe('/shramsafal/reference-data/crop-schedule-templates');

    await waitFor(() =>
      expect(queryClient.getQueryData(['schedules', 'templates', NO_ORG])).toBeDefined(),
    );
    const cached = queryClient.getQueryData(['schedules', 'templates', NO_ORG]);
    expect(Array.isArray(cached)).toBe(true);
    expect(cached).not.toHaveProperty('meta');
    expect(cached).not.toHaveProperty('data');
  });
});

describe('/ops/health is the one unwrapped endpoint (A27)', () => {
  const healthPayload = {
    voiceInvocations24h: 10, voiceFailures24h: 1, voiceFailureRatePct: 10,
    voiceAvgLatencyMs: 900, voiceP95LatencyMs: 1800,
    recentErrors: [], topSufferingFarms: [],
    apiErrorSpike: false, voiceDegraded: false,
    computedAtUtc: '2026-08-30T11:41:00Z',
  };

  it('caches the health payload UNWRAPPED — computedAtUtc sits at the top level', async () => {
    stub = installAdapter(async () => ({ status: 200, data: healthPayload }));

    const { queryClient } = mountHook(() => useOpsHealth());

    await waitFor(() =>
      expect(queryClient.getQueryData(['ops', 'health', NO_ORG])).toBeDefined(),
    );
    const cached = queryClient.getQueryData(['ops', 'health', NO_ORG]);
    expect(cached).toEqual(healthPayload);
    expect(cached).not.toHaveProperty('meta');
    expect(cached).toHaveProperty('computedAtUtc', '2026-08-30T11:41:00Z');
  });

  it('caches every other admin surface WRAPPED, meta and all', async () => {
    const envelope = {
      data: { items: [], totalCount: 0, page: 1, pageSize: 50 },
      meta: {
        source: 'live', window: '24h',
        lastRefreshedUtc: '2026-08-30T11:41:00Z', ttlSeconds: 30,
      },
    };
    stub = installAdapter(async () => ({ status: 200, data: envelope }));

    const { queryClient } = mountHook(() => useOpsErrors({ page: 1, pageSize: 50 }));

    await waitFor(() => expect(onlyQuery(queryClient).observers).toHaveLength(1));
    await waitFor(() =>
      expect(
        queryClient.getQueryData(['ops', 'errors', NO_ORG, { page: 1, pageSize: 50 }]),
      ).toBeDefined(),
    );
    // CORRECTED 2026-09-01. This asserted `meta.lastRefreshed` — the key the
    // client TYPE named, not the key the server sends. AdminMetaDto is
    // (Source, Window, LastRefreshedUtc, TtlSeconds), so the wire key is
    // `lastRefreshedUtc`. This test was the one place that could have caught the
    // inversion, and instead it encoded it: the fixture above stubbed the wrong
    // key, and the assertion agreed with the fixture. Both now match the server.
    expect(queryClient.getQueryData(['ops', 'errors', NO_ORG, { page: 1, pageSize: 50 }]))
      .toHaveProperty('meta.lastRefreshedUtc');
  });
});

describe('abort signal, retry and the enabled gate (A28)', () => {
  it.each([
    ['cohort', () => useCohortPatterns()],
    ['drilldown', () => useFarmerHealth('farm-1')],
  ] as const)('threads an AbortSignal into axios on the %s query', async (_name, use) => {
    stub = installAdapter(neverSettles);

    mountHook(use);

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(stub.requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(stub.requests[0].signal?.aborted).toBe(false);
  });

  it('aborts the in-flight cohort request when the component unmounts', async () => {
    stub = installAdapter(neverSettles);

    const { unmount } = mountHook(() => useCohortPatterns());
    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));

    unmount();

    await waitFor(() => expect(stub?.requests[0].signal?.aborted).toBe(true));
  });

  it('gives the drilldown query retry 0 — a 404 fails on the first attempt', async () => {
    // The farmer search box reads this failure as "no such farm". A retry turns
    // a miss into a second wasted call and a slower answer.
    stub = installAdapter(async () => ({ status: 404, data: {} }));

    const { queryClient } = mountHook(() => useFarmerHealth('missing-farm'));

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(onlyQuery(queryClient).observers[0].options.retry).toBe(0);

    await waitFor(() =>
      expect(
        queryClient.getQueryState(['farmer-health', 'drilldown', NO_ORG, 'missing-farm'])?.status,
      ).toBe('error'),
    );
    expect(stub.requests).toHaveLength(1);
  });

  it.each([
    ['a null farm id', () => useFarmerHealth(null), ''],
    ['an empty farm id', () => useFarmerHealth(''), ''],
    ['a whitespace-only farm id', () => useFarmerHealth('   '), ''],
    ['enabled: false', () => useFarmerHealth('farm-1', { enabled: false }), 'farm-1'],
  ] as const)('stays mounted but idle with %s', async (_name, use, expectedKeySegment) => {
    // The idle-but-mounted mode: FarmerSearchBox keeps the hook mounted so that
    // a submit is a single state change, not a mount.
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    const { queryClient } = mountHook(use);

    const query = onlyQuery(queryClient);
    expect(query.queryKey).toEqual(['farmer-health', 'drilldown', NO_ORG, expectedKeySegment]);
    expect(query.observers[0].options.enabled).toBe(false);
    expect(
      queryClient.getQueryState(['farmer-health', 'drilldown', NO_ORG, expectedKeySegment])
        ?.fetchStatus,
    ).toBe('idle');
    expect(stub.requests).toHaveLength(0);
  });

  it('trims the farm id into both the query key and the URL', async () => {
    stub = installAdapter(async () => ({ status: 200, data: { data: {}, meta: {} } }));

    const { queryClient } = mountHook(() => useFarmerHealth('  farm-1  '));

    await waitFor(() => expect(stub?.requests.length).toBeGreaterThan(0));
    expect(onlyQuery(queryClient).queryKey).toEqual([
      'farmer-health', 'drilldown', NO_ORG, 'farm-1',
    ]);
    expect(stub.requests[0].url).toBe('/admin/farmer-health/farm-1');
  });
});
