import { describe, expect, it } from 'vitest';
import type { HistoryLine } from '@/hooks/useControlRoomPeople';
import { HISTORY_ACTIONS, historyText, notSentReason } from '../historyText';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7). One sentence per History action. Expected
 * sentences are written out from the plan's examples; names are "Example: ..." and numbers are
 * the last four digits only, as the server writes them.
 */

function line(action: string, over: Partial<HistoryLine> = {}): HistoryLine {
  return {
    atUtc: '2026-11-20T10:00:00Z',
    action,
    actorName: 'Akash',
    subjectName: null,
    details: {},
    ...over,
  };
}

describe('historyText: one sentence per action', () => {
  it('person_added names the person and the parts given', () => {
    expect(
      historyText(
        line('person_added', {
          subjectName: 'Example: field team',
          details: { ticks: 'farms_to_call,farmer_health', role: 'field_operator' },
        }),
      ),
    ).toBe('Akash gave Example: field team access to Farms that need a call and Farmer health');
  });

  it('person_added reads only `ticks`, never `added`', () => {
    expect(historyText(line('person_added', { subjectName: 'Example: A', details: { added: 'users' } }))).toBe(
      'Akash gave Example: A access',
    );
  });

  it('person_added with three parts reads as a list, and with none still reads', () => {
    expect(
      historyText(line('person_added', { subjectName: 'Example: A', details: { ticks: 'company_numbers, server_health, users' } })),
    ).toBe('Akash gave Example: A access to Company numbers, Server health and Users');
    expect(historyText(line('person_added', { subjectName: 'Example: A' }))).toBe('Akash gave Example: A access');
  });

  it('person_changed says what was added, taken away and the new role', () => {
    expect(
      historyText(
        line('person_changed', {
          subjectName: 'Example: A',
          details: { added: 'users', removed: 'api_errors,schedules', role: 'viewer' },
        }),
      ),
    ).toBe('Akash changed Example: A: made them Viewer; added Users; took away API errors and Schedules');
    expect(historyText(line('person_changed', { subjectName: 'Example: A' }))).toBe('Akash changed Example: A');
  });

  it('person_removed', () => {
    expect(historyText(line('person_removed', { subjectName: 'Example: A' }))).toBe(
      'Akash removed Example: A. They can no longer sign in.',
    );
  });

  it('person_kept', () => {
    expect(historyText(line('person_kept', { subjectName: 'Example: A' }))).toBe(
      'Akash kept Example: A, who has not signed in for a while.',
    );
  });

  it('seat_bound', () => {
    expect(historyText(line('seat_bound', { subjectName: 'Example: A' }))).toBe(
      "Example: A's approved number was linked to their account.",
    );
  });

  it('door_refused at the send step: a number turned away, no SMS sent', () => {
    expect(
      historyText(line('door_refused', { actorName: 'The door', details: { step: 'send', phoneTail: '4321', reason: 'not_listed' } })),
    ).toBe('A number ending 4321 asked for a code. Not approved. No SMS sent.');
  });

  it('door_refused at the check step', () => {
    expect(
      historyText(line('door_refused', { details: { step: 'check', phoneTail: '4321', reason: 'not_listed' } })),
    ).toBe('A number ending 4321 tried a code. Not approved.');
  });

  it('door_refused after the number moved to another account says so, with no more of the number', () => {
    const text = historyText(
      line('door_refused', { details: { step: 'check', phoneTail: '4321', reason: 'account_changed' } }),
    );
    expect(text).toBe('A number ending 4321 tried a code. Not approved. The number now belongs to a different account.');
    expect(text).not.toMatch(/\d{5,}/);
  });

  it('code_not_sent (AM2) says why in plain words, never the raw reason', () => {
    expect(historyText(line('code_not_sent', { details: { phoneTail: '4321', reason: 'otp.rate_limited' } }))).toBe(
      'A code for the number ending 4321 could not be sent: too many codes had been asked for',
    );
    expect(historyText(line('code_not_sent', { details: { phoneTail: '4321', reason: 'queue_full' } }))).toBe(
      'A code for the number ending 4321 could not be sent: the sending queue was full',
    );
    expect(historyText(line('code_not_sent', { details: { phoneTail: '4321', reason: 'server_stopping' } }))).toBe(
      'A code for the number ending 4321 could not be sent: the server was stopping',
    );
    expect(historyText(line('code_not_sent', { details: { phoneTail: '4321', reason: 'msg91.send_failed' } }))).toBe(
      'A code for the number ending 4321 could not be sent: the SMS service did not accept it',
    );
    expect(historyText(line('code_not_sent', { details: { phoneTail: '4321', reason: 'NullReferenceException' } }))).toBe(
      'A code for the number ending 4321 could not be sent: the server hit a fault',
    );
    expect(notSentReason(null)).toBe('the server hit a fault');
  });

  it('signed_in, phones_shown, visits and day sheets', () => {
    expect(historyText(line('signed_in', { actorName: 'Example: A' }))).toBe('Example: A signed in.');
    expect(
      historyText(
        line('phones_shown', {
          actorName: 'Example: A',
          details: { farmCount: '12', farms: 'Farm 1, Farm 2 and 10 more' },
        }),
      ),
    ).toBe("Example: A looked at farmers' phone numbers for: Farm 1, Farm 2 and 10 more");
    expect(historyText(line('visits_given', { actorName: 'Example: A', subjectName: 'Example: B' }))).toBe(
      'Example: A gave field visits to Example: B.',
    );
    expect(historyText(line('visit_done', { actorName: 'Example: B' }))).toBe('Example: B marked a field visit done.');
    expect(historyText(line('day_sheet_downloaded', { actorName: 'Example: B' }))).toBe(
      'Example: B downloaded the day sheet.',
    );
    expect(historyText(line('day_sheet_printed', { actorName: 'Example: B' }))).toBe(
      'Example: B printed the day sheet.',
    );
  });

  it('an action this console does not know is still shown, never hidden', () => {
    expect(historyText(line('something_new', { actorName: 'Example: A' }))).toBe('Example: A: something new');
  });

  it('every filterable action has a plain name', () => {
    for (const a of HISTORY_ACTIONS) expect(a.label.length).toBeGreaterThan(3);
    expect(HISTORY_ACTIONS.map((a) => a.action)).toContain('phones_shown');
    expect(HISTORY_ACTIONS.map((a) => a.action)).toContain('door_refused');
  });
});

