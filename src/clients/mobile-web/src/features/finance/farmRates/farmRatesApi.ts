/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * The two REST reads the दरपत्रक makes when it is online: the farm's own list as the server lets this person read it
 * (with "may I set rates", the one gate the write obeys), and ShramSafal's suggested rates. Writes never go here: they go
 * through the outbox (`SetFarmRateCommand`), so they work with no internet (P10).
 *
 * Both answers are read strictly: a body this phone cannot read is NOT taken for "no rates" or "may write" (fail closed).
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { type FarmRateRow, parseFarmRates, parseSuggestions, type RateSuggestion } from './farmRateSchema';

export interface FarmRatesAnswer {
    mayWrite: boolean;
    seeInputPrices: boolean;
    seeWorkRates: boolean;
    rates: FarmRateRow[];
    /** The rows exactly as sent (the store merges them and counts the ones it cannot read). */
    rawRates: unknown[];
    /** fix round 1 (F5) — rows of this answer the phone could not read. */
    unreadable: number;
}

/** The server's answer read strictly: only a literal `true` is a yes. */
function yes(body: Record<string, unknown>, key: string): boolean {
    return body[key] === true;
}

export function farmRatesFrom(body: unknown): FarmRatesAnswer | null {
    if (typeof body !== 'object' || body === null || !Array.isArray((body as { rates?: unknown }).rates)) return null;
    const record = body as Record<string, unknown>;
    const parsed = parseFarmRates(record.rates);
    return {
        mayWrite: yes(record, 'mayWrite'),
        seeInputPrices: yes(record, 'seeInputPrices'),
        seeWorkRates: yes(record, 'seeWorkRates'),
        rates: parsed.rows,
        rawRates: record.rates as unknown[],
        unreadable: parsed.unreadable,
    };
}

export async function fetchFarmRates(farmId: string): Promise<FarmRatesAnswer | null> {
    const response = await agriSyncClient.http.get<unknown>('/shramsafal/finance/farm-rates', { params: { farmId } });
    return farmRatesFrom(response.data);
}

export async function fetchRateSuggestions(): Promise<RateSuggestion[]> {
    const response = await agriSyncClient.http.get<unknown>('/shramsafal/finance/farm-rates/suggestions');
    const body = response.data as { suggestions?: unknown } | null;
    return parseSuggestions(body?.suggestions);
}
