import axios from 'axios';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { describeAdminDenial } from '@/lib/adminErrors';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * COMPANY MIS — WHAT `GET /shramsafal/admin/mis/company` RETURNS.
 *
 * The shape is the server's `CompanyMisDto` (CR-2a, `CompanyMisDto.cs`, with
 * its amendments A9 to A12, and the CR-2c additions), camelCase. Every number
 * is a `MisValue`: a value, or `null` with the server's reason code. `null` is
 * never a zero and the pages never print it as one.
 *
 * Every `*Pct` field is ALREADY a percentage (42.5 means 42.5%). Format it
 * with `fmtPctPoints`, never with a ratio formatter.
 *
 * ── One request per range ─────────────────────────────────────────────────
 * Every load counts the whole company again and writes an audit row on the
 * server. So the answer is fetched once per (organisation, from, to) and kept:
 * no polling, no refetch on focus or reconnect, no retry. All seven pages read
 * the same cache entry.
 */

export const COMPANY_MIS_PATH = '/shramsafal/admin/mis/company';

export type MisReasonCode =
  | 'denominator_zero'
  | 'no_complete_window'
  | 'farm_list_unreadable'
  | 'no_samples'
  | 'not_recorded'
  | 'too_many_farms_for_live_count';

/** `notMeasuredReason` is typed as a string so an unknown code fails closed. */
export interface MisValue {
  value: number | null;
  notMeasuredReason: string | null;
}

export interface MisNumber {
  current: MisValue;
  previous: MisValue;
  /** One entry per day of `range`, day `from` first; null entry = not measured that day.
   *  Null list = this number has no day-by-day form (or farm numbers are blocked). */
  currentByDay?: (number | null)[] | null;
  /** One entry per day of `previousRange`; same rules. */
  previousByDay?: (number | null)[] | null;
}

/** yyyy-MM-dd, India days. */
export interface MisRange {
  from: string;
  to: string;
  days: number;
}

export interface MisDayPoint {
  day: string;
  value: number;
}

export interface MisWeekSplit {
  weekStart: string;
  voice: number;
  typed: number;
  isPartial: boolean;
}

/** weekday 1 = Monday .. 7 = Sunday; hour 0..23 India time. */
export interface MisHeatCell {
  weekday: number;
  hour: number;
  logs: number;
}

/** `role` is the server's role name, or "Unknown". */
export interface MisRoleCount {
  role: string;
  people: number;
}

export interface MisCohortRow {
  weekStart: string;
  people: number;
  /** Four entries: weeks 1..4; null = week not complete or no people. */
  activePctByWeek: (number | null)[];
  /** Four entries: day 1, 7, 14, 30 after day 0; null = nobody eligible yet. */
  activePctOnDays: (number | null)[];
}

export interface MisCurvePoint {
  day: number;
  activePct: number | null;
  eligible: number;
}

export interface MisFpoRow {
  organizationName: string;
  farms: number;
}

export interface MisAcresPoint {
  day: string;
  acres: number;
}

/**
 * CR-2c: a served list. `notMeasuredReason` set = the list was not counted
 * (its items are then not shown); null with no items = counted, and none.
 */
export interface MisList<T> {
  items: T[];
  notMeasuredReason: string | null;
}

/** Farm-days that got this understanding score (0..10) in the period. */
export interface MisScoreBucket {
  score: number;
  farmDays: number;
}

/** `platform` is the server's word ("android" = the Android app); `sharePct` is already a percentage. */
export interface MisVersionShare {
  version: string;
  platform: string;
  people: number;
  sharePct: number;
}

/** `people` and `sharePct` are null when the feature is not measured, with the reason code. */
export interface MisFeatureUse {
  feature: string;
  people: number | null;
  sharePct: number | null;
  notMeasuredReason: string | null;
}

/** `role` is the server's role name, as in `MisRoleCount`. */
export interface MisFeatureRole {
  feature: string;
  role: string;
  people: number;
}

export interface MisKindCount {
  kind: string;
  entries: number;
}

export interface MisCropRow {
  cropName: string;
  farms: number;
  acres: number;
}

