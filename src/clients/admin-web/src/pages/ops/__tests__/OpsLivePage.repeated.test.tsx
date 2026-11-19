import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import raw from '@/__tests__/fixtures/b24-metric-lines.json?raw';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import type { OpsErrorEvent, OpsHealthData } from '@/hooks/useOpsHealth';
import OpsLivePage from '../OpsLivePage';

/**
 * CR-2e Task 2 (page part) and C20 on Live Health: the 24-hour farm list (L7, real), and the recent-events Farm
 * cell, which uses the contact name or "Not named in the request" like API Errors. An empty recent-events answer is
 * a plain none with its window; a failed request is "could not load".
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const F2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const SETTLE = { timeout: 15_000 };
const L7 = (JSON.parse(raw) as { key: string; what: string; why: string }[]).find((l) => l.key === 'live-suffering-24h')!;

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

function health(over: Partial<OpsHealthData> = {}): OpsHealthData {
  return {
    voiceInvocations24h: 0, voiceFailures24h: 0, voiceFailureRatePct: 0, voiceAvgLatencyMs: 0, voiceP95LatencyMs: 0,
    recentErrors: [], topSufferingFarms: [], apiErrorSpike: false, voiceDegraded: false,
    computedAtUtc: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

function event(over: Partial<OpsErrorEvent> = {}): OpsErrorEvent {
  return {
    eventType: 'api.error', endpoint: '/shramsafal/sync/push', statusCode: 500, latencyMs: 240,
    farmId: null, farmSource: null, occurredAtUtc: '2026-09-01T11:40:00.0000000Z',
    ...over,
  };
}

function serve(getHealth: () => OpsHealthData, names: Record<string, string> = {}) {
  // The health endpoint sends its DTO bare, with no envelope.
  stub = installContactsStub(() => getHealth(), names);
}

function render(queryClient = makeTestQueryClient()) {
  return renderWithProviders(<OpsLivePage />, { route: `/ops/live?org=${ORG}`, queryClient });
}

async function settled() {
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0), SETTLE);
  await waitFor(() => expect(document.querySelector('.chip-fresh')).not.toBeNull(), SETTLE);
}

const sufferingTable = () => screen.getByRole('table', { name: 'Farms with repeated problems, last 24 hours' });
const cellsOf = (tr: Element) => [...tr.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim());
const bodyRows = (t: HTMLElement) => [...t.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter((tr) => !tr.id.includes('detail'));

describe('Live Health lists the 24-hour farms (L7, real)', () => {
  it('Live_lists_the_24_hour_farms', async () => {
    serve(
      () =>
        health({
          topSufferingFarms: [
            { farmId: F1, errorCount: 5, syncErrors: 2, logErrors: 1, voiceErrors: 1, otherErrors: 1, lastErrorAt: '2026-09-01T11:38:00Z' },
            { farmId: F2, errorCount: 2, syncErrors: 0, logErrors: 2, voiceErrors: 0, otherErrors: 0, lastErrorAt: '2026-09-01T10:00:00Z' },
          ],
        }),
      { [F1]: 'Bhosale Mala', [F2]: 'Pawar Shet' },
    );
    render();
    await settled();
    await waitFor(() => expect(document.body.textContent).toContain('Bhosale Mala'), SETTLE);
    expect(document.body.textContent).toContain('Pawar Shet');

    const [first, second] = bodyRows(sufferingTable());
    expect(cellsOf(first)[0]).toContain('Bhosale Mala');
    expect(cellsOf(first).slice(1, 6)).toEqual(['5', '2', '1', '1', '1']);
    expect(cellsOf(second)[0]).toContain('Pawar Shet');
    expect(cellsOf(second).slice(1, 6)).toEqual(['2', '0', '2', '0', '0']);

    // The line is on the page as real: both of its lines, no "Not built yet".
    const el = document.querySelector<HTMLElement>('[data-metric="live-suffering-24h"]')!;
    expect(el.textContent).toContain(L7.what);
    expect(el.textContent).toContain(L7.why);
    expect(el.textContent).not.toContain('Not built yet');
  });

  it('a served empty list says no farm has repeated problems in the last 24 hours', async () => {
    serve(() => health({ topSufferingFarms: [] }));
    render();
    await settled();
    await screen.findByText(/No farm has repeated problems in the last 24 hours/, undefined, SETTLE);
    expect(screen.queryByRole('table', { name: 'Farms with repeated problems, last 24 hours' })).toBeNull();
  });
});

describe('the recent-events Farm cell (C3, C20)', () => {
  it('shows the contact name, or "Not named in the request", and fetches each new id once', async () => {
    let events = [event({ farmId: F1, farmSource: 'address', endpoint: '/a-endpoint' }), event({ endpoint: '/b-endpoint' })];
    serve(() => health({ recentErrors: events }), { [F1]: 'Bhosale Mala', [F2]: 'Pawar Shet' });
    const queryClient = makeTestQueryClient();
    render(queryClient);
    await settled();

    const table = () => screen.getByRole('table', { name: 'Recent events' });
    const farmCellFor = (endpoint: string) =>
      cellsOf(bodyRows(table()).find((tr) => (tr.textContent ?? '').includes(endpoint))!)[5];

    await waitFor(() => expect(farmCellFor('/a-endpoint')).toContain('Bhosale Mala'), SETTLE);
    expect(farmCellFor('/b-endpoint')).toBe('Not named in the request');
    expect(stub!.contactCalls()).toHaveLength(1);
    expect(stub!.idsOf(stub!.contactCalls()[0])).toEqual([F1]);

    // A poll with the same ids: no new contacts request. A new id: one request, for that id only.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['ops', 'health'] });
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(stub!.contactCalls(), 'the 30-second poll opened the audited factory again').toHaveLength(1);

    events = [...events, event({ farmId: F2, farmSource: 'address', endpoint: '/c-endpoint' })];
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['ops', 'health'] });
    });
    await waitFor(() => expect(stub!.contactCalls()).toHaveLength(2), SETTLE);
    expect(stub!.idsOf(stub!.contactCalls()[1])).toEqual([F2]);
  });

  it('a farm in both lists is asked from the contacts route once, in one request', async () => {
    serve(
      () =>
        health({
          topSufferingFarms: [
            { farmId: F1, errorCount: 5, syncErrors: 2, logErrors: 1, voiceErrors: 1, otherErrors: 1, lastErrorAt: '2026-09-01T11:38:00Z' },
          ],
          recentErrors: [event({ farmId: F1, farmSource: 'address' }), event({ farmId: F2, farmSource: 'address' })],
        }),
      { [F1]: 'Bhosale Mala', [F2]: 'Pawar Shet' },
    );
    render();
    await settled();
    await waitFor(() => expect(document.body.textContent).toContain('Pawar Shet'), SETTLE);
    await new Promise((r) => setTimeout(r, 200));
    const calls = stub!.contactCalls();
    expect(calls, 'the two lists asked the contacts route separately').toHaveLength(1);
    expect(stub!.idsOf(calls[0])).toEqual([F1, F2]);
  });

  it('an empty recent-events answer says plainly there were no errors in the last 2 hours', async () => {
    serve(() => health({ recentErrors: [] }));
    render();
    await settled();
    const events = document.querySelector<HTMLElement>('[data-list="ops-live-events"]')!;
    expect(events.textContent).toContain('No errors in the last 2 hours');
    expect(events.textContent).not.toMatch(/a broken query and a genuinely quiet two hours/i);
    expect(document.body.textContent).not.toMatch(/answers? its own database failures? with an empty list/i);
    expect(screen.queryByRole('table', { name: 'Recent events' })).toBeNull();
  });

  it('a failed request says it could not load, and never says none', async () => {
    stub = installContactsStub(() => ({ status: 500, data: { message: 'boom' } }));
    render();
    await screen.findByText(/Couldn.t load Live Health/, undefined, SETTLE);
    expect(document.body.textContent).not.toMatch(/No errors in the last 2 hours/);
    expect(document.body.textContent).not.toMatch(/No farm has repeated problems/);
    expect(within(document.body).getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

describe('a missing count or time shows Not measured (C22 item 4)', () => {
  it('a 24-hour row with a missing count and time shows Not measured, never blank or 0', async () => {
    serve(
      () =>
        health({
          topSufferingFarms: [
            { farmId: F1, errorCount: 5, syncErrors: undefined, logErrors: null, voiceErrors: 1, otherErrors: 1, lastErrorAt: null } as never,
          ],
        }),
      { [F1]: 'Bhosale Mala' },
    );
    render();
    await settled();
    await waitFor(() => expect(document.body.textContent).toContain('Bhosale Mala'), SETTLE);
    const [row] = bodyRows(sufferingTable());
    const cells = cellsOf(row);
    // Farm, Problems, Syncing, Entries, Voice, Other, Last problem.
    expect(cells[1]).toBe('5');
    expect(cells[2]).toMatch(/not measured/i);
    expect(cells[3]).toMatch(/not measured/i);
    expect(cells[4]).toBe('1');
    expect(cells[6]).toMatch(/not measured/i);
    for (const i of [2, 3, 6]) {
      expect(cells[i]).not.toBe('');
      expect(cells[i]).not.toBe('0');
    }
  });
});
