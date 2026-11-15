import type { CompanyMis, MisNumber, MisDayPoint } from '@/hooks/useCompanyMis';

/**
 * A COMPLETE company MIS answer, made up for tests (CR-2b, test-writer).
 *
 * Every scalar field carries a DISTINCT value, so a page that prints the wrong
 * field is caught: no two fields share a current or previous value. The values
 * stay away from 1..31 (day-of-month labels), 2026 (the year) and 0..23
 * (hour labels), so a digit on a page can be traced to exactly one source.
 *
 * Day lists follow CR-2a A9:
 *   - as-of-a-day numbers: one entry per day, ending on the headline value;
 *   - during-a-day counts: one entry per day, adding up to the range count;
 *   - numbers with no daily form: both lists null.
 * Two deliberate gaps: `overview.stickinessPct.currentByDay[3]` and the
 * quality day lists at index 5 are null (a day with nothing to divide / no
 * sample), never 0.
 *
 * Range: 17 Oct – 15 Nov 2026 (30 India days); previous: 17 Sep – 16 Oct 2026.
 * Counted at 2026-11-15T09:02:00Z = 15 Nov 2026, 2:32 pm India time.
 *
 * No real person, farm or organisation: every name below is invented.
 */

export const FIXTURE_DAYS = 30;

const DAY_MS = 86_400_000;

function isoPlus(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** n values ending exactly on `end`, stepping by `step` (as-of-a-day lists). */
export function ramp(end: number, step = 1, n = FIXTURE_DAYS, digits = 0): number[] {
  const f = 10 ** digits;
  return Array.from({ length: n }, (_, i) => Math.round((end - (n - 1 - i) * step) * f) / f);
}

/** n whole numbers adding up to `total` (during-a-day count lists). */
export function spread(total: number, n = FIXTURE_DAYS): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function withNull<T>(xs: T[], at: number): (T | null)[] {
  return xs.map((x, i) => (i === at ? null : x));
}

/** A measured number. */
export function num(
  current: number,
  previous: number,
  currentByDay: (number | null)[] | null = null,
  previousByDay: (number | null)[] | null = null,
): MisNumber {
  return {
    current: { value: current, notMeasuredReason: null },
    previous: { value: previous, notMeasuredReason: null },
    currentByDay,
    previousByDay,
  };
}

/** A number the server could not count, with its reason code, and no day lists. */
export function notMeasured(code: string): MisNumber {
  return {
    current: { value: null, notMeasuredReason: code },
    previous: { value: null, notMeasuredReason: code },
    currentByDay: null,
    previousByDay: null,
  };
}

const FROM = '2026-10-17';
const TO = '2026-11-15';
const PREV_FROM = '2026-09-17';
const PREV_TO = '2026-10-16';

function dayPoints(start: string, values: number[]): MisDayPoint[] {
  return values.map((value, i) => ({ day: isoPlus(start, i), value }));
}

/** Busiest cell of the heat grid: Wednesday (3), 19:00 India time. */
export const BUSIEST = { weekday: 3, hour: 19, logs: 97 } as const;

function heatCells() {
  const cells: { weekday: number; hour: number; logs: number }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const logs = weekday === BUSIEST.weekday && hour === BUSIEST.hour
        ? BUSIEST.logs
        : (weekday * 7 + hour * 3) % 11;
      cells.push({ weekday, hour, logs });
    }
  }
  return cells;
}

function curve(base: number, eligible0: number, lastDay: number) {
  return Array.from({ length: 31 }, (_, day) => {
    if (day > lastDay) return { day, activePct: null, eligible: 0 };
    return {
      day,
      activePct: day === 0 ? 100 : Math.round((base - day * 1.3) * 10) / 10,
      eligible: eligible0 - day * 7,
    };
  });
}