export interface CompanyMis {
  countedAtUtc: string;
  timeZone: string;
  range: MisRange;
  previousRange: MisRange;
  excludedTestAccounts: number;
  farmsListed: number;
  farmsNotReadable: number;
  overview: {
    activeFarms: MisNumber;
    signUps: MisNumber;
    dau: MisNumber;
    wau: MisNumber;
    mau: MisNumber;
    stickinessPct: MisNumber;
    logsRecorded: MisNumber;
    voiceLogs: MisNumber;
    voiceSharePct: MisNumber;
    /** CR-2c: median understanding score of scored farm-days, out of 10. */
    understandingMedian: MisNumber;
    understandingScoredDays: MisNumber;
    signUpsByDay: MisDayPoint[];
    activePeopleByDay: MisDayPoint[];
    logsByWeek: MisWeekSplit[];
  };
  acquisition: {
    verified: MisNumber;
    hasFarm: MisNumber;
    firstLog: MisNumber;
    habit: MisNumber;
    habitEligible: MisNumber;
  };
  engagement: {
    logsPerActiveFarmPerWeek: MisNumber;
    whenLogged: MisHeatCell[];
    whenLoggedClock: string;
    roleMixOfMau: MisRoleCount[];
    featureUse: MisList<MisFeatureUse>;
    featureUseByRole: MisList<MisFeatureRole>;
    logsByKind: MisList<MisKindCount>;
  };
  retention: {
    d1Pct: MisNumber;
    d30Pct: MisNumber;
    activeFarms0To6: MisNumber;
    quietFarms7To29: MisNumber;
    quietFarms7To13: MisNumber;
    quietFarms14To29: MisNumber;
    silentFarms30Plus: MisNumber;
    neverLoggedFarms: MisNumber;
    cohortByWeek: MisCohortRow[];
    curve: MisCurvePoint[];
    winBackByDay: MisDayPoint[];
    previousCurve: MisCurvePoint[];
  };
  quality: {
    voiceRecordings: MisNumber;
    voiceRecordingsSavedPct: MisNumber;
    transcriptionAvgMs: MisNumber;
    transcriptionP95Ms: MisNumber;
    logsCorrected: MisNumber;
    logsCorrectedPct: MisNumber;
    understandingSpread: MisList<MisScoreBucket>;
    /** Refused attempts (one change can be refused many times) and accepted changes; every upload. */
    syncRefusedChanges: MisNumber;
    syncAcceptedChanges: MisNumber;
    syncRefusedPct: MisNumber;
    appVersions: MisList<MisVersionShare>;
    /** yyyy-MM-dd India day of the first app-seen record; null = none yet. */
    appVersionsSeenSince: string | null;
  };
  farms: {
    activeFarms: MisNumber;
    farmsRegistered: MisNumber;
    acresCovered: MisNumber;
    farmsInFpo: MisNumber;
    farmsPerFpo: MisFpoRow[];
    acresByWeek: MisAcresPoint[];
    activeFarmsInFpoPct: MisNumber;
    cropsOnActiveFarms: MisList<MisCropRow>;
  };
}

/** The React Query options of this one request. Exported so the shape is stated once. */
export const COMPANY_MIS_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: 1_800_000,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: 0,
} as const;

export function useCompanyMis(period: { from: string; to: string }): UseQueryResult<AdminResponse<CompanyMis>> {
  const org = useOrgKey();
  const { from, to } = period;
  return useQuery<AdminResponse<CompanyMis>>({
    queryKey: ['mis', 'company', org, from, to],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<CompanyMis>>(
        `${COMPANY_MIS_PATH}?from=${from}&to=${to}`,
      );
      return data;
    },
    ...COMPANY_MIS_QUERY_OPTIONS,
  });
}

export type MisLoadProblem =
  | { kind: 'denied'; message: string; remedy: string }
  | { kind: 'badRange'; message: string }
  | { kind: 'failed'; message: string };

export const MIS_BAD_RANGE_MESSAGE =
  'That date range cannot be counted. Pick an end date no later than today and at most 180 days.';
export const MIS_FAILED_MESSAGE =
  'The numbers could not be counted just now. Nothing on this page is a zero.';

/**
 * What went wrong, in words. A 401 never reaches here as a page state: the
 * console's interceptor clears the session and opens the sign-in screen.
 */
export function classifyMisError(error: unknown): MisLoadProblem {
  const denial = describeAdminDenial(error);
  if (denial) return { kind: 'denied', message: denial.message, remedy: denial.remedy };
  if (axios.isAxiosError(error) && error.response?.status === 400) {
    return { kind: 'badRange', message: MIS_BAD_RANGE_MESSAGE };
  }
  return { kind: 'failed', message: MIS_FAILED_MESSAGE };
}
