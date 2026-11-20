/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C) - the phone client of the season ledger of a farm's inputs
 * (`GET /shramsafal/farms/{farmId}/input-use`, its `.csv`, and `POST .../input-use/rebuild`). The server counts and works things out; the
 * phone only shows, sorts and filters what it was sent. An answer that cannot be read is never drawn (P4): no fake rows, no missing numbers.
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

export interface LedgerRow {
    inputItemId: string;
    dailyLogId: string | null;
    date: string;
    plotName: string | null;
    cropName: string | null;
    dayOfSeason: number | null;
    stageName: string | null;
    productSaid: string;
    libraryProductId: string | null;
    ingredients: string[];
    /** The same ingredients in Marathi, in the same order (null where the library holds none). */
    ingredientsMr: (string | null)[];
    groupCodes: string | null;
    amount: number | null;
    unit: string | null;
    perQuantity: number | null;
    perUnit: string | null;
    amountCertainty: string | null;
    amountSpokenText: string | null;
    method: string | null;
    carrierWaterLitres: number | null;
    derived: boolean;
}

export interface LedgerProduct { product: string; libraryProductId: string | null; uses: number; lastUsed: string; total: number | null; unit: string | null; noTotalBecause: string | null }
export interface LedgerIngredient { ingredient: string; ingredientMr: string | null; key: string | null; groupCode: string | null; uses: number }
export interface Ledger { from: string; to: string; rows: LedgerRow[]; products: LedgerProduct[]; ingredients: LedgerIngredient[]; notYetDerived: number }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reads the server's answer. `null` when it is not the shape the phone expects: nothing is drawn from half an answer. */
export function parseLedger(data: unknown): Ledger | null {
    const root = obj(data);
    if (!root || !Array.isArray(root.rows) || !Array.isArray(root.products) || !Array.isArray(root.ingredients)) return null;
    const rows: LedgerRow[] = [];
    for (const raw of root.rows) {
        const r = obj(raw);
        const date = r && str(r.date);
        const product = r && str(r.productSaid);
        if (!r || !date || !product) return null;
        rows.push({
            inputItemId: str(r.inputItemId) ?? '', dailyLogId: str(r.dailyLogId), date, plotName: str(r.plotName), cropName: str(r.cropName),
            dayOfSeason: num(r.dayOfSeason), stageName: str(r.stageName), productSaid: product, libraryProductId: str(r.libraryProductId),
            ingredients: Array.isArray(r.ingredients) ? r.ingredients.filter((i): i is string => typeof i === 'string') : [],
            ingredientsMr: Array.isArray(r.ingredientsMr) ? r.ingredientsMr.map(i => (typeof i === 'string' && i.trim() ? i : null)) : [],
            groupCodes: str(r.groupCodes), amount: num(r.amount), unit: str(r.unit), perQuantity: num(r.perQuantity), perUnit: str(r.perUnit),
            amountCertainty: str(r.amountCertainty), amountSpokenText: str(r.amountSpokenText), method: str(r.method),
            carrierWaterLitres: num(r.carrierWaterLitres), derived: r.derived === true,
        });
    }
    const products: LedgerProduct[] = root.products.flatMap(raw => {
        const p = obj(raw);
        const name = p && str(p.product);
        return p && name ? [{ product: name, libraryProductId: str(p.libraryProductId), uses: num(p.uses) ?? 0, lastUsed: str(p.lastUsed) ?? '', total: num(p.total), unit: str(p.unit), noTotalBecause: str(p.noTotalBecause) }] : [];
    });
    const ingredients: LedgerIngredient[] = root.ingredients.flatMap(raw => {
        const i = obj(raw);
        const name = i && str(i.ingredient);
        return i && name ? [{ ingredient: name, ingredientMr: str(i.ingredientMr), key: str(i.key), groupCode: str(i.groupCode), uses: num(i.uses) ?? 0 }] : [];
    });
    return { from: str(root.from) ?? '', to: str(root.to) ?? '', rows, products, ingredients, notYetDerived: num(root.notYetDerived) ?? 0 };
}

const base = (farmId: string): string => `/shramsafal/farms/${farmId}/input-use`;
const query = (from?: string, to?: string): string => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return s ? `?${s}` : '';
};

export type LedgerLoad = { kind: 'ledger'; ledger: Ledger } | { kind: 'refused' } | { kind: 'offline' } | { kind: 'failed' };

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

export async function loadLedger(farmId: string, from?: string, to?: string): Promise<LedgerLoad> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' };
    try {
        const response = await agriSyncClient.http.get<unknown>(`${base(farmId)}${query(from, to)}`);
        const ledger = parseLedger(response.data);
        return ledger ? { kind: 'ledger', ledger } : { kind: 'failed' };
    } catch (error) {
        const status = statusOf(error);
        if (status === 403 || status === 404) return { kind: 'refused' };
        return status === undefined ? { kind: 'offline' } : { kind: 'failed' };
    }
}

/** Asks the server to work out the derived rows again from the farm's saved records. Returns how many uses it derived, or `null`. */
export async function rebuildLedger(farmId: string): Promise<number | null> {
    try {
        const response = await agriSyncClient.http.post<{ derived?: unknown }>(`${base(farmId)}/rebuild`);
        return num(response.data?.derived);
    } catch {
        return null;
    }
}

/** Fetches the CSV (UTF-8 with a byte-order mark, so Excel shows Marathi) and hands it to the browser as a download. */
export async function downloadLedgerCsv(farmId: string, from?: string, to?: string): Promise<boolean> {
    try {
        const response = await agriSyncClient.http.get<Blob>(`${base(farmId)}.csv${query(from, to)}`, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `input-use-${from ?? ''}-${to ?? ''}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return true;
    } catch {
        return false;
    }
}

export type SortKey = 'date' | 'product' | 'day' | 'stage';

/** Sorts and filters what the server sent; never changes a value. A row with no day sorts last when sorting by day (P4: never a made-up 0). */
export function arrange(rows: readonly LedgerRow[], sort: SortKey, descending: boolean, filter: string): LedgerRow[] {
    const needle = filter.trim().toLowerCase();
    const kept = needle
        ? rows.filter(r => [r.productSaid, r.plotName, r.cropName, r.stageName, r.method, r.ingredients.join(' '), r.groupCodes].some(v => (v ?? '').toLowerCase().includes(needle)))
        : [...rows];
    const dir = descending ? -1 : 1;
    const text = (a: string | null, b: string | null): number => (a ?? '').localeCompare(b ?? '', 'mr');
    kept.sort((a, b) => {
        if (sort === 'day') {
            if (a.dayOfSeason === null && b.dayOfSeason === null) return 0;
            if (a.dayOfSeason === null) return 1;
            if (b.dayOfSeason === null) return -1;
            return (a.dayOfSeason - b.dayOfSeason) * dir;
        }
        const c = sort === 'product' ? text(a.productSaid, b.productSaid) : sort === 'stage' ? text(a.stageName, b.stageName) : text(a.date, b.date);
        return c * dir || text(a.date, b.date);
    });
    return kept;
}
