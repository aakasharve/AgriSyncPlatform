import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { peopleErrorText, readHistory } from '../useControlRoomPeople';
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

describe('peopleErrorText: plain words for four more server codes (G1 fix 1: F1, M10)', () => {
  const refusal = (code: string) =>
    new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
      data: { code },
    });

  it.each([
    ['control_room.name_invalid', 'Type a name between 1 and 80 letters.'],
    ['control_room.person_not_found', 'This person is no longer on the list. Refresh the page.'],
    ['control_room.history_range_invalid', 'Pick a range of 7 to 90 days.'],
    ['control_room.history_action_unknown', 'That kind of History line is not known. Show all lines instead.'],
  ])('%s', (code, words) => {
    expect(peopleErrorText(refusal(code))).toBe(words);
  });
});
