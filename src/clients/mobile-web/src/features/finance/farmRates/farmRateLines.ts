/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * The farm's list as lines (one per rate), each with its CURRENT version (the highest the server numbered) and its
 * history, oldest first: who set it, when, and old → new (P3: "was X, is now Y"). Pure: no storage, no clock.
 */
import type { FarmRateRow } from './farmRateSchema';

export interface FarmRateLine {
    rateLineId: string;
    current: FarmRateRow;
    /** Every version, oldest first. */
    versions: FarmRateRow[];
}

export interface FarmRateHistoryEntry {
    version: number;
    atUtc: string;
    byUserId: string;
    /** The amount before this version (absent for the first). */
    from?: number;
    to: number;
    stopped: boolean;
    fromSuggestion: boolean;
}

/** Lines, newest change first; a stopped rate after every live one. */
export function linesOf(rows: readonly FarmRateRow[]): FarmRateLine[] {
    const byLine = new Map<string, FarmRateRow[]>();
    for (const row of rows) byLine.set(row.rateLineId, [...(byLine.get(row.rateLineId) ?? []), row]);
    const lines = [...byLine.entries()].map(([rateLineId, versions]) => {
        const sorted = [...versions].sort((a, b) => a.version - b.version);
        return { rateLineId, current: sorted[sorted.length - 1], versions: sorted };
    });
    return lines.sort((a, b) =>
        Number(a.current.retired) - Number(b.current.retired)
        || b.current.createdAtUtc.localeCompare(a.current.createdAtUtc));
}

/** Each version as a history line: who, when, old → new. */
export function historyOf(line: FarmRateLine): FarmRateHistoryEntry[] {
    return line.versions.map((v, i) => {
        const before = i > 0 ? line.versions[i - 1] : undefined;
        return {
            version: v.version,
            atUtc: v.createdAtUtc,
            byUserId: v.createdByUserId,
            ...(before ? { from: before.amount } : {}),
            to: v.amount,
            stopped: v.retired && !(before?.retired ?? false),
            fromSuggestion: !!v.suggestionId && !before?.suggestionId,
        };
    });
}
