/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * The wire shape of ONE version of one rate of the farm's own list (`FarmRateDto` on the server): the pull's
 * `farmRates` and the REST answers of `/shramsafal/finance/farm-rates`. Each change is a NEW version the server
 * numbers (`version`); the line (`rateLineId`) is the same across versions; the newest version is current; a stopped
 * rate is a version with `retired: true` (who and when), never a deletion (P3). The author is a user id only.
 *
 * A row this phone cannot read is NOT kept as if it were valid: it is dropped from the list and counted, and the
 * caller says so (never a silent ₹ 0, P4).
 */
import { z } from 'zod';

export const FARM_RATE_KINDS = ['Input', 'Work'] as const;
export type FarmRateKind = (typeof FARM_RATE_KINDS)[number];

/** Per unit for an input price; per day / hour / acre / trip / task for work or a service (D-43). */
export const FARM_RATE_BASES = ['PerUnit', 'PerDay', 'PerHour', 'PerAcre', 'PerTrip', 'PerTask'] as const;
export type FarmRateBasis = (typeof FARM_RATE_BASES)[number];
export const WORK_BASES: readonly FarmRateBasis[] = ['PerDay', 'PerHour', 'PerAcre', 'PerTrip', 'PerTask'];

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FarmRateRowSchema = z.object({
    id: z.string().min(1),
    rateLineId: z.string().min(1),
    farmId: z.string().min(1),
    version: z.number().int().positive(),
    kind: z.enum(FARM_RATE_KINDS),
    itemName: z.string().min(1),
    unit: z.string().nullish(),
    basis: z.enum(FARM_RATE_BASES),
    workerCategory: z.string().nullish(),
    amount: z.number().positive(),
    currencyCode: z.string().min(1),
    effectiveFrom: DateKey,
    season: z.string().nullish(),
    endsOn: DateKey.nullish(),
    retired: z.boolean(),
    suggestionId: z.string().nullish(),
    createdByUserId: z.string().min(1),
    createdAtUtc: z.string().min(1),
});

export type FarmRateRow = z.infer<typeof FarmRateRowSchema>;

/** One ShramSafal suggested rate (the admin's shared list): an item and an amount only — it states no unit or kind. */
export const RateSuggestionSchema = z.object({
    id: z.string().min(1),
    itemName: z.string().min(1),
    unitPrice: z.number().positive(),
    currencyCode: z.string().min(1),
    effectiveFrom: DateKey,
});

export type RateSuggestion = z.infer<typeof RateSuggestionSchema>;

/** The rows this phone can read, and how many it could not (never kept, never shown as ₹ 0). */
export function parseFarmRates(raw: unknown): { rows: FarmRateRow[]; unreadable: number } {
    const items = Array.isArray(raw) ? raw : [];
    const rows: FarmRateRow[] = [];
    let unreadable = 0;
    for (const item of items) {
        const parsed = FarmRateRowSchema.safeParse(item);
        if (parsed.success) rows.push(parsed.data);
        else unreadable++;
    }

    return { rows, unreadable };
}

export function parseSuggestions(raw: unknown): RateSuggestion[] {
    const items = Array.isArray(raw) ? raw : [];
    return items.flatMap(item => {
        const parsed = RateSuggestionSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
    });
}