export function baseFixture(): CompanyMis {
  const signUpsDays = spread(268);
  const signUpsPrevDays = spread(231);
  return {
    countedAtUtc: '2026-11-15T09:02:00Z',
    timeZone: 'Asia/Kolkata',
    range: { from: FROM, to: TO, days: 30 },
    previousRange: { from: PREV_FROM, to: PREV_TO, days: 30 },
    excludedTestAccounts: 3,
    farmsListed: 774,
    farmsNotReadable: 0,
    overview: {
      activeFarms: num(412, 377, ramp(412), ramp(377)),
      signUps: num(268, 231, signUpsDays, signUpsPrevDays),
      dau: num(143, 129, ramp(143), ramp(129)),
      wau: num(356, 318, ramp(356), ramp(318)),
      mau: num(587, 541, ramp(587), ramp(541)),
      stickinessPct: num(24.4, 23.8, withNull(ramp(24.4, 0.1, 30, 1), 3), ramp(23.8, 0.1, 30, 1)),
      logsRecorded: num(913, 864, spread(913), spread(864)),
      voiceLogs: num(388, 349, spread(388), spread(349)),
      voiceSharePct: num(42.5, 40.4, ramp(42.5, 0.05, 30, 2), ramp(40.4, 0.05, 30, 2)),
      signUpsByDay: dayPoints(FROM, signUpsDays),
      activePeopleByDay: dayPoints(FROM, ramp(143)),
      logsByWeek: [
        { weekStart: '2026-10-12', voice: 31, typed: 44, isPartial: true },
        { weekStart: '2026-10-19', voice: 91, typed: 121, isPartial: false },
        { weekStart: '2026-10-26', voice: 97, typed: 133, isPartial: false },
        { weekStart: '2026-11-02', voice: 86, typed: 118, isPartial: false },
        { weekStart: '2026-11-09', voice: 83, typed: 109, isPartial: true },
      ],
    },
    acquisition: {
      verified: num(271, 236, spread(271), spread(236)),
      hasFarm: num(214, 188),
      firstLog: num(167, 152),
      habit: num(61, 57),
      habitEligible: num(139, 121),
    },
    engagement: {
      logsPerActiveFarmPerWeek: num(6.7, 5.9, ramp(6.7, 0.1, 30, 1), ramp(5.9, 0.1, 30, 1)),
      whenLogged: heatCells(),
      whenLoggedClock: 'server-arrival',
      roleMixOfMau: [
        { role: 'PrimaryOwner', people: 233 },
        { role: 'SecondaryOwner', people: 87 },
        { role: 'Mukadam', people: 64 },
        { role: 'Worker', people: 158 },
        { role: 'Unknown', people: 45 },
      ],
    },
    retention: {
      d1Pct: num(38.6, 35.2),
      d30Pct: num(12.7, 11.3),
      activeFarms0To6: num(404, 371, ramp(404), ramp(371)),
      quietFarms7To29: num(125, 114, ramp(125, -1), ramp(114, -1)),
      quietFarms7To13: num(73, 66, ramp(73), ramp(66)),
      quietFarms14To29: num(52, 48, ramp(52, -1), ramp(48, -1)),
      silentFarms30Plus: num(96, 83, ramp(96), ramp(83)),
      neverLoggedFarms: num(149, 137, ramp(149, -1), ramp(137, -1)),
      cohortByWeek: [
        { weekStart: '2026-10-19', people: 74, activePctByWeek: [44.6, 31.1, 24.3, null], activePctOnDays: [41.9, 27.4, 18.6, null] },
        { weekStart: '2026-10-26', people: 69, activePctByWeek: [39.1, 26.8, null, null], activePctOnDays: [36.2, 21.7, null, null] },
        { weekStart: '2026-11-02', people: 0, activePctByWeek: [null, null, null, null], activePctOnDays: [null, null, null, null] },
        { weekStart: '2026-11-09', people: 58, activePctByWeek: [null, null, null, null], activePctOnDays: [34.5, null, null, null] },
      ],
      curve: curve(61.4, 268, 25),
      winBackByDay: dayPoints(FROM, ramp(125, -1)),
      previousCurve: curve(57.8, 236, 29),
    },
    quality: {
      // Day 5 had no voice recording at all: a measured 0 that day, so the shares of that day are null.
      voiceRecordings: num(452, 417, [...spread(452, 29).slice(0, 5), 0, ...spread(452, 29).slice(5)], spread(417)),
      voiceRecordingsSavedPct: num(86.1, 83.7, withNull(ramp(86.1, 0.1, 30, 1), 5), ramp(83.7, 0.1, 30, 1)),
      transcriptionAvgMs: num(2340, 2610, withNull(ramp(2340, 10), 5), ramp(2610, 10)),
      transcriptionP95Ms: num(6870, 7420, withNull(ramp(6870, 20), 5), ramp(7420, 20)),
      logsCorrected: num(79, 68, spread(79), spread(68)),
      logsCorrectedPct: num(8.7, 7.9, ramp(8.7, 0.1, 30, 1), ramp(7.9, 0.1, 30, 1)),
    },
    farms: {
      activeFarms: num(415, 379, ramp(415), ramp(379)),
      farmsRegistered: num(774, 699, ramp(774), ramp(699)),
      acresCovered: num(963.4, 871.6, ramp(963.4, 1.1, 30, 1), ramp(871.6, 1.1, 30, 1)),
      farmsInFpo: num(186, 162, ramp(186), ramp(162)),
      farmsPerFpo: [
        { organizationName: 'Godavari Kisan Producer Company', farms: 109 },
        { organizationName: 'Pravara Farmers Collective', farms: 92 },
      ],
      acresByWeek: [
        { day: '2026-10-18', acres: 902.3 },
        { day: '2026-10-25', acres: 921.7 },
        { day: '2026-11-01', acres: 938.9 },
        { day: '2026-11-08', acres: 951.2 },
        { day: '2026-11-15', acres: 963.4 },
      ],
      activeFarmsInFpoPct: num(31.8, 29.6, ramp(31.8, 0.1, 30, 1), ramp(29.6, 0.1, 30, 1)),
    },
  };
}

