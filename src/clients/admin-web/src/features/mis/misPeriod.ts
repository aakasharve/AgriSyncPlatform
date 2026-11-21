/**
 * THE ONE CHOSEN RANGE, shared by all seven Company MIS pages.
 *
 * A module-level store read through `useSyncExternalStore`, so the range and
 * the compare switch survive moving between pages (the page component unmounts
 * and mounts again; the store does not). Same range = same query key = no new
 * count on the server.
 *
 * Days are India days (UTC + 05:30), the same days the server counts in.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type MisPreset = '7d' | '30d' | '90d' | 'today' | 'custom';

export interface MisPeriod {
  preset: MisPreset;
  from: string;
  to: string;
}

export const MIS_MAX_DAYS = 180;

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PRESET_DAYS: Record<Exclude<MisPreset, 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90, today: 30 };

function isoToMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return msToIso(isoToMs(iso) + days * DAY_MS);
}

/** The India date of `now` (the date of now + 05:30), yyyy-MM-dd. */
export function istToday(now: Date = new Date()): string {
  return msToIso(now.getTime() + IST_OFFSET_MS);
}

/**
 * A preset: 7, 30 or 90 days ending YESTERDAY (India time), so its last day is a whole day. Today
 * is not over, and a count of it set beside a whole day reads as a fall (fix wave W-2). Today is
 * still available as an explicit choice: the `today` preset is 30 days ending today, and its
 * last day is today so far.
 */
export function presetPeriod(preset: Exclude<MisPreset, 'custom'>, today: string): MisPeriod {
  const to = preset === 'today' ? today : addDays(today, -1);
  return { preset, from: addDays(to, -(PRESET_DAYS[preset] - 1)), to };
}

/**
 * A custom range the server will accept: it never ends after today, never
 * runs backwards, and never spans more than 180 days (the start moves up).
 */
export function clampCustom(from: string, to: string, today: string): MisPeriod {
  let toMs = isoToMs(to);
  const todayMs = isoToMs(today);
  if (!Number.isFinite(toMs) || toMs > todayMs) toMs = todayMs;
  let fromMs = isoToMs(from);
  if (!Number.isFinite(fromMs)) fromMs = toMs;
  if (fromMs > toMs) fromMs = toMs;
  const earliest = toMs - (MIS_MAX_DAYS - 1) * DAY_MS;
  if (fromMs < earliest) fromMs = earliest;
  return { preset: 'custom', from: msToIso(fromMs), to: msToIso(toMs) };
}

/** "15 Nov 2026, 2:32 pm India time". */
export function fmtIndiaTime(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return 'an unknown time';
  const d = new Date(ms + IST_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h24 < 12 ? 'am' : 'pm';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${mm} ${ampm} India time`;
}

/* ── the store ─────────────────────────────────────────────────────────── */

interface MisState {
  period: MisPeriod;
  compare: boolean;
  /** The India date the period was worked out on; a preset is worked out again when that date moves on. */
  computedOn: string;
}

let state: MisState | null = null;
const listeners = new Set<() => void>();

function initial(): MisState {
  const today = istToday();
  return { period: presetPeriod('30d', today), compare: true, computedOn: today };
}

/**
 * The range is worked out when the page opens and again when the India date changes, never kept
 * from the day the tab first loaded (fix wave W-2). A custom range is the reader's own dates and
 * is left alone. Nothing is announced from here: this runs while React reads the store.
 */
function rollIfDateMoved(current: MisState): MisState {
  const today = istToday();
  if (current.computedOn === today) return current;
  const period = current.period.preset === 'custom' ? current.period : presetPeriod(current.period.preset, today);
  return { ...current, period, computedOn: today };
}

function read(): MisState {
  state = state === null ? initial() : rollIfDateMoved(state);
  return state;
}

function write(next: MisState): void {
  state = { ...next, computedOn: istToday() };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getPeriod = () => read().period;
const getCompare = () => read().compare;

export function useMisPeriod(): [MisPeriod, (next: MisPeriod) => void] {
  const period = useSyncExternalStore(subscribe, getPeriod, getPeriod);
  /* A tab left open over midnight: when it comes back into view, the range is worked out again. */
  useEffect(() => {
    const check = () => {
      const before = state;
      const after = read();
      if (before !== after) listeners.forEach((l) => l());
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return [period, (next) => write({ ...read(), period: next })];
}

/** Compare with the period before; on by default. */
export function useMisCompare(): [boolean, (on: boolean) => void] {
  const compare = useSyncExternalStore(subscribe, getCompare, getCompare);
  return [compare, (on) => write({ ...read(), compare: on })];
}

/** Back to the last 30 days ending yesterday, compare on. */
export function resetMisPeriod(): void {
  write(initial());
}
