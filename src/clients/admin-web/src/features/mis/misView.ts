/**
 * THE ADAPTER: the company answer in, what each page shows out. Pure — no
 * React, no fetch.
 *
 * Three rules this file owns, and every page goes through them:
 *  1. A number is printed only from a named field of the answer, or from the
 *     arithmetic stated beside it here. Nothing is filled in.
 *  2. `value: null` becomes `notMeasured` with the server's reason in words.
 *     A measured 0 prints "0".
 *  3. `*Pct` fields are already percentages and are formatted as points.
 *
 * Charts draw only served values: the chosen period from `currentByDay` (or
 * the served series), and the period before only from `previousByDay` /
 * `previousCurve`, by position. A null day stays null — a gap in the line.
 */
import type {
  CompanyMis,
  MisCurvePoint,
  MisFeatureRole,
  MisFeatureUse,
  MisList,
  MisNumber,
  MisRange,
  MisValue,
} from '@/hooks/useCompanyMis';
import { itemByKey, reasonSentenceFor, type MisFieldPath, type MisSectionKey } from './misItems';
import {
  fmtDayYear,
  fmtDay,
  fmtDec,
  fmtDeltaPoints,
  fmtHour,
  fmtInt,
  fmtMs,
  fmtPctPoints,
  fmtRelDelta,
  fmtWeekdayDay,
  fromIsoDate,
} from './misFormat';

/* ── single values ─────────────────────────────────────────────────────── */

export type MisShown =
  | { kind: 'value'; value: number; text: string }
  | { kind: 'notMeasured'; why: string };

export type MisKind = 'count' | 'pct' | 'ms' | 'decimal' | 'acres';

export function formatterOf(kind: MisKind): (v: number) => string {
  switch (kind) {
    case 'pct':
      return (v) => fmtPctPoints(v);
    case 'ms':
      return fmtMs;
    case 'count':
      return fmtInt;
    case 'decimal':
    case 'acres':
      return (v) => fmtDec(v, 1);
  }
}

/**
 * The reason, in words, for a value the server did not count (said for `item` when given, B11).
 * No "Not measured:" prefix: every box that shows this already carries that word (B18 V5).
 */
export function notMeasuredWhy(code: string | null, item?: string): string {
  return reasonSentenceFor(code, item);
}

export function shownOf(v: MisValue, kind: MisKind, item?: string): MisShown {
  if (v.value === null || !Number.isFinite(v.value)) return { kind: 'notMeasured', why: notMeasuredWhy(v.notMeasuredReason, item) };
  return { kind: 'value', value: v.value, text: formatterOf(kind)(v.value) };
}

export type MisDelta =
  /** `up` is set only where the text carries no sign ("less than 0.1%"), so the arrow can still point. */
  | { text: string; good: boolean | null; up?: boolean }
  | { previousNotMeasured: string }
  | null;

/**
 * The change against the period before.
 * previous not measured -> says so; current not measured -> nothing;
 * shares -> point difference; counts: 0 -> 0 "no change", 0 -> n "up from 0",
 * otherwise the signed relative change.
 */
export function deltaOf(n: MisNumber, kind: MisKind, upIsGood: boolean, item?: string): MisDelta {
  const cur = n.current.value;
  const prev = n.previous.value;
  if (cur === null) return null;
  if (prev === null) return { previousNotMeasured: notMeasuredWhy(n.previous.notMeasuredReason, item) };
  /* B13: a change of zero reads "no change", never "0%" or "0 pts". */
  if (cur === prev) return { text: 'no change', good: null };
  const good = (cur > prev) === upIsGood;
  if (kind === 'pct') {
    const text = fmtDeltaPoints(cur, prev);
    return text === '0 pts' ? { text: 'less than 0.1 pts', good, up: cur > prev } : { text, good };
  }
  if (prev === 0) return { text: 'up from 0', good };
  const text = fmtRelDelta(cur, prev) as string;
  return text === '0%' ? { text: 'less than 0.1%', good, up: cur > prev } : { text, good };
}

/* ── tiles ─────────────────────────────────────────────────────────────── */

export interface MisTileModel {
  item: string;
  fields: readonly MisFieldPath[];
  label: string;
  hint: string;
  current: MisShown;
  previous: MisShown;
  delta: MisDelta;
  /** The served day-by-day values; null entries are gaps. Null = no sparkline. */
  spark: (number | null)[] | null;
  /** A caveat that changes how the number is read; shown under the hint. */
  note?: string;
}

/**
 * B18 V6: the tile names the count behind its share as its hint, e.g.
 * "12 of 50 entries". A count the server did not measure leaves the hint out.
 */
function withCountHint(tile: MisTileModel, hint: string | null, note?: string): MisTileModel {
  return { ...tile, hint: hint ?? '', ...(note ? { note } : {}) };
}

function countOf(v: MisValue): number | null {
  return v.value === null || !Number.isFinite(v.value) ? null : v.value;
}

export function tileFrom(item: string, n: MisNumber, kind: MisKind, upIsGood: boolean): MisTileModel {
  const meta = itemByKey(item);
  return {
    item,
    fields: meta.fields,
    label: meta.label,
    hint: meta.hint ?? '',
    current: shownOf(n.current, kind, item),
    previous: shownOf(n.previous, kind, item),
    delta: deltaOf(n, kind, upIsGood, item),
    spark: Array.isArray(n.currentByDay) ? n.currentByDay : null,
  };
}

/** A tile for an item the server does not count: the word and the reason, no number. */
export function tileNotMeasured(item: string): MisTileModel {
  const meta = itemByKey(item);
  const why = meta.why ?? 'Not measured yet.';
  return {
    item,
    fields: meta.fields,
    label: meta.label,
    hint: meta.hint ?? '',
    current: { kind: 'notMeasured', why },
    previous: { kind: 'notMeasured', why },
    delta: null,
    spark: null,
  };
}

/* ── charts ────────────────────────────────────────────────────────────── */

/** What a chart card shows: the chart, a "not measured" reason, or a measured nothing. */
export type MisChart<T> =
  | { kind: 'chart'; data: T }
  | { kind: 'notMeasured'; why: string }
  | { kind: 'none'; what: string };

export interface MisLineModel {
  labels: string[];
  titles: string[];
  current: (number | null)[];
  /** The period before, by position; null when the server sent none. */
  previous: (number | null)[] | null;
}

