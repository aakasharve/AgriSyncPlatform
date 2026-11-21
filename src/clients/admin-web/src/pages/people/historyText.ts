import type { HistoryLine } from '@/hooks/useControlRoomPeople';
import { roleLabel, tickLabel } from '@/lib/controlRoomTicks';

/**
 * ONE SENTENCE PER HISTORY LINE (CR-3, Task A7).
 *
 * History is written by the server (A2) and never edited. This turns a line into plain English for
 * the History page. It shows names and the LAST FOUR digits of a number the door turned away, and
 * never anything else about a number: the server keeps no more than that. A line whose action this
 * console does not know is still shown, as a neutral sentence, so a newer server cannot hide a row.
 */

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length === 0) return 'no parts';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The server may send a list as "a,b" or as "a, b"; each key is turned into its plain label. */
function ticksIn(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map(tickLabel);
}

function tail(line: HistoryLine): string {
  const t = line.details.phoneTail;
  return t ? `the number ending ${t}` : 'a number';
}

/** Why a code was not sent, in words. The server's reason is a code or a type name, never shown raw. */
export function notSentReason(reason: string | null | undefined): string {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('rate_limited') || r.includes('too_many')) return 'too many codes had been asked for';
  if (r === 'queue_full') return 'the sending queue was full';
  if (r === 'server_stopping') return 'the server was stopping';
  if (r.startsWith('msg91') || r.includes('provider') || r.includes('sms')) return 'the SMS service did not accept it';
  return 'the server hit a fault';
}

/** Why the door turned a number away. Only reasons that can be said without naming anyone. */
function refusedReason(reason: string | null | undefined): string {
  switch ((reason ?? '').toLowerCase()) {
    case 'account_changed':
      return ' The number now belongs to a different account.';
    default:
      return '';
  }
}

export function historyText(line: HistoryLine): string {
  const actor = line.actorName || 'Someone';
  const subject = line.subjectName || 'a person';
  const d = line.details ?? {};

  switch (line.action) {
    case 'person_added': {
      const parts = ticksIn(d.ticks);
      const given = parts.length > 0 ? ` access to ${listOf(parts)}` : ' access';
      return `${actor} gave ${subject}${given}`;
    }
    case 'person_changed': {
      const added = ticksIn(d.added);
      const removed = ticksIn(d.removed);
      const bits: string[] = [];
      if (d.role) bits.push(`made them ${roleLabel(d.role)}`);
      if (added.length > 0) bits.push(`added ${listOf(added)}`);
      if (removed.length > 0) bits.push(`took away ${listOf(removed)}`);
      return bits.length > 0
        ? `${actor} changed ${subject}: ${bits.join('; ')}`
        : `${actor} changed ${subject}`;
    }
    case 'person_removed':
      return `${actor} removed ${subject}. They can no longer sign in.`;
    case 'person_kept':
      return `${actor} kept ${subject}, who has not signed in for a while.`;
    case 'seat_bound':
      return `${subject}'s approved number was linked to their account.`;
    case 'door_refused': {
      const checking = d.step === 'check';
      const asked = checking ? 'tried a code' : 'asked for a code';
      const sms = checking ? '' : ' No SMS sent.';
      return `A number ending ${d.phoneTail ?? '----'} ${asked}. Not approved.${sms}${refusedReason(d.reason)}`;
    }
    case 'code_not_sent':
      return `A code for ${tail(line)} could not be sent: ${notSentReason(d.reason)}`;
    case 'signed_in':
      return d.heldForQuestion === 'true'
        ? `${actor} entered a correct code on a new phone; the sign-in waited for the new-phone question.`
        : `${actor} signed in.`;
    case 'phones_shown':
      if (d.page === 'users') {
        /* W-11: a missing or unreadable count is never "0 people". Number(null) and Number('') are 0,
           so absence is checked before the number is read. */
        const raw = d.personCount;
        const n = raw === null || raw === undefined || String(raw).trim() === '' ? Number.NaN : Number(raw);
        if (!Number.isFinite(n)) return `${actor} looked at some people's phone numbers on the Users page.`;
        const people = n === 1 ? '1 person' : `${n} people`;
        return `${actor} looked at the phone numbers of ${people} on the Users page.`;
      }
      return d.farms
        ? `${actor} looked at farmers' phone numbers for: ${d.farms}`
        : `${actor} looked at farmers' phone numbers.`;
    case 'visits_given':
      return `${actor} gave field visits${line.subjectName ? ` to ${line.subjectName}` : ''}.`;
    case 'visit_done':
      return `${actor} marked a field visit done.`;
    case 'day_sheet_downloaded':
      return `${actor} downloaded the day sheet.`;
    case 'day_sheet_printed':
      return `${actor} printed the day sheet.`;
    default:
      return `${actor}: ${line.action.replace(/_/g, ' ')}`;
  }
}

/** The actions the History page can filter by, with plain names. */
export const HISTORY_ACTIONS: ReadonlyArray<{ action: string; label: string }> = [
  { action: 'person_added', label: 'People added' },
  { action: 'person_changed', label: 'Access changed' },
  { action: 'person_removed', label: 'People removed' },
  { action: 'person_kept', label: 'People kept' },
  { action: 'signed_in', label: 'Sign-ins' },
  { action: 'door_refused', label: 'Numbers turned away' },
  { action: 'code_not_sent', label: 'Codes not sent' },
  { action: 'phones_shown', label: 'Phone numbers looked at' },
];
