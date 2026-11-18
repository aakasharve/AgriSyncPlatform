/**
 * R9 AND R10 — THE TWO RULES LIVE HEALTH SHOWS, DECLARED ONCE.
 *
 * Both are counted live by the server: R9 comes on the health answer
 * (`alertR9`), R10 from its own voice-check route (see `useOpsVoiceCheck`).
 * This file holds their names and rule wording, and the words built from an
 * answer. Home does not read either rule.
 *
 * R1-R8 are not read by this console; Live Health says so in its feeds list
 * and never reports them as clear.
 *
 * Pure data and pure functions: no React, no axios, no component.
 */

export interface AlertRuleDefinition {
  id: 'R9' | 'R10';
  name: string;
  /** The rule in the words of the SQL that defines it. Not the prototype's. */
  rule: string;
}

/**
 * R9 — `20260502000000_AnalyticsRewrite.cs:424`. `COUNT(*) > 30` over
 * `event_type = 'api.error'` in the trailing hour.
 */
export const R9: AlertRuleDefinition = {
  id: 'R9',
  name: 'API error spike',
  rule: 'more than 30 API errors in 1 hour',
};

/**
 * R10 — `20260502000000_AnalyticsRewrite.cs:441`.
 * `failures * 100.0 / NULLIF(COUNT(*),0) > 20` over the trailing SIX HOURS.
 *
 * The window is six hours; any other window's failure rate is a different
 * reading and must not be shown as this rule's verdict.
 */
export const R10: AlertRuleDefinition = {
  id: 'R10',
  name: 'Voice degraded',
  rule: 'voice failure rate above 20% in 6 hours',
};

/* ── C29: THE TWO CHECKS AS THE SERVER NOW ANSWERS THEM ───────────────────
 * R9 comes on the health answer (`alertR9`), R10 from the voice-check route.
 * Both carry a counted figure and the window they were counted over, so the
 * words below are built from the answer and never from a constant. */

export type CheckState = 'breach' | 'clear' | 'not_judged';
export type VoiceCheckReason =
  | 'too_few_recordings'
  | 'too_many_farms_for_live_count'
  | 'farm_list_unreadable';

export interface AlertCheck {
  rule: string;
  state: CheckState;
  counted: number | null;
  outOf: number | null;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  reason: VoiceCheckReason | null;
}

export const CHECK_WORD: Record<CheckState, string> = {
  breach: 'Problem',
  clear: 'Clear',
  not_judged: 'Not judged',
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** R9: "31 errors in the last hour". Null when the server sent no count. */
export function r9Figure(c: AlertCheck): string | null {
  if (c.counted === null || c.counted === undefined) return null;
  return `${c.counted.toLocaleString('en-IN')} ${plural(c.counted, 'error', 'errors')} in the last hour`;
}

/** R10: "3 of 10 recordings failed", or "2 recordings finished, too few to judge". */
export function r10Figure(c: AlertCheck): string | null {
  if (c.reason === 'too_few_recordings' && c.outOf !== null && c.outOf !== undefined) {
    return `${c.outOf.toLocaleString('en-IN')} ${plural(c.outOf, 'recording', 'recordings')} finished, too few to judge`;
  }
  if (c.counted === null || c.counted === undefined || c.outOf === null || c.outOf === undefined) {
    return null;
  }
  return `${c.counted.toLocaleString('en-IN')} of ${c.outOf.toLocaleString('en-IN')} recordings failed`;
}

export function reasonWords(reason: VoiceCheckReason | null): string | null {
  switch (reason) {
    case 'too_few_recordings':
      return 'Too few recordings finished in this window to judge a failure rate.';
    case 'too_many_farms_for_live_count':
      return 'Too many farms for a live count, so no verdict was drawn.';
    case 'farm_list_unreadable':
      return 'The list of farms could not be read, so no verdict was drawn.';
    default:
      return null;
  }
}

const INDIA_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** The window in India time: "18 Nov, 09:00 to 10:00 India time". Null if either end is unreadable. */
export function windowInIndiaTime(startUtc: string | null, endUtc: string | null): string | null {
  if (!startUtc || !endUtc) return null;
  const a = new Date(startUtc);
  const b = new Date(endUtc);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return `${INDIA_PARTS.format(a)} to ${INDIA_PARTS.format(b)} India time`;
}