export const DAY_LINE_NOT_COUNTED = 'A day-by-day line is not counted yet. The figure for the range is above.';

const DAY_MS = 86_400_000;

/** One label per day of a range, "24 Oct", and the tooltip title "Fri 24 Oct". */
export function dayAxis(range: MisRange): { labels: string[]; titles: string[] } {
  const start = fromIsoDate(range.from);
  const labels: string[] = [];
  const titles: string[] = [];
  for (let i = 0; i < range.days; i += 1) {
    labels.push(fmtDay(start + i * DAY_MS));
    titles.push(fmtWeekdayDay(start + i * DAY_MS));
  }
  return { labels, titles };
}

function byPosition(values: (number | null)[] | null | undefined, length: number): (number | null)[] | null {
  if (!Array.isArray(values)) return null;
  return Array.from({ length }, (_, i) => (i < values.length ? values[i] : null));
}

/** True when a list holds at least one measured value. */
export function hasServedValue(values: (number | null)[] | null | undefined): values is (number | null)[] {
  return Array.isArray(values) && values.some((x) => x !== null && Number.isFinite(x));
}

/** A previous line by position, or null when the server sent none or every value is null (B18 V3). */
function previousLine(values: (number | null)[] | null | undefined, length: number): (number | null)[] | null {
  return hasServedValue(values) ? byPosition(values, length) : null;
}

/**
 * The day-by-day line of one number, or why there is none. B12: a line with
 * no measured day (all null, or no list) is a reason, never empty axes.
 */
export function dayLineOf(n: MisNumber, range: MisRange, item?: string): MisChart<MisLineModel> {
  if (!Array.isArray(n.currentByDay)) {
    /* No day list at all: the number has no day-by-day form (or it was not counted). */
    if (n.current.value === null) return { kind: 'notMeasured', why: notMeasuredWhy(n.current.notMeasuredReason, item) };
    return { kind: 'notMeasured', why: DAY_LINE_NOT_COUNTED };
  }
  if (!hasServedValue(n.currentByDay)) {
    /* A day list with no measured day: the number's own reason (B18 V3). */
    return { kind: 'notMeasured', why: notMeasuredWhy(n.current.notMeasuredReason ?? 'denominator_zero', item) };
  }
  const axis = dayAxis(range);
  return {
    kind: 'chart',
    data: {
      ...axis,
      current: byPosition(n.currentByDay, axis.labels.length) ?? [],
      previous: previousLine(n.previousByDay, axis.labels.length),
    },
  };
}

/* ── lists (CR-2c) ─────────────────────────────────────────────────────── */

/** A served list with no rows: said in words, never as an empty table. */
export const NONE_IN_PERIOD = 'None in this period';

/**
 * A served list, or why there is none (CR-2c Step 2). A list's own reason
 * always wins and is shown as its sentence, never as "none"; a counted list
 * with no rows is "None in this period".
 */
export function listChart<T, M>(list: MisList<T>, item: string, model: (items: T[]) => M): MisChart<M> {
  if (typeof list.notMeasuredReason === 'string') {
    return { kind: 'notMeasured', why: notMeasuredWhy(list.notMeasuredReason, item) };
  }
  if (list.items.length === 0) return { kind: 'none', what: NONE_IN_PERIOD };
  return { kind: 'chart', data: model(list.items) };
}

/* ── shared pieces ─────────────────────────────────────────────────────── */

const ROLE_NAMES: Record<string, string> = {
  PrimaryOwner: 'Owner',
  SecondaryOwner: 'Co-owner',
  Mukadam: 'Mukadam',
  Worker: 'Worker',
  Agronomist: 'Agronomist',
  Consultant: 'Consultant',
  FpcTechnicalManager: 'FPC technical manager',
  FieldScout: 'Field scout',
  LabOperator: 'Lab operator',
  Unknown: 'No role on that farm',
};

