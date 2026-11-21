import { fmtIndiaDateTime } from '@/lib/indiaTime';

/**
 * ANALYTICS NOT RECORDING (CR-3 fix wave W-1, server S-N9).
 *
 * When the server finds that app events have stopped being written (a month's table is missing, or
 * entries keep arriving with no matching events), every number built from those events is wrong in
 * a way no query can show: a count of zero, an empty list, a date that stopped moving. The server
 * then says so with `analyticsNotMeasuredReason` (and `analyticsStoppedAtUtc` when it knows when).
 * It sits in `meta` on enveloped answers and at the top level on `/ops/health` and the drilldown.
 *
 * A screen that reads the flag shows "not measured" with one sentence for every analytics-backed
 * number, and never 0, an empty table, "no errors" or a date. A reason this console does not know
 * is still not measured (it falls closed), with the generic sentence.
 */
export const ANALYTICS_NOT_RECORDING = 'analytics_not_recording';

export interface AnalyticsFlag {
  /** The server's reason code, unmodified. */
  reason: string;
  /** When recording stopped, ISO-8601, or null when the server does not know. */
  stoppedAtUtc: string | null;
}

interface FlagCarrier {
  analyticsNotMeasuredReason?: string | null;
  analyticsStoppedAtUtc?: string | null;
}

function flagOf(carrier: FlagCarrier | null | undefined): AnalyticsFlag | null {
  const reason = carrier?.analyticsNotMeasuredReason;
  if (typeof reason !== 'string' || reason.trim() === '') return null;
  const at = carrier?.analyticsStoppedAtUtc;
  return { reason, stoppedAtUtc: typeof at === 'string' && at ? at : null };
}

/** The flag on an enveloped answer (`/ops/errors`, `/farms/suffering`, `/farms`, `/ops/app-versions`, `/mis/company`). */
export function analyticsFlagFromMeta(meta: FlagCarrier | null | undefined): AnalyticsFlag | null {
  return flagOf(meta);
}

/** The flag on an answer that has no envelope (`/ops/health`, `/admin/farmer-health/{farmId}`). */
export function analyticsFlagFromTop(answer: FlagCarrier | null | undefined): AnalyticsFlag | null {
  return flagOf(answer);
}

/** The one sentence a screen prints where an analytics-backed number would be. */
export function analyticsNotMeasuredSentence(flag: AnalyticsFlag): string {
  if (flag.reason !== ANALYTICS_NOT_RECORDING) return 'Not measured.';
  const since = fmtIndiaDateTime(flag.stoppedAtUtc);
  return `Not measured: the server stopped recording app events${since ? ` since ${since}` : ''}.`;
}
