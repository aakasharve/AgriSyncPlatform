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
import { useSyncExternalStore } from 'react';

export type MisPreset = '7d' | '30d' | '90d' | 'custom';

export interface MisPeriod {
  preset: MisPreset;
  from: string;
  to: string;
}

export const MIS_MAX_DAYS = 180;

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PRESET_DAYS: Record<Exclude<MisPreset, 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

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

/** A preset ending today: 7, 30 or 90 days including today. */
export function presetPeriod(preset: Exclude<MisPreset, 'custom'>, today: string): MisPeriod {
  return { preset, from: addDays(today, -(PRESET_DAYS[preset] - 1)), to: today };
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
}

let state: MisState | null = null;
const listeners = new Set<() => void>();

function initial(): MisState {
  return { period: presetPeriod('30d', istToday()), compare: true };
}

function read(): MisState {
  if (state === null) state = initial();
  return state;
}

function write(next: MisState): void {
  state = next;
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
  return [period, (next) => write({ ...read(), period: next })];
}

/** Compare with the period before; on by default. */
export function useMisCompare(): [boolean, (on: boolean) => void] {
  const compare = useSyncExternalStore(subscribe, getCompare, getCompare);
  return [compare, (on) => write({ ...read(), compare: on })];
}

/** Back to the last 30 days, compare on. */
export function resetMisPeriod(): void {
  write(initial());
}