describe('historyText: a held sign-in and Users-page phone looks (G1 fix 1: M2, F2)', () => {
  it('a sign-in held for the new-phone question says so', () => {
    expect(historyText(line('signed_in', { details: { heldForQuestion: 'true' } }))).toBe(
      'Akash entered a correct code on a new phone; the sign-in waited for the new-phone question.',
    );
    expect(historyText(line('signed_in', { details: { heldForQuestion: 'false' } }))).toBe('Akash signed in.');
    expect(historyText(line('signed_in'))).toBe('Akash signed in.');
  });

  it('a Users-page phone look counts people, 1 person and 3 people', () => {
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: '1' } }))).toBe(
      'Akash looked at the phone numbers of 1 person on the Users page.',
    );
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: '3' } }))).toBe(
      'Akash looked at the phone numbers of 3 people on the Users page.',
    );
  });

  it('W-11: a Users-page look with no usable person count never says 0 people', () => {
    const some = "Akash looked at some people's phone numbers on the Users page.";
    expect(historyText(line('phones_shown', { details: { page: 'users' } }))).toBe(some);
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: null } }))).toBe(some);
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: '' } }))).toBe(some);
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: 'many' } }))).toBe(some);
    expect(historyText(line('phones_shown', { details: { page: 'users', personCount: '0' } }))).toBe(
      'Akash looked at the phone numbers of 0 people on the Users page.',
    );
  });
});