export function roleName(role: string): string {
  return Object.prototype.hasOwnProperty.call(ROLE_NAMES, role) ? ROLE_NAMES[role] : role;
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function asOfText(d: CompanyMis): string {
  return fmtDayYear(fromIsoDate(d.range.to));
}

/* ── Overview ──────────────────────────────────────────────────────────── */

export interface OverviewView {
  hero: {
    item: string;
    fields: readonly MisFieldPath[];
    current: MisShown;
    previous: MisShown;
    delta: MisDelta;
    asOf: string;
    previousTo: string;
    registered: MisShown;
    newFarms: MisShown;
    acres: MisShown;
    line: MisChart<MisLineModel>;
  };
  tiles: MisTileModel[];
  signUps: MisChart<{ labels: string[]; titles: string[]; values: number[] }>;
  logsByWeek: MisChart<{ labels: string[]; titles: string[]; voice: number[]; typed: number[] }>;
}

/** New farms in the range = registered by `to` minus registered by the day before the range. */
export function newFarmsOf(registered: MisNumber): MisShown {
  const cur = registered.current.value;
  const prev = registered.previous.value;
  if (cur === null) return { kind: 'notMeasured', why: notMeasuredWhy(registered.current.notMeasuredReason) };
  if (prev === null) return { kind: 'notMeasured', why: notMeasuredWhy(registered.previous.notMeasuredReason) };
  return { kind: 'value', value: cur - prev, text: fmtInt(cur - prev) };
}

function weekLabel(weekStart: string, isPartial: boolean): { label: string; title: string } {
  const ms = fromIsoDate(weekStart);
  const part = isPartial ? ' (part week)' : '';
  return { label: `${fmtDay(ms)}${part}`, title: `Week of ${fmtDay(ms)}${part}` };
}

export function overviewView(d: CompanyMis): OverviewView {
  const o = d.overview;
  const hero = o.activeFarms;
  const signUpsChart: OverviewView['signUps'] = o.signUpsByDay.length > 0
    ? {
      kind: 'chart',
      data: {
        labels: o.signUpsByDay.map((p) => fmtDay(fromIsoDate(p.day))),
        titles: o.signUpsByDay.map((p) => fmtWeekdayDay(fromIsoDate(p.day))),
        values: o.signUpsByDay.map((p) => p.value),
      },
    }
    : { kind: 'notMeasured', why: notMeasuredWhy(o.signUps.current.notMeasuredReason) };
  const weeks = o.logsByWeek.map((w) => weekLabel(w.weekStart, w.isPartial));
  const logsChart: OverviewView['logsByWeek'] = o.logsByWeek.length > 0
    ? {
      kind: 'chart',
      data: {
        labels: weeks.map((w) => w.label),
        titles: weeks.map((w) => w.title),
        voice: o.logsByWeek.map((w) => w.voice),
        typed: o.logsByWeek.map((w) => w.typed),
      },
    }
    : { kind: 'notMeasured', why: notMeasuredWhy(o.logsRecorded.current.notMeasuredReason) };

  return {
    hero: {
      item: 'overview.activeFarms',
      fields: itemByKey('overview.activeFarms').fields,
      current: shownOf(hero.current, 'count'),
      previous: shownOf(hero.previous, 'count'),
      delta: deltaOf(hero, 'count', true),
      asOf: asOfText(d),
      previousTo: fmtDay(fromIsoDate(d.previousRange.to)),
      registered: shownOf(d.farms.farmsRegistered.current, 'count'),
      newFarms: newFarmsOf(d.farms.farmsRegistered),
      acres: shownOf(d.farms.acresCovered.current, 'acres'),
      line: dayLineOf(hero, d.range, 'overview.activeFarms'),
    },
    tiles: [
      tileNotMeasured('overview.installs'),
      tileFrom('overview.signUps', o.signUps, 'count', true),
      tileFrom('overview.dau', o.dau, 'count', true),
      tileFrom('overview.wau', o.wau, 'count', true),
      tileFrom('overview.mau', o.mau, 'count', true),
      tileFrom('overview.stickiness', o.stickinessPct, 'pct', true),
      tileFrom('overview.logsRecorded', o.logsRecorded, 'count', true),
      (() => {
        const voice = countOf(o.voiceLogs.current);
        const all = countOf(o.logsRecorded.current);
        const hint = voice === null || all === null ? null : `${fmtInt(voice)} of ${fmtInt(all)} ${noun(all, 'entry', 'entries')}`;
        return withCountHint(tileFrom('overview.voiceShare', o.voiceSharePct, 'pct', true), hint, itemByKey('overview.voiceShare').hint);
      })(),
      understandingTile(o),
      tileNotMeasured('overview.crashFree'),
    ],
    signUps: signUpsChart,
    logsByWeek: logsChart,
  };
}

/** "6.5 of 10": the understanding score is out of 10 (CR-2c #10). */
function outOfTen(s: MisShown): MisShown {
  return s.kind === 'value' ? { ...s, text: `${s.text} of 10` } : s;
}

/** #10: the median score of scored farm-days, and how many farm-days it rests on. */
export function understandingTile(o: CompanyMis['overview']): MisTileModel {
  const tile = tileFrom('overview.understanding', o.understandingMedian, 'decimal', true);
  const days = countOf(o.understandingScoredDays.current);
  const hint = tile.current.kind === 'value' && days !== null
    ? `from ${fmtInt(days)} ${noun(days, 'farm-day', 'farm-days')}`
    : null;
  return withCountHint({ ...tile, current: outOfTen(tile.current), previous: outOfTen(tile.previous) }, hint);
}

/* ── Acquisition ───────────────────────────────────────────────────────── */

export interface FunnelStepModel {
  item: string;
  fields: readonly MisFieldPath[];
  label: string;
  current: MisShown;
  /** "of sign-ups" or "of N old enough to judge"; null for the first two steps. */
  share: { text: string; of: string } | null;
  delta: MisDelta;
  /** B9: "x% did not continue" from the step before, when both are measured on one base. */
  dropFromPrevious: string | null;
  /** B14: the step cannot be judged yet; this sentence replaces the count and the bar. */
  pending: string | null;
}

export const HABIT_NOBODY_ELIGIBLE = 'Nobody who signed up in this range is 7 days in yet';

/** B9: (earlier − later) ÷ earlier × 100, whole percent, half away from zero. Null when either is absent or earlier is 0. */
export function dropOf(earlier: number | null, later: number | null): string | null {
  if (earlier === null || later === null || earlier === 0) return null;
  const x = ((earlier - later) / earlier) * 100;
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return `${r === 0 ? 0 : r}% did not continue`;
}

/** B8: count ÷ the sum of served counts × 100, one decimal, half away from zero; null when the sum is 0. */
export function shareText(count: number, total: number): string | null {
  if (!(total > 0)) return null;
  const x = (count / total) * 100;
  const r = Math.sign(x) * Math.round(Math.abs(x) * 10) / 10;
  return fmtPctPoints(r);
}

export interface AcquisitionView {
  steps: FunnelStepModel[];
}

/** value ÷ base × 100, the share the funnel prints; null when there is nothing to divide by. */
function shareOf(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base === 0) return null;
  return (value / base) * 100;
}

export function acquisitionView(d: CompanyMis): AcquisitionView {
  const a = d.acquisition;
  const verified = a.verified.current.value;
  const step = (item: string, n: MisNumber, base: number | null, of: string | null): FunnelStepModel => {
    const meta = itemByKey(item);
    const s = of === null ? null : shareOf(n.current.value, base);
    return {
      item,
      fields: meta.fields,
      label: meta.label,
      current: shownOf(n.current, 'count'),
      share: s === null || of === null ? null : { text: fmtPctPoints(s), of },
      delta: deltaOf(n, 'count', true),
      dropFromPrevious: null,
      pending: null,
    };
  };
  const installed = itemByKey('acquisition.installed');
  const eligible = a.habitEligible.current.value;
  return {
    steps: [
      {
        item: installed.key,
        fields: installed.fields,
        label: installed.label,
        current: { kind: 'notMeasured', why: installed.why ?? '' },
        share: null,
        delta: null,
        dropFromPrevious: null,
        pending: null,
      },
      step('acquisition.verified', a.verified, null, null),
      { ...step('acquisition.hasFarm', a.hasFarm, verified, 'of sign-ups'), dropFromPrevious: dropOf(verified, a.hasFarm.current.value) },
      { ...step('acquisition.firstLog', a.firstLog, verified, 'of sign-ups'), dropFromPrevious: dropOf(a.hasFarm.current.value, a.firstLog.current.value) },
      eligible === 0
        ? { ...step('acquisition.habit', a.habit, null, null), delta: null, pending: HABIT_NOBODY_ELIGIBLE }
        : step('acquisition.habit', a.habit, eligible, eligible === null ? null : `of ${fmtInt(eligible)} old enough to judge`),
    ],
  };
}

