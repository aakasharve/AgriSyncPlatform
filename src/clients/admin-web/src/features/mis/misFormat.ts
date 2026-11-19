/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Company MIS — number and date formatting. Pure functions, no locale surprises:
 * dates are built from UTC parts so the preview reads the same on every machine.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const INT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 12,604 / 1,23,456 (Indian grouping — the founder reads lakh). */
export function fmtInt(v: number): string {
    return INT.format(Math.round(v));
}

/** One decimal, trimmed: 8.1 / 12 */
export function fmtDec(v: number, digits = 1): string {
    const s = v.toFixed(digits);
    return s.replace(/\.0+$/, '');
}

/** 0.712 → "71.2%"; digits default 1. */
export function fmtPct(ratio: number, digits = 1): string {
    return `${fmtDec(ratio * 100, digits)}%`;
}

/** Axis ticks: 0 / 800 / 1.2K / 12K / 1.2L (lakh). */
export function fmtCompact(v: number): string {
    const a = Math.abs(v);
    if (a >= 100_000) return `${fmtDec(v / 100_000)}L`;
    if (a >= 10_000) return `${fmtDec(v / 1000, 0)}K`;
    if (a >= 1000) return `${fmtDec(v / 1000)}K`;
    return fmtDec(v, a < 10 && a % 1 !== 0 ? 1 : 0);
}

/** 2140 ms → "2.1 s"; 640 → "640 ms". */
export function fmtMs(ms: number): string {
    return ms >= 1000 ? `${fmtDec(ms / 1000, 1)} s` : `${Math.round(ms)} ms`;
}

export function dayDate(utcMs: number): Date {
    return new Date(utcMs);
}

/** "24 Oct" */
export function fmtDay(utcMs: number): string {
    const d = dayDate(utcMs);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "24 Oct 2026" */
export function fmtDayYear(utcMs: number): string {
    const d = dayDate(utcMs);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Fri 24 Oct" */
export function fmtWeekdayDay(utcMs: number): string {
    return `${WEEKDAYS[dayDate(utcMs).getUTCDay()]} ${fmtDay(utcMs)}`;
}

/** "18 – 24 Oct" or "26 Sep – 24 Oct" (same year assumed unless it differs). */
export function fmtSpan(startMs: number, endMs: number, withYear = false): string {
    const a = dayDate(startMs);
    const b = dayDate(endMs);
    const yearB = withYear ? ` ${b.getUTCFullYear()}` : '';
    if (startMs === endMs) return `${fmtDay(endMs)}${yearB}`;
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${fmtDayYear(startMs)} – ${fmtDayYear(endMs)}`;
    if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${fmtDay(endMs)}${yearB}`;
    return `${fmtDay(startMs)} – ${fmtDay(endMs)}${yearB}`;
}

/** yyyy-mm-dd for <input type="date">. */
export function toIsoDate(utcMs: number): string {
    return new Date(utcMs).toISOString().slice(0, 10);
}

/** yyyy-mm-dd → UTC ms (NaN when invalid). */
export function fromIsoDate(iso: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return Number.NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Hour 0–23 → "6 am" / "12 pm" / "7 pm". */
export function fmtHour(h: number): string {
    if (h === 0) return '12 am';
    if (h === 12) return '12 pm';
    return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/** Signed relative change, e.g. "+12.4%" / "−3.1%". Returns null when the base is zero. */
export function fmtRelDelta(cur: number, prev: number): string | null {
    if (!prev) return null;
    const d = (cur - prev) / prev;
    const s = fmtDec(Math.abs(d) * 100, 1);
    if (s === '0') return '0%';
    return `${d > 0 ? '+' : '−'}${s}%`;
}

/** Signed percentage-point change between two ratios, e.g. "+1.2 pts". */
export function fmtPtsDelta(cur: number, prev: number): string {
    const d = (cur - prev) * 100;
    const s = fmtDec(Math.abs(d), 1);
    if (s === '0') return '0 pts';
    return `${d > 0 ? '+' : '−'}${s} pts`;
}

/**
 * A value that is ALREADY a percentage (the server sends 42.5 for 42.5%).
 * "42.5%". Never pass a ratio here, and never pass one of these to `fmtPct`.
 */
export function fmtPctPoints(v: number, digits = 1): string {
    return `${fmtDec(v, digits)}%`;
}

/** Signed difference between two values that are already percentages: "+2.5 pts" / "−1 pt" / "0 pts". */
export function fmtDeltaPoints(cur: number, prev: number): string {
    const d = cur - prev;
    const s = fmtDec(Math.abs(d), 1);
    if (s === '0') return '0 pts';
    return `${d > 0 ? '+' : '−'}${s} ${s === '1' ? 'pt' : 'pts'}`;
}