type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (over === null || Array.isArray(over) || typeof over !== 'object') return over;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return over;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = merge((base as Record<string, unknown>)[k], v);
  }
  return out;
}

/**
 * The full answer, with optional overrides. A MisNumber given in an override
 * REPLACES the fixture's number whole (so `notMeasured(code)` drops its day
 * lists too); arrays are replaced, objects are merged.
 */
export function misFixture(overrides: DeepPartial<CompanyMis> = {}): CompanyMis {
  const base = baseFixture();
  const out = merge(base, overrides) as CompanyMis;
  // A MisNumber override replaces the whole number, never half of it.
  for (const section of ['overview', 'acquisition', 'engagement', 'retention', 'quality', 'farms'] as const) {
    const o = (overrides as Record<string, Record<string, unknown> | undefined>)[section];
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'current' in (v as object)) {
        (out[section] as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

/** The envelope the route answers with. */
export function misEnvelope(data: CompanyMis = misFixture()) {
  return {
    data,
    meta: {
      source: 'live',
      window: `${data.range.from}..${data.range.to}`,
      lastRefreshedUtc: data.countedAtUtc,
      ttlSeconds: 0,
    },
  };
}

/** Every answer field that is derived from farms, logs or voice jobs (blocked together by CR-2a). */
export const FARM_DERIVED_NUMBERS: readonly string[] = [
  'overview.activeFarms', 'overview.dau', 'overview.wau', 'overview.mau', 'overview.stickinessPct',
  'overview.logsRecorded', 'overview.voiceLogs', 'overview.voiceSharePct',
  'acquisition.hasFarm', 'acquisition.firstLog', 'acquisition.habit', 'acquisition.habitEligible',
  'engagement.logsPerActiveFarmPerWeek',
  'retention.d1Pct', 'retention.d30Pct', 'retention.activeFarms0To6', 'retention.quietFarms7To29',
  'retention.quietFarms7To13', 'retention.quietFarms14To29', 'retention.silentFarms30Plus', 'retention.neverLoggedFarms',
  'quality.voiceRecordings', 'quality.voiceRecordingsSavedPct', 'quality.transcriptionAvgMs',
  'quality.transcriptionP95Ms', 'quality.logsCorrected', 'quality.logsCorrectedPct',
  'farms.activeFarms', 'farms.farmsRegistered', 'farms.acresCovered', 'farms.farmsInFpo', 'farms.activeFarmsInFpoPct',
];

/** The answer when the farm list could not be read (CR-2a "response contract" + A6). */
export function farmsBlockedFixture(code = 'farm_list_unreadable'): CompanyMis {
  const d = baseFixture();
  for (const path of FARM_DERIVED_NUMBERS) {
    const [s, k] = path.split('.');
    (d as unknown as Record<string, Record<string, unknown>>)[s][k] = notMeasured(code);
  }
  d.farmsNotReadable = 2;
  d.overview.activePeopleByDay = [];
  d.overview.logsByWeek = [];
  d.engagement.whenLogged = [];
  d.engagement.roleMixOfMau = [];
  d.retention.cohortByWeek = [];
  d.retention.curve = [];
  d.retention.previousCurve = [];
  d.retention.winBackByDay = [];
  d.farms.farmsPerFpo = [];
  d.farms.acresByWeek = [];
  return d;
}

/** Read a dotted answer path, e.g. 'overview.voiceSharePct'. */
export function at(d: CompanyMis, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o === null || o === undefined ? undefined : (o as Record<string, unknown>)[k]), d);
}

/** An answer in which NOTHING is measured: every number has a reason, every list is empty. */
export function allNotMeasuredFixture(): CompanyMis {
  const d = farmsBlockedFixture('denominator_zero');
  d.overview.signUps = notMeasured('no_complete_window');
  d.acquisition.verified = notMeasured('no_complete_window');
  d.overview.signUpsByDay = [];
  return d;
}