/* ── Engagement ────────────────────────────────────────────────────────── */

export interface FeatureRowModel {
  key: string;
  label: string;
  /** Null when the feature is not measured; `word` and `why` then say so. */
  people: number | null;
  share: number | null;
  shareText: string | null;
  /** "not recorded" or "not measured"; null when measured. */
  word: string | null;
  why: string | null;
}

export interface FeatureRoleModel {
  roles: { key: string; label: string }[];
  /** One cell per role; null = nobody in that role used it (the server lists only pairs it counted). */
  rows: { key: string; label: string; cells: (number | null)[] }[];
}

export interface EngagementView {
  perFarm: MisChart<MisLineModel>;
  heat: MisChart<{ grid: number[][]; max: number }>;
  roles: MisChart<{ parts: { key: string; label: string; people: number; share: string | null }[] }>;
  kinds: MisChart<{ rows: { key: string; label: string; entries: number }[] }>;
  features: MisChart<{ rows: FeatureRowModel[] }>;
  featureRoles: MisChart<FeatureRoleModel>;
}

/** The app's own work words (CR-2c 1f), in plain English. An unknown key is shown as sent. */
const KIND_NAMES: Record<string, string> = {
  water: 'Water',
  nutrition: 'Nutrition',
  spray: 'Spray',
  other_work: 'Other field work',
  labour: 'Labour',
  not_recognised: 'Not recognised',
};

/** The counted parts of the app (CR-2c 1d with E1: no schedule feature), in plain English. */
const FEATURE_NAMES: Record<string, string> = {
  entries: 'Saved an entry',
  voice: 'Voice recording',
  costs: 'Added a cost',
  attendance: 'Marked attendance',
  photos: 'Added a photo or receipt',
  job_cards: 'Made a job card',
  compare: 'Compare',
};
const FEATURE_ORDER = Object.keys(FEATURE_NAMES);

function nameIn(names: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : key;
}

export function kindName(kind: string): string {
  return nameIn(KIND_NAMES, kind);
}

export function featureName(feature: string): string {
  return nameIn(FEATURE_NAMES, feature);
}

function featureRank(feature: string): number {
  const i = FEATURE_ORDER.indexOf(feature);
  return i < 0 ? FEATURE_ORDER.length : i;
}

function featureRow(f: MisFeatureUse): FeatureRowModel {
  const people = f.people;
  const share = f.sharePct;
  const base = { key: f.feature, label: featureName(f.feature) };
  if (people === null || share === null || !Number.isFinite(people) || !Number.isFinite(share)) {
    return {
      ...base,
      people: null,
      share: null,
      shareText: null,
      word: f.notMeasuredReason === 'not_recorded' ? 'not recorded' : 'not measured',
      why: notMeasuredWhy(f.notMeasuredReason, 'engagement.featureUse'),
    };
  }
  return { ...base, people, share, shareText: fmtPctPoints(share), word: null, why: null };
}

/** Features down, roles across (roles with the most people first). Only served pairs carry a number. */
export function featureRoleModel(items: MisFeatureRole[]): FeatureRoleModel {
  const weight = new Map<string, number>();
  for (const r of items) weight.set(r.role, (weight.get(r.role) ?? 0) + r.people);
  const roles = [...weight.entries()].sort((x, y) => y[1] - x[1]).map(([key]) => ({ key, label: roleName(key) }));
  const features = [...new Set(items.map((r) => r.feature))].sort((x, y) => featureRank(x) - featureRank(y));
  return {
    roles,
    rows: features.map((feature) => ({
      key: feature,
      label: featureName(feature),
      cells: roles.map((role) => items.find((r) => r.feature === feature && r.role === role.key)?.people ?? null),
    })),
  };
}

/** 7 Monday-first rows × 24 hours, every served cell placed; totals over the range. */
export function heatGrid(cells: CompanyMis['engagement']['whenLogged']): { grid: number[][]; max: number } {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const c of cells) {
    if (c.weekday >= 1 && c.weekday <= 7 && c.hour >= 0 && c.hour <= 23) grid[c.weekday - 1][c.hour] += c.logs;
  }
  const max = Math.max(0, ...grid.flat());
  return { grid, max };
}

export function engagementView(d: CompanyMis): EngagementView {
  const e = d.engagement;
  const mau = d.overview.mau.current;
  const roles: EngagementView['roles'] = mau.value === null
    ? { kind: 'notMeasured', why: notMeasuredWhy(mau.notMeasuredReason) }
    : e.roleMixOfMau.length === 0
      ? { kind: 'none', what: `No one saved an entry in the 30 days to ${asOfText(d)}` }
      : {
        kind: 'chart',
        data: {
          parts: [...e.roleMixOfMau]
            .sort((x, y) => y.people - x.people)
            .map((r) => ({
              key: r.role,
              label: roleName(r.role),
              people: r.people,
              share: shareText(r.people, e.roleMixOfMau.reduce((sum, x) => sum + x.people, 0)),
            })),
        },
      };
  return {
    perFarm: dayLineOf(e.logsPerActiveFarmPerWeek, d.range, 'engagement.logsPerFarm'),
    heat: e.whenLogged.length > 0
      ? { kind: 'chart', data: heatGrid(e.whenLogged) }
      : { kind: 'notMeasured', why: notMeasuredWhy(d.overview.logsRecorded.current.notMeasuredReason) },
    roles,
    /* Most entries first; "not recognised" is what is left over, so it comes last. */
    kinds: listChart(e.logsByKind, 'engagement.logsByType', (items) => ({
      rows: [...items]
        .sort((x, y) => Number(x.kind === 'not_recognised') - Number(y.kind === 'not_recognised') || y.entries - x.entries)
        .map((r) => ({ key: r.kind, label: kindName(r.kind), entries: r.entries })),
    })),
    /* Largest share first; a feature that is not measured (Compare) comes last and says so. */
    features: listChart(e.featureUse, 'engagement.featureUse', (items) => ({
      rows: items
        .map(featureRow)
        .sort((x, y) => Number(x.share === null) - Number(y.share === null) || (y.share ?? 0) - (x.share ?? 0)),
    })),
    featureRoles: listChart(e.featureUseByRole, 'engagement.featureByRole', featureRoleModel),
  };
}

