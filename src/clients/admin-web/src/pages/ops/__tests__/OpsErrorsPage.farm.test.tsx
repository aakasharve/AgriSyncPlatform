import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub, SeenRequest } from '@/test/contactsStub';
import type { OpsErrorEvent } from '@/hooks/useOpsErrors';
import OpsErrorsPage from '../OpsErrorsPage';

/**
 * CR-2e Task 1 (page part) and C20: the Farm column on API Errors.
 *
 * A request that named a farm shows the farm's contact name; a request that did not (a sync upload names no farm
 * in its address) says "Not named in the request", never a blank. Names come from the contacts route, asked once
 * per new farm id, so the 30-second poll never opens the audited factory. An empty answer is a real "none" with
 * its window; a failed request is "could not load", never "none".
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const F1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const F2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const SETTLE = { timeout: 15_000 };
const META = { source: 'live', window: 'last 24h', lastRefreshedUtc: '2026-09-01T08:30:00.000Z', ttlSeconds: 30 };

function ev(over: Partial<OpsErrorEvent> = {}): OpsErrorEvent {
  return {
    eventType: 'api.error',
    endpoint: 'POST /shramsafal/sync/push',
    statusCode: 500,
    latencyMs: 40,
    farmId: null,
    farmSource: null,
    occurredAtUtc: '2026-09-01T08:15:30Z',
    ...over,
  };
}

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  localStorage.clear();
});

const contactCalls = () => stub?.contactCalls() ?? [];
const idsOf = (r: SeenRequest) => stub!.idsOf(r);

/** `getItems` is read on every call so a test can change what the next poll returns. */
function serve(getItems: () => OpsErrorEvent[], names: Record<string, string> = {}) {
  stub = installContactsStub(() => {
    const items = getItems();
    return { data: { items, totalCount: items.length, page: 1, pageSize: 50 }, meta: META };
  }, names);
}

function render(queryClient = makeTestQueryClient()) {
  return renderWithProviders(<OpsErrorsPage />, { route: `/ops/errors?org=${ORG}`, queryClient });
}

async function rows(): Promise<HTMLTableRowElement[]> {
  const table = await screen.findByRole('table', { name: 'API errors' }, SETTLE);
  await waitFor(() => expect(table.querySelectorAll('tbody > tr').length).toBeGreaterThan(0), SETTLE);
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter((tr) => !tr.id.includes('detail'));
}

/** The Farm cell is the last of the six columns. */
const farmCell = (tr: HTMLTableRowElement) => [...tr.querySelectorAll('td')][5];

