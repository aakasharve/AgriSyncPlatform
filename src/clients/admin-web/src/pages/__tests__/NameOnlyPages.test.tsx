import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub, type ContactsStub } from '@/test/contactsStub';
import OpsLivePage from '@/pages/ops/OpsLivePage';
import OpsErrorsPage from '@/pages/ops/OpsErrorsPage';
import NorthStarPage from '@/pages/metrics/NorthStarPage';
import SufferingPage from '@/pages/farms/SufferingPage';
import HomePage from '@/pages/HomePage';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, G1 fix round 1, I-1).
 *
 * A page that shows farm NAMES only asks the contacts route with `namesOnly=true`, so the server
 * redacts the phone and records no phone look. A page that shows a phone asks without it.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = 'aaaaaaaa-0000-0000-0000-000000000001';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'w', lastRefreshedUtc: '2026-11-19T04:00:00.000Z', ttlSeconds: 0 };

const errorEvent = {
  eventType: 'api.error', endpoint: 'POST /shramsafal/sync/push', statusCode: 500, latencyMs: 40,
  farmId: FARM, farmSource: 'address', occurredAtUtc: '2026-09-01T08:15:30Z',
};
const sufferingRow = {
  farmId: FARM, problemCount: 5, syncProblems: 2, entryProblems: 1, voiceProblems: 1, otherProblems: 1,
  lastProblemAt: '2026-08-31T09:15:00Z',
};

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

const NAMES = { [FARM]: 'Example: Named Farm' };

function serve() {
  stub = installContactsStub((r) => {
    if (r.path.endsWith('/me/scope')) {
      return {
        outcome: 'Resolved',
        scope: {
          userId: 'u1', orgId: ORG, orgType: 'Platform', orgRole: 'Owner', isPlatformAdmin: true,
          modules: ['farms.suffering', 'farms.silent-churn'].map((key) => ({ key, canRead: true, canExport: false, canWrite: false })),
        },
        memberships: [],
      };
    }
    if (r.path.endsWith('/farms/suffering')) return { data: [sufferingRow], meta: META };
    if (r.path.endsWith('/farms/silent-churn')) {
      return { data: { countedAtUtc: '2026-09-01T08:30:00Z', farms: [], notMeasuredReason: null }, meta: META };
    }
    if (r.path.endsWith('/metrics/wvfd')) {
      return {
        data: {
          currentWvfd: 3, currentSelfOnlyDays: 0, priorWvfd: 2, goalWvfd: null,
          weeks: [{ weekStart: '2026-11-09', avgWvfd: 3, avgSelfOnlyDays: 0, activeFarms: 1, isPartial: false }],
          farms: [{ farmId: FARM, checkedDays: 3, selfOnlyDays: 0, engagementTier: 'B' }],
          countedAtUtc: '2026-11-19T04:00:00Z', notMeasuredReason: null,
        },
        meta: META,
      };
    }
    if (r.path.includes('/ops/errors') || r.path.includes('/errors')) {
      return { data: { items: [errorEvent], totalCount: 1, page: 1, pageSize: 50 }, meta: META };
    }
    return {
      voiceInvocations24h: 10, voiceFailures24h: 1, voiceFailureRatePct: 10, voiceAvgLatencyMs: 900,
      voiceP95LatencyMs: 2000, recentErrors: [{ ...errorEvent }], topSufferingFarms: [sufferingRow],
      apiErrorSpike: false, voiceDegraded: false, computedAtUtc: new Date(Date.now() - 60_000).toISOString(),
    };
  }, NAMES);
}

async function firstContactCall() {
  await waitFor(() => expect(stub!.contactCalls().length).toBeGreaterThan(0), SETTLE);
  return stub!.contactCalls()[0];
}

describe('Name_only_pages_ask_for_names_only', () => {
  it('Live Health', async () => {
    serve();
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });
    expect((await firstContactCall()).params.namesOnly).toBe('true');
  });
  it('API Errors', async () => {
    serve();
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    expect((await firstContactCall()).params.namesOnly).toBe('true');
  });
  it('North Star', async () => {
    serve();
    renderWithProviders(<NorthStarPage />, { route: `/metrics/nsm?org=${ORG}` });
    expect((await firstContactCall()).params.namesOnly).toBe('true');
  });
  it('Suffering', async () => {
    serve();
    renderWithProviders(<SufferingPage />, { route: `/farms/suffering?org=${ORG}` });
    expect((await firstContactCall()).params.namesOnly).toBe('true');
  });
});

describe('A phone-showing caller still asks without it', () => {
  it('Home (the call list shows a phone) sends no namesOnly', async () => {
    serve();
    renderWithProviders(<HomePage />, { route: `/home?org=${ORG}` });
    const call = await firstContactCall();
    expect(call.params.ids).toContain(FARM);
    expect(call.params.namesOnly).toBeUndefined();
    expect(call.url).not.toMatch(/namesOnly/);
    await screen.findByText(/Example: Named Farm/, undefined, SETTLE);
  });
});