/* ── Retention ─────────────────────────────────────────────────────────── */

export interface CohortRowModel {
  weekStart: string;
  label: string;
  people: number;
  /** Day 1, 7, 14, 30; null = that day has not passed for anyone in the row. */
  cells: (number | null)[];
}

export interface BandModel {
  key: string;
  label: string;
  value: number;
  text: string;
  /** B8: this band's count ÷ the five bands' sum; null when the sum is 0. */
  share: string | null;
  delta: MisDelta;
}

export interface RetentionView {
  tiles: MisTileModel[];
  /** `scaleTop`: the largest served cell rounded up to the next 10 (B18 V4). */
  cohorts: MisChart<{ rows: CohortRowModel[]; scaleTop: number }>;
  curve: MisChart<MisLineModel>;
  bands: MisChart<{ parts: BandModel[]; asOf: string }>;
  winBack: MisChart<MisLineModel>;
}

export const COHORT_DAYS = [1, 7, 14, 30] as const;

function curveValues(points: MisCurvePoint[]): (number | null)[] {
  return [...points].sort((a, b) => a.day - b.day).map((p) => p.activePct);
}

/** The cohort colour scale's top: the largest served cell rounded up to the next 10, at least 10 (B18 V4). */
export function cohortScaleTop(cells: (number | null)[]): number {
  const served = cells.filter((c): c is number => c !== null && Number.isFinite(c));
  const max = served.length ? Math.max(...served) : 0;
  return Math.max(10, Math.ceil(max / 10) * 10);
}

export function retentionView(d: CompanyMis): RetentionView {
  const r = d.retention;
  const bandDefs: { key: string; label: string; n: MisNumber }[] = [
    { key: 'active', label: 'Saved in the last 7 days', n: r.activeFarms0To6 },
    { key: 's7', label: 'Silent 7–13 days', n: r.quietFarms7To13 },
    { key: 's14', label: 'Silent 14–29 days', n: r.quietFarms14To29 },
    { key: 's30', label: 'Silent 30 days or more', n: r.silentFarms30Plus },
    { key: 'never', label: 'Never saved an entry', n: r.neverLoggedFarms },
  ];
  const blocked = bandDefs.find((b) => !b.n || b.n.current.value === null);
  const bands: RetentionView['bands'] = blocked
    ? { kind: 'notMeasured', why: notMeasuredWhy(blocked.n ? blocked.n.current.notMeasuredReason : null, 'retention.bands') }
    : {
      kind: 'chart',
      data: {
        asOf: fmtWeekdayDay(fromIsoDate(d.range.to)),
        parts: bandDefs.map((b) => ({
          key: b.key,
          label: b.label,
          value: b.n.current.value as number,
          text: fmtInt(b.n.current.value as number),
          share: shareText(b.n.current.value as number, bandDefs.reduce((sum, x) => sum + (x.n.current.value as number), 0)),
          delta: deltaOf(b.n, 'count', b.key === 'active'),
        })),
      },
    };

  /* B18 V1: blocked farm numbers empty the curve and the week grid while sign-ups
     stay measured. That is "not counted", never "nobody". */
  const d1Reason = r.d1Pct.current.value === null ? r.d1Pct.current.notMeasuredReason : null;
  const farmsBlocked = d1Reason === 'farm_list_unreadable' || d1Reason === 'too_many_farms_for_live_count';
  const nobodySignedUp = d.overview.signUps.current.value === 0;

  const curvePoints = [...r.curve].sort((a, b) => a.day - b.day);
  const curveCurrent = curveValues(curvePoints);
  const curve: RetentionView['curve'] = farmsBlocked
    ? { kind: 'notMeasured', why: notMeasuredWhy(d1Reason, 'retention.curve') }
    : curvePoints.length === 0 || !hasServedValue(curveCurrent)
      ? nobodySignedUp
        ? { kind: 'none', what: 'No one verified a phone in this range' }
        : { kind: 'notMeasured', why: notMeasuredWhy(d1Reason ?? 'no_complete_window', 'retention.curve') }
      : {
      kind: 'chart',
      data: {
        labels: curvePoints.map((p) => `Day ${p.day}`),
        titles: curvePoints.map((p) => `Day ${p.day} after signing up`),
        current: curveCurrent,
        previous: Array.isArray(r.previousCurve) ? previousLine(curveValues(r.previousCurve), curvePoints.length) : null,
      },
    };

  const winBack: RetentionView['winBack'] = r.winBackByDay.length > 0
    ? {
      kind: 'chart',
      data: {
        labels: r.winBackByDay.map((p) => fmtDay(fromIsoDate(p.day))),
        titles: r.winBackByDay.map((p) => fmtWeekdayDay(fromIsoDate(p.day))),
        current: r.winBackByDay.map((p) => p.value),
        previous: previousLine(r.quietFarms7To29.previousByDay, r.winBackByDay.length),
      },
    }
    : { kind: 'notMeasured', why: notMeasuredWhy(r.quietFarms7To29.current.notMeasuredReason) };

  return {
    tiles: [
      tileFrom('retention.d1', r.d1Pct, 'pct', true),
      tileFrom('retention.d30', r.d30Pct, 'pct', true),
      tileFrom('retention.quiet', r.quietFarms7To29, 'count', false),
      tileFrom('retention.silent30', r.silentFarms30Plus, 'count', false),
    ],
    cohorts: farmsBlocked
      ? { kind: 'notMeasured', why: notMeasuredWhy(d1Reason, 'retention.cohorts') }
      : r.cohortByWeek.some((row) => !Array.isArray(row.activePctOnDays))
      ? { kind: 'notMeasured', why: 'The return on day 1, 7, 14 and 30 is not counted by this server yet.' }
      : r.cohortByWeek.length > 0
      ? {
        kind: 'chart',
        data: {
          scaleTop: cohortScaleTop(r.cohortByWeek.flatMap((row) => row.activePctOnDays)),
          rows: r.cohortByWeek.map((row) => ({
            weekStart: row.weekStart,
            label: fmtDay(fromIsoDate(row.weekStart)),
            people: row.people,
            cells: COHORT_DAYS.map((_, k) => row.activePctOnDays[k] ?? null),
          })),
        },
      }
      : { kind: 'none', what: 'No sign-up week starts inside this range' },
    curve,
    bands,
    winBack,
  };
}