describe('the Farm column (E3, real)', () => {
  it('An_error_with_no_farm_says_not_named', async () => {
    serve(() => [ev({ farmId: null, farmSource: null })]);
    render();
    const [row] = await rows();
    // Never blank, and never an id or a dash standing for "no farm".
    expect(farmCell(row).textContent).toBe('Not named in the request');
    // And with nothing to name, the page asks for no names at all.
    await new Promise((r) => setTimeout(r, 200));
    expect(contactCalls()).toHaveLength(0);
  });

  it('A_named_farm_shows_its_name', async () => {
    serve(() => [ev({ farmId: F1, farmSource: 'address' })], { [F1]: 'Bhosale Mala' });
    render();
    const [row] = await rows();
    await waitFor(() => expect(farmCell(row).textContent).toContain('Bhosale Mala'), SETTLE);
    expect(farmCell(row).textContent).not.toContain('Not named');
    const calls = contactCalls();
    expect(calls).toHaveLength(1);
    expect(idsOf(calls[0])).toEqual([F1]);
  });

  it('a named farm the server knows no name for shows its short id, never a blank', async () => {
    serve(() => [ev({ farmId: F1, farmSource: 'event' })], {});
    render();
    const [row] = await rows();
    await waitFor(() => expect(contactCalls()).toHaveLength(1), SETTLE);
    expect(farmCell(row).textContent).toContain(F1.slice(0, 8));
    expect(farmCell(row).textContent).not.toContain('Not named');
  });

  it('Farm_names_are_fetched_once_per_new_id', async () => {
    let items = [ev({ farmId: F1, farmSource: 'address' }), ev({ farmId: null })];
    serve(() => items, { [F1]: 'Bhosale Mala', [F2]: 'Pawar Shet' });
    const queryClient = makeTestQueryClient();
    render(queryClient);
    await rows();
    await waitFor(() => expect(contactCalls()).toHaveLength(1), SETTLE);

    // Two more polls with the same ids: no further contacts request.
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ['ops', 'errors'] });
      });
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(stub!.requests.filter((r) => r.path.includes('/admin/ops/errors')).length).toBeGreaterThanOrEqual(3);
    expect(contactCalls(), 'a poll that returned the same ids opened the audited factory again').toHaveLength(1);

    // A new id: one more request, for that id only.
    items = [ev({ farmId: F1, farmSource: 'address' }), ev({ farmId: F2, farmSource: 'address' })];
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['ops', 'errors'] });
    });
    await waitFor(() => expect(contactCalls()).toHaveLength(2), SETTLE);
    expect(idsOf(contactCalls()[1])).toEqual([F2]);
    await waitFor(() => expect(document.body.textContent).toContain('Pawar Shet'), SETTLE);
  });
});

describe('an empty answer is a real none; a failed request is not (C3, C20)', () => {
  it('an empty answer says plainly there are no errors in the window', async () => {
    serve(() => []);
    render();
    await screen.findByText('No errors in this window', undefined, SETTLE);
    expect(screen.queryByText('No call came back for this window')).toBeNull();
    expect(screen.queryByText(/ends in a bare catch/)).toBeNull();
    expect(screen.queryByRole('table', { name: 'API errors' })).toBeNull();
  });

  it('an empty answer takes its time from the server lastRefreshedUtc and is never called healthy', async () => {
    stub = installContactsStub(() => ({
      data: { items: [], totalCount: 0, page: 1, pageSize: 50 },
      meta: { source: 'live', window: 'last 24h', lastRefreshedUtc: '2026-09-03T12:30:00.000Z', ttlSeconds: 30 },
    }));
    render();
    await screen.findByText('No errors in this window', undefined, SETTLE);
    expect(
      screen.queryByText(/The system is healthy/),
      'an empty answer was reported as a healthy system',
    ).toBeNull();
    expect(
      screen.queryByText(/a time the server did not report/),
      'the screen reported having no timestamp while the server had sent lastRefreshedUtc',
    ).toBeNull();
    expect(screen.getByText(/checked at 2026-09-03 /)).toBeInTheDocument();
  });

  it('an empty answer with no server time says so, and never invents the time now', async () => {
    stub = installContactsStub(() => ({
      data: { items: [], totalCount: 0, page: 1, pageSize: 50 },
      meta: { source: 'live', window: 'last 24h', ttlSeconds: 30 },
    }));
    render();
    await screen.findByText('No errors in this window', undefined, SETTLE);
    expect(screen.queryByText(/The system is healthy/)).toBeNull();
    expect(screen.getByText(/checked at a time the server did not report/)).toBeInTheDocument();
  });

  it('a failed request says it could not load, and never says none', async () => {
    stub = installContactsStub(() => ({ status: 500, data: {} }));
    render();
    const list = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-list="ops-errors"]');
      expect(el).not.toBeNull();
      expect(within(el!).getByRole('alert')).toHaveAttribute('data-state', 'load-failed');
      return el!;
    }, SETTLE);
    expect(list.textContent).not.toMatch(/No errors in/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('the page text no longer says the server hides a failed read behind an empty list', async () => {
    serve(() => [ev()]);
    render();
    await rows();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/answers? a database failure with an empty list/i);
    expect(text).not.toMatch(/bare catch/i);
  });
});
