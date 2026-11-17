import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ActiveOrgProvider } from '@/app/ActiveOrgProvider';
import { makeTestQueryClient } from '@/test/renderWithProviders';
import { installContactsStub } from '@/test/contactsStub';
import type { ContactsStub } from '@/test/contactsStub';
import { useFarmContacts } from '@/hooks/useFarmContacts';
import { useNavBadges } from '@/app/navBadges';

/**
 * CR-2e C9 and C8.
 *
 * C9: the contacts hook opens the audited factory once per request, so it asks only for ids it has not asked
 * about, never polls, and keeps within the route's 200-id limit.
 * C8: the nav badge slot stays empty and makes no request (a badge would call the silent-farms read on every screen).
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

let stub: ContactsStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeTestQueryClient()}>
      <MemoryRouter initialEntries={[`/?org=${ORG}`]}>
        <ActiveOrgProvider>{children}</ActiveOrgProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useFarmContacts (C9)', () => {
  it('asks once for new ids, not again for known ones, and returns names keyed by id', async () => {
    stub = installContactsStub(() => ({}), { [id(1)]: 'One', [id(2)]: 'Two' });
    const { result, rerender } = renderHook(({ ids }) => useFarmContacts(ids), {
      wrapper,
      initialProps: { ids: [id(1)] },
    });
    await waitFor(() => expect(result.current.get(id(1))?.name).toBe('One'));
    expect(stub.contactCalls()).toHaveLength(1);

    // Same ids again (a poll that returned the same farms), in a new array: no request.
    rerender({ ids: [id(1)] });
    rerender({ ids: [id(1), id(1)] });
    await new Promise((r) => setTimeout(r, 100));
    expect(stub.contactCalls()).toHaveLength(1);

    // One new id: one more request for that id only.
    rerender({ ids: [id(1), id(2)] });
    await waitFor(() => expect(result.current.get(id(2))?.name).toBe('Two'));
    expect(stub.contactCalls()).toHaveLength(2);
    expect(stub.idsOf(stub.contactCalls()[1])).toEqual([id(2)]);
    expect(result.current.get(id(2))?.ownerPhone).toBe('9876543210');
  });

  it('asks for nothing when there are no ids', async () => {
    stub = installContactsStub(() => ({}));
    renderHook(() => useFarmContacts([]), { wrapper });
    await new Promise((r) => setTimeout(r, 100));
    expect(stub.contactCalls()).toHaveLength(0);
  });

  it('never polls: a minute of fake time makes no further request and schedules no repeating timer', async () => {
    stub = installContactsStub(() => ({}), { [id(1)]: 'One' });
    // Fake timers and the spies are in place BEFORE mount, so a timer made while mounting is seen too.
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { result } = renderHook(() => useFarmContacts([id(1)]), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current.size).toBe(1);
      expect(stub.contactCalls()).toHaveLength(1);

      // Well past a 30-second refetch, twice over.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(stub.contactCalls(), 'time passing made another contacts request: the hook polls').toHaveLength(1);

      expect(intervalSpy, 'the hook set an interval').not.toHaveBeenCalled();
      const longTimeouts = timeoutSpy.mock.calls.filter((c) => Number(c[1]) >= 1000);
      expect(longTimeouts, 'the hook scheduled a timer of a second or more').toHaveLength(0);
    } finally {
      intervalSpy.mockRestore();
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('sends at most 200 ids in one request', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => id(i + 1));
    stub = installContactsStub(() => ({}));
    renderHook(() => useFarmContacts(ids), { wrapper });
    await waitFor(() => expect(stub!.contactCalls().length).toBeGreaterThanOrEqual(2));
    const sizes = stub.contactCalls().map((r) => stub!.idsOf(r).length);
    for (const n of sizes) expect(n).toBeLessThanOrEqual(200);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(201);
  });

  it('an id the server leaves out stays absent from the map, never present with a blank name', async () => {
    stub = installContactsStub(() => ({}), {});
    const { result } = renderHook(() => useFarmContacts([id(9)]), { wrapper });
    await waitFor(() => expect(stub!.contactCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.has(id(9))).toBe(false);
  });
});

describe('the nav badges stay empty (C8)', () => {
  it('returns no badge and makes no request', async () => {
    stub = installContactsStub(() => ({}));
    const { result } = renderHook(() => useNavBadges(), { wrapper });
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current).toEqual({});
    expect(stub.requests).toHaveLength(0);
  });
});