/* ── Quality ───────────────────────────────────────────────────────────── */

export interface SyncDaysModel {
  labels: string[];
  titles: string[];
  refused: (number | null)[];
  accepted: (number | null)[];
  /** Refused changes not measured for the whole range, in words; null when measured. */
  refusedWhy: string | null;
}

export interface VersionRowModel {
  key: string;
  version: string;
  /** "Android app" or "Not the Android app" (CR-2c E9). */
  seenOn: string;
  people: number;
  share: number;
  shareText: string;
}

export interface QualityView {
  tiles: MisTileModel[];
  saved: MisChart<MisLineModel>;
  latency: MisChart<{ labels: string[]; titles: string[]; avg: (number | null)[]; p95: (number | null)[] }>;
  corrected: MisChart<MisLineModel>;
  spread: MisChart<{ labels: string[]; titles: string[]; values: number[] }>;
  sync: MisChart<SyncDaysModel>;
  versions: MisChart<{ rows: VersionRowModel[] }>;
  /** Said when the first app-seen record is later than the period's first day; null otherwise. */
  versionsKnownSince: string | null;
}

/** Global Constraints: sync failures measure the server, so every upload counts (stated on screen). */
export const SYNC_EVERY_UPLOAD = 'Every upload counts, test accounts included.';
/** CR-2c E2: the phone resends a refused change, and each refusal is counted. */
export const SYNC_REFUSED_AGAIN = 'A change refused again counts each time.';

const NO_SCORED_DAY_WHAT = 'No farm-day in this period got a score';
const NO_CHANGE_SENT_WHAT = 'No change was sent from a phone in this period';

/** The server writes "android" only for the native Android app; anything else is not it. */
export function platformName(platform: string | null | undefined): string {
  return typeof platform === 'string' && platform.trim().toLowerCase() === 'android' ? 'Android app' : 'Not the Android app';
}

/** #49: farm-days per score, lowest score first; every bucket 0 is a measured nothing. */
export function spreadOf(list: MisList<{ score: number; farmDays: number }>): QualityView['spread'] {
  const chart = listChart(list, 'quality.scoreSpread', (items) => {
    const sorted = [...items].sort((x, y) => x.score - y.score);
    return {
      labels: sorted.map((b) => String(b.score)),
      titles: sorted.map((b) => `Score ${b.score} of 10`),
      values: sorted.map((b) => b.farmDays),
    };
  });
  return chart.kind === 'chart' && chart.data.values.every((v) => v === 0)
    ? { kind: 'none', what: NO_SCORED_DAY_WHAT }
    : chart;
}

/** #50 (CR-2c E8): refused and accepted changes per day, from the two numbers' own day lists. */
export function syncDaysOf(refused: MisNumber, accepted: MisNumber, range: MisRange): MisChart<SyncDaysModel> {
  const item = 'quality.syncFailChart';
  const refusedDays = Array.isArray(refused.currentByDay) ? refused.currentByDay : null;
  const acceptedDays = Array.isArray(accepted.currentByDay) ? accepted.currentByDay : null;
  if (!hasServedValue(refusedDays) && !hasServedValue(acceptedDays)) {
    const blocked = [refused, accepted].find((x) => x.current.value === null);
    return { kind: 'notMeasured', why: blocked ? notMeasuredWhy(blocked.current.notMeasuredReason, item) : DAY_LINE_NOT_COUNTED };
  }
  if (refused.current.value === 0 && accepted.current.value === 0) return { kind: 'none', what: NO_CHANGE_SENT_WHAT };
  const axis = dayAxis(range);
  const n = axis.labels.length;
  return {
    kind: 'chart',
    data: {
      ...axis,
      refused: byPosition(refusedDays, n) ?? axis.labels.map(() => null),
      accepted: byPosition(acceptedDays, n) ?? axis.labels.map(() => null),
      refusedWhy: refused.current.value === null ? notMeasuredWhy(refused.current.notMeasuredReason, item) : null,
    },
  };
}

export function qualityView(d: CompanyMis): QualityView {
  const q = d.quality;
  /* The average is the main line: with no measured day it is a reason (B12). The slowest-5% line
     is drawn beside it from its own served days, or left out when it has none. */
  const avg = dayLineOf(q.transcriptionAvgMs, d.range, 'quality.transcriptionAvg');
  const p95Days = Array.isArray(q.transcriptionP95Ms.currentByDay) ? q.transcriptionP95Ms.currentByDay : null;
  const latency: QualityView['latency'] = avg.kind === 'chart'
    ? {
      kind: 'chart',
      data: {
        labels: avg.data.labels,
        titles: avg.data.titles,
        avg: avg.data.current,
        p95: byPosition(p95Days, avg.data.labels.length) ?? avg.data.labels.map(() => null),
      },
    }
    : avg;
  return {
    tiles: [
      (() => {
        const n = countOf(q.voiceRecordings.current);
        return withCountHint(tileFrom('quality.voiceSaved', q.voiceRecordingsSavedPct, 'pct', true), n === null ? null : `${fmtInt(n)} ${noun(n, 'recording', 'recordings')}`);
      })(),
      tileFrom('quality.transcriptionAvg', q.transcriptionAvgMs, 'ms', false),
      tileFrom('quality.transcriptionP95', q.transcriptionP95Ms, 'ms', false),
      (() => {
        const n = countOf(q.logsCorrected.current);
        return withCountHint(tileFrom('quality.corrected', q.logsCorrectedPct, 'pct', false), n === null ? null : `${fmtInt(n)} ${noun(n, 'entry', 'entries')} corrected`);
      })(),
      (() => {
        /* #47: refused attempts of everything sent (refused attempts + accepted changes), the share's own base. */
        const refused = countOf(q.syncRefusedChanges.current);
        const accepted = countOf(q.syncAcceptedChanges.current);
        const sent = refused === null || accepted === null ? null : refused + accepted;
        const hint = refused === null || sent === null ? null : `${fmtInt(refused)} refused of ${fmtInt(sent)} ${noun(sent, 'change', 'changes')}`;
        return withCountHint(tileFrom('quality.syncFailTile', q.syncRefusedPct, 'pct', false), hint, SYNC_EVERY_UPLOAD);
      })(),
      tileNotMeasured('quality.crashFree'),
    ],
    saved: dayLineOf(q.voiceRecordingsSavedPct, d.range, 'quality.voiceSaved'),
    latency,
    corrected: dayLineOf(q.logsCorrectedPct, d.range, 'quality.corrected'),
    spread: spreadOf(q.understandingSpread),
    sync: syncDaysOf(q.syncRefusedChanges, q.syncAcceptedChanges, d.range),
    /* The server orders versions by their numbers; that order is kept. */
    versions: listChart(q.appVersions, 'quality.versionAdoption', (items) => ({
      rows: items.map((r, k) => ({
        key: `${k}-${r.version}-${r.platform}`,
        version: r.version,
        seenOn: platformName(r.platform),
        people: r.people,
        share: r.sharePct,
        shareText: fmtPctPoints(r.sharePct),
      })),
    })),
    versionsKnownSince: typeof q.appVersionsSeenSince === 'string' && q.appVersionsSeenSince > d.range.from
      ? `Known since ${fmtDayYear(fromIsoDate(q.appVersionsSeenSince))}: app versions were not recorded before that day.`
      : null,
  };
}

