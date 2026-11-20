import { describe, expect, it } from 'vitest';
import { readHistory } from '../useControlRoomPeople';
import { readControlRoom, type MeScopeResponse } from '../useAdminScope';

/** spec: trusted-control-room-2026-11-20 (CR-3 Task A7). The two shapes the server lane pins. */
describe('readHistory: { lines, hitLimit, limit } and nothing else', () => {
  it('reads the pinned answer', () => {
    const line = { atUtc: 'x', action: 'signed_in', actorName: 'A', subjectName: null, details: {} };
    expect(readHistory({ lines: [line], hitLimit: true, limit: 500 })).toEqual({ lines: [line], hitLimit: true, limit: 500 });
  });
  it('refuses a bare list and an `items` wrapper as a failed load', () => {
    expect(() => readHistory([])).toThrow();
    expect(() => readHistory({ items: [], hitLimit: false, limit: 1 })).toThrow();
    expect(() => readHistory(null)).toThrow();
  });
});

describe('readControlRoom: the top level of the scope answer only', () => {
  const cr = { isFounder: false, startingRole: 'viewer', ticks: ['company_numbers'], doorSessionRequired: false };
  it('reads controlRoom beside outcome and scope', () => {
    expect(readControlRoom({ outcome: 'Resolved', scope: null, memberships: [], controlRoom: cr })).toEqual(cr);
  });
  it('does not look inside scope', () => {
    const data = { outcome: 'Resolved', scope: { controlRoom: cr }, memberships: [] } as unknown as MeScopeResponse;
    expect(readControlRoom(data)).toBeNull();
    expect(readControlRoom(undefined)).toBeNull();
  });
});
