import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type StubbedAdapter } from '@/test/stubAdapter';
import OpsErrorsPage from '../OpsErrorsPage';
import OpsLivePage from '../OpsLivePage';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; K22, the AM7 rule on two more pages).
 *
 * Live Health and API Errors name the farm behind a request through the contacts route, which needs
 * the All farms tick. When the server REFUSES it (403), the page says "Farm names need the All
 * farms tick" instead of silently keeping the short id, which would read as "this farm has no
 * name". A request that failed for another reason keeps the old behaviour: the short id, no claim.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const FARM = 'aaaaaaaa-0000-0000-0000-000000000001';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'last 24h', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 30 };
const SENTENCE = /Farm names need the All farms tick/;

const errorEvent = {
  eventType: 'api.error',
  endpoint: 'POST /shramsafal/sync/push',
  statusCode: 500,
  latencyMs: 40,
  farmId: FARM,
  farmSource: 'address',
  occurredAtUtc: '2026-09-01T08:15:30Z',
};

let stub: StubbedAdapter | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function contactsAnswer(kind: 'module' | 'plain' | 'broken') {
  if (kind === 'module') return { status: 403, data: { code: 'admin_module_forbidden', moduleKey: 'farms.list' } };
  if (kind === 'plain') return { status: 403, data: {} };
  return { status: 500, data: {} };
}

function serveErrors(kind: 'module' | 'plain' | 'broken') {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/farms/contacts')) return contactsAnswer(kind);
    return { status: 200, data: { data: { items: [errorEvent], totalCount: 1, page: 1, pageSize: 50 }, meta: META } };
  });
}

function serveLive(kind: 'module' | 'plain' | 'broken') {
  stub = installAdapter(async (req) => {
    if (req.url.includes('/farms/contacts')) return contactsAnswer(kind);
    return {
      status: 200,
      data: {
        voiceInvocations24h: 10,
        voiceFailures24h: 1,
        voiceFailureRatePct: 10,
        voiceAvgLatencyMs: 900,
        voiceP95LatencyMs: 2000,
        recentErrors: [{ ...errorEvent }],
        topSufferingFarms: [],
        apiErrorSpike: false,
        voiceDegraded: false,
        computedAtUtc: new Date(Date.now() - 60_000).toISOString(),
      },
    };
  });
}

const contactCalls = () => stub!.requests.filter((r) => r.url.includes('/farms/contacts'));

describe('Live_health_and_api_errors_say_farm_names_need_the_all_farms_tick', () => {
  it('API Errors says so when the contacts answer is refused', async () => {
    serveErrors('module');
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });

    expect(await screen.findByText(SENTENCE, undefined, SETTLE)).toBeInTheDocument();
    // The short id is still what the row shows; the sentence is what tells the reader why.
    expect(await screen.findByText(FARM.slice(0, 8), { exact: false }, SETTLE)).toBeInTheDocument();
    // Asked once, not again on every render.
    await new Promise((r) => setTimeout(r, 200));
    expect(contactCalls()).toHaveLength(1);
  });

  it('Live Health says so when the contacts answer is refused', async () => {
    serveLive('module');
    renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}` });

    expect(await screen.findByText(SENTENCE, undefined, SETTLE)).toBeInTheDocument();
    expect(contactCalls().length).toBeGreaterThanOrEqual(1);
  });

  it('a plain 403 reads the same as the module refusal', async () => {
    serveErrors('plain');
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });
    expect(await screen.findByText(SENTENCE, undefined, SETTLE)).toBeInTheDocument();
  });

  it('a request that merely failed does not claim the person lacks a tick', async () => {
    serveErrors('broken');
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });

    await waitFor(() => expect(contactCalls().length).toBeGreaterThan(0), SETTLE);
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it('a person who may see the names sees no such sentence', async () => {
    stub = installAdapter(async (req) => {
      if (req.url.includes('/farms/contacts')) {
        return { status: 200, data: [{ farmId: FARM, name: 'Example: Named Farm', ownerPhone: null }] };
      }
      return { status: 200, data: { data: { items: [errorEvent], totalCount: 1, page: 1, pageSize: 50 }, meta: META } };
    });
    renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}` });

    expect(await screen.findByText('Example: Named Farm', undefined, SETTLE)).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});