/* ── Farms & geography ─────────────────────────────────────────────────── */

export interface FarmsView {
  tiles: MisTileModel[];
  perFpo: MisChart<{ rows: { key: string; label: string; farms: number }[] }>;
  acres: MisChart<{ labels: string[]; titles: string[]; values: number[] }>;
  crops: MisChart<{ rows: { key: string; label: string; farms: number; acres: number }[] }>;
}

export function farmsView(d: CompanyMis): FarmsView {
  const f = d.farms;
  const perFpo: FarmsView['perFpo'] = f.farmsInFpo.current.value === null
    ? { kind: 'notMeasured', why: notMeasuredWhy(f.farmsInFpo.current.notMeasuredReason) }
    : f.farmsPerFpo.length === 0
      ? { kind: 'none', what: `No farms linked to a producer organisation by ${asOfText(d)}` }
      : {
        kind: 'chart',
        data: {
          rows: [...f.farmsPerFpo]
            .sort((x, y) => y.farms - x.farms)
            .map((r, k) => ({ key: `${k}-${r.organizationName}`, label: r.organizationName, farms: r.farms })),
        },
      };
  const acres: FarmsView['acres'] = f.acresByWeek.length > 0
    ? {
      kind: 'chart',
      data: {
        labels: f.acresByWeek.map((p) => fmtDay(fromIsoDate(p.day))),
        titles: f.acresByWeek.map((p) => fmtWeekdayDay(fromIsoDate(p.day))),
        values: f.acresByWeek.map((p) => p.acres),
      },
    }
    : { kind: 'notMeasured', why: notMeasuredWhy(f.acresCovered.current.notMeasuredReason) };
  const inFpo = tileFrom('farms.inFpo', f.activeFarmsInFpoPct, 'pct', true);
  const count = shownOf(f.farmsInFpo.current, 'count');
  inFpo.hint = count.kind === 'value'
    ? `Of active farms; ${count.text} registered ${noun(count.value, 'farm is', 'farms are')} in one`
    : 'Of active farms';
  return {
    tiles: [
      tileFrom('farms.activeFarms', f.activeFarms, 'count', true),
      tileFrom('farms.registered', f.farmsRegistered, 'count', true),
      tileFrom('farms.acres', f.acresCovered, 'acres', true),
      inFpo,
    ],
    perFpo,
    acres,
    /* The server orders crops by farms, then acres, then name; that order is kept. */
    crops: listChart(f.cropsOnActiveFarms, 'farms.crops', (items) => ({
      rows: items.map((r, k) => ({
        key: `${k}-${r.cropName}`,
        label: r.cropName.trim() === '' ? 'No crop name entered' : r.cropName,
        farms: r.farms,
        acres: r.acres,
      })),
    })),
  };
}

/* ── Operations ────────────────────────────────────────────────────────── */

export interface OperationsView {
  tiles: MisTileModel[];
}

export function operationsView(): OperationsView {
  return {
    tiles: [
      'operations.otpDelivered',
      'operations.otpTime',
      'operations.ticketsOpened',
      'operations.ticketsClosed',
      'operations.ticketsOpen',
      'operations.timeToClose',
    ].map(tileNotMeasured),
  };
}

/* ── Headlines ─────────────────────────────────────────────────────────── */

function changeClause(n: MisNumber, kind: MisKind, upIsGood: boolean, compare: boolean): string {
  if (!compare) return '';
  const d = deltaOf(n, kind, upIsGood);
  if (!d || !('text' in d)) return '';
  return ` (${d.text} on the period before)`;
}

/** A headline clause for a number the server did not count, in the item's own words (B11). */
function notMeasuredClause(label: string, v: MisValue, item: string): string {
  return `${label} is not measured: ${reasonSentenceFor(v.notMeasuredReason, item)}`;
}

/** B13: a counted noun agrees with its number — "1 farm", "2 farms". */
export function noun(value: number, one: string, many: string): string {
  return value === 1 ? one : many;
}

function txt(v: MisValue, kind: MisKind): string {
  return formatterOf(kind)(v.value as number);
}

export function headlineFor(section: MisSectionKey, d: CompanyMis | null, compare: boolean): string {
  if (section === 'operations') return itemByKey('operations.headline').why ?? '';
  if (d === null) return '';
  switch (section) {
    case 'overview': {
      const o = d.overview;
      const first = o.activeFarms.current.value !== null
        ? `${txt(o.activeFarms.current, 'count')} ${noun(o.activeFarms.current.value, 'farm', 'farms')} saved an entry in the 7 days to ${asOfText(d)}${changeClause(o.activeFarms, 'count', true, compare)}.`
        : notMeasuredClause('Active farms', o.activeFarms.current, 'overview.activeFarms');
      const second = o.voiceSharePct.current.value === null
        ? notMeasuredClause('The share saved by voice', o.voiceSharePct.current, 'overview.voiceShare')
        : o.logsRecorded.current.value === null
          ? notMeasuredClause('Entries saved', o.logsRecorded.current, 'overview.logsRecorded')
          : `Voice made ${txt(o.voiceSharePct.current, 'pct')} of the ${txt(o.logsRecorded.current, 'count')} ${noun(o.logsRecorded.current.value, 'entry', 'entries')} in this range.`;
      return `${first} ${second}`;
    }
    case 'acquisition': {
      const a = d.acquisition;
      const first = a.verified.current.value !== null
        ? `${txt(a.verified.current, 'count')} ${noun(a.verified.current.value, 'person', 'people')} verified their phone${changeClause(a.verified, 'count', true, compare)}.`
        : notMeasuredClause('Phone verification', a.verified.current, 'acquisition.verified');
      let second: string;
      if (a.habit.current.value === null) second = notMeasuredClause('The habit', a.habit.current, 'acquisition.habit');
      else if (a.habitEligible.current.value === null) second = notMeasuredClause('The habit', a.habitEligible.current, 'acquisition.habit');
      else if (a.habitEligible.current.value === 0) second = 'Nobody who signed up in this range is 7 days in yet, so no habit is judged.';
      else second = `${txt(a.habit.current, 'count')} of ${txt(a.habitEligible.current, 'count')} old enough to judge saved entries on 3 of their first 7 days.`;
      return `${first} ${second} Installs and channels are not measured yet.`;
    }
    case 'engagement': {
      const e = d.engagement;
      const first = e.logsPerActiveFarmPerWeek.current.value !== null
        ? `An active farm saved ${txt(e.logsPerActiveFarmPerWeek.current, 'decimal')} ${noun(e.logsPerActiveFarmPerWeek.current.value, 'entry', 'entries')} a week${changeClause(e.logsPerActiveFarmPerWeek, 'decimal', true, compare)}.`
        : notMeasuredClause('Entries per active farm', e.logsPerActiveFarmPerWeek.current, 'engagement.logsPerFarm');
      let second: string;
      if (e.whenLogged.length === 0) {
        second = notMeasuredClause('When farmers log', d.overview.logsRecorded.current, 'engagement.whenLogged');
      } else {
        const { grid, max } = heatGrid(e.whenLogged);
        if (max === 0) {
          second = 'No entry reached the server in this range, so there is no busiest hour.';
        } else {
          let row = 0;
          let hour = 0;
          grid.forEach((cells, r) => cells.forEach((v, h) => {
            if (v > grid[row][hour]) { row = r; hour = h; }
          }));
          second = `The busiest hour is ${fmtHour(hour)} on ${WEEKDAY_LONG[row]}s (when entries reached the server).`;
        }
      }
      return `${first} ${second}`;
    }
    case 'retention': {
      const r = d.retention;
      let first: string;
      if (r.d1Pct.current.value !== null && r.d30Pct.current.value !== null) {
        first = `${txt(r.d1Pct.current, 'pct')} of new sign-ups came back the next day and ${txt(r.d30Pct.current, 'pct')} were active on day 30.`;
      } else {
        const a = r.d1Pct.current.value !== null
          ? `${txt(r.d1Pct.current, 'pct')} of new sign-ups came back the next day.`
          : notMeasuredClause('Next-day return', r.d1Pct.current, 'retention.d1');
        const b = r.d30Pct.current.value !== null
          ? `${txt(r.d30Pct.current, 'pct')} were active on day 30.`
          : notMeasuredClause('Day-30 return', r.d30Pct.current, 'retention.d30');
        first = `${a} ${b}`;
      }
      const second = r.quietFarms7To29.current.value !== null
        ? `${txt(r.quietFarms7To29.current, 'count')} ${noun(r.quietFarms7To29.current.value, 'farm has', 'farms have')} gone quiet for 7–29 days and can still be won back.`
        : notMeasuredClause('Quiet farms', r.quietFarms7To29.current, 'retention.quiet');
      return `${first} ${second}`;
    }
    case 'quality': {
      const q = d.quality;
      const first = q.voiceRecordingsSavedPct.current.value !== null
        ? `${txt(q.voiceRecordingsSavedPct.current, 'pct')} of voice recordings became a saved entry${changeClause(q.voiceRecordingsSavedPct, 'pct', true, compare)}.`
        : notMeasuredClause('Voice recordings saved', q.voiceRecordingsSavedPct.current, 'quality.voiceSaved');
      const second = q.logsCorrectedPct.current.value !== null
        ? `Farmers corrected ${txt(q.logsCorrectedPct.current, 'pct')} of saved entries.`
        : notMeasuredClause('Entries corrected', q.logsCorrectedPct.current, 'quality.corrected');
      return `${first} ${second}`;
    }
    case 'farms': {
      const f = d.farms;
      let first: string;
      if (f.activeFarms.current.value !== null && f.acresCovered.current.value !== null) {
        first = `${txt(f.activeFarms.current, 'count')} ${noun(f.activeFarms.current.value, 'active farm', 'active farms')} covering ${txt(f.acresCovered.current, 'acres')} ${noun(f.acresCovered.current.value, 'acre', 'acres')}.`;
      } else if (f.activeFarms.current.value === null) {
        first = notMeasuredClause('Active farms', f.activeFarms.current, 'farms.activeFarms');
      } else {
        first = `${txt(f.activeFarms.current, 'count')} ${noun(f.activeFarms.current.value, 'active farm', 'active farms')}. ${notMeasuredClause('Acres covered', f.acresCovered.current, 'farms.acres')}`;
      }
      /* CR-2c Step 3: the district clause names what blocks it. */
      return `${first} Districts are not measured yet. ${itemByKey('farms.headline').why ?? ''}`.trim();
    }
  }
}

/** Formatting helper for the page header: "1 – 30 Nov 2026". */
export function rangeText(range: MisRange): string {
  const a = fromIsoDate(range.from);
  const b = fromIsoDate(range.to);
  if (range.from === range.to) return fmtDayYear(b);
  const da = new Date(a);
  const db = new Date(b);
  if (da.getUTCFullYear() !== db.getUTCFullYear()) return `${fmtDayYear(a)} – ${fmtDayYear(b)}`;
  if (da.getUTCMonth() === db.getUTCMonth()) return `${da.getUTCDate()} – ${fmtDayYear(b)}`;
  return `${fmtDay(a)} – ${fmtDayYear(b)}`;
}
