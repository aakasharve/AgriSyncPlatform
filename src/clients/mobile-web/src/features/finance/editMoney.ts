/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89; orchestrator-agreed design) — the money an EDIT of a
 * saved record made or corrected, written on this phone the moment the server says the edit is done.
 *
 * The SERVER makes an edit's money, inside the edit (`revise_log_content`): a changed price corrects the line's money, a
 * removed line corrects it to ₹0, a newly priced line gets money under its derived id on the record's place and day. Its
 * answer (`ReviseLogContentResultDto`) names EXACTLY those rows — the entries made or corrected and the corrections written,
 * each as the pull carries them — and every changed line whose money could NOT follow, with why. So:
 *
 *   - the phone writes only those rows into its copy of the server's ledger (`costEntries`, `financeCorrections`) and its
 *     money book (the same event a pull raises): the money book shows the change, on the work's day, before any pull;
 *   - the phone never changes money on its own — an answer with no money lists writes nothing (said, never silent), and the
 *     next pull carries the same rows;
 *   - the reasons the money did not follow are kept per record, so the बदला and result screens say them plainly
 *     (`moneyNotFollowed.ts`); a later edit of the same record whose money followed clears them.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

/** Why a changed line's money did not follow its edit (the server's names). */
export type MoneyNotFollowedReason = 'notFound' | 'shared' | 'jobCard' | 'detailsNotHeld' | 'notAllowed' | 'idTaken';

const REASONS: ReadonlySet<string> = new Set<MoneyNotFollowedReason>(['notFound', 'shared', 'jobCard', 'detailsNotHeld', 'notAllowed', 'idTaken']);

/** One money row as the server sends it (the fields this module relies on; the rest is kept as sent). */
interface ServerRow { id: string; [field: string]: unknown }
interface ServerCostEntry extends ServerRow { farmId: string }
interface ServerCorrection extends ServerRow { costEntryId: string }

export interface EditMoneyAnswer {
    moneyChanged: ServerCostEntry[];
    moneyCorrections: ServerCorrection[];
    notFollowed: MoneyNotFollowedReason[];
}

const rowsOf = <T extends ServerRow>(value: unknown, key: keyof T & string): T[] | null =>
    Array.isArray(value)
        ? value.filter((row): row is T => typeof row === 'object' && row !== null
            && typeof (row as ServerRow).id === 'string' && typeof (row as Record<string, unknown>)[key] === 'string')
        : null;

/**
 * The money an edit's answer names, or `null` when the answer carries no readable money lists at all (not this answer's
 * shape). A reason this phone does not know is kept as "not found" — never dropped: the money did not follow.
 */
export function editMoneyOf(data: unknown): EditMoneyAnswer | null {
    if (typeof data !== 'object' || data === null) return null;
    const answer = data as { moneyChanged?: unknown; moneyCorrections?: unknown; moneyNotFollowed?: unknown };
    const moneyChanged = rowsOf<ServerCostEntry>(answer.moneyChanged, 'farmId');
    const moneyCorrections = rowsOf<ServerCorrection>(answer.moneyCorrections, 'costEntryId');
    if (moneyChanged === null || moneyCorrections === null || !Array.isArray(answer.moneyNotFollowed)) return null;
    const notFollowed = answer.moneyNotFollowed.map(row => {
        const reason = String((row as { reason?: unknown } | null)?.reason ?? '');
        return (REASONS.has(reason) ? reason : 'notFound') as MoneyNotFollowedReason;
    });
    return { moneyChanged, moneyCorrections, notFollowed };
}

/** Where the reasons are kept: one map of record id → the reasons its LAST applied edit gave. */
const NOT_FOLLOWED_KEY = 'ofm_edit_money_not_followed_v1';
type NotFollowedMap = Record<string, { reasons: MoneyNotFollowedReason[]; at: string }>;

const asMap = (value: unknown): NotFollowedMap =>
    (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as NotFollowedMap : {});

/** Write the money an applied edit names into this phone's ledger copy and money book; keep why any did not follow. */
export async function takeEditMoney(dailyLogId: string, data: unknown): Promise<number> {
    const answer = editMoneyOf(data);
    if (answer === null) {
        // Never a silent drop: the answer is not the shape this phone reads. Nothing is written; the next pull carries
        // the server's money as it stands.
        const shape = typeof data === 'object' && data !== null ? Object.keys(data).join(',') : typeof data;
        console.error(`[editMoney] an edit answer has no money lists (keys: ${shape}); its money comes with the next pull`);
        return 0;
    }

    const db = getDatabase();
    const at = new Date().toISOString();
    await db.transaction('rw', [db.costEntries, db.financeCorrections, db.appMeta], async () => {
        if (answer.moneyChanged.length > 0) {
            await db.costEntries.bulkPut(answer.moneyChanged.map(entry => ({ id: entry.id, farmId: entry.farmId, payload: entry, updatedAt: at })));
        }
        if (answer.moneyCorrections.length > 0) {
            await db.financeCorrections.bulkPut(answer.moneyCorrections.map(correction => ({
                id: correction.id, costEntryId: correction.costEntryId, payload: correction, updatedAt: at,
            })));
        }
        if (dailyLogId) {
            const map = asMap((await db.appMeta.get(NOT_FOLLOWED_KEY))?.value);
            if (answer.notFollowed.length > 0) map[dailyLogId] = { reasons: answer.notFollowed, at };
            else delete map[dailyLogId];
            await db.appMeta.put({ key: NOT_FOLLOWED_KEY, value: map, updatedAt: at });
        }
    });

    const written = answer.moneyChanged.length + answer.moneyCorrections.length;
    if (written > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', {
            detail: { costEntries: answer.moneyChanged, corrections: answer.moneyCorrections },
        }));
    }
    return written;
}

/** Why the money of this record's last applied edit did not follow (`[]` = it all followed, or nothing is known). */
export async function readMoneyNotFollowed(dailyLogId: string): Promise<MoneyNotFollowedReason[]> {
    try {
        const map = asMap((await getDatabase().appMeta.get(NOT_FOLLOWED_KEY))?.value);
        return map[dailyLogId]?.reasons ?? [];
    } catch (error) {
        // No evidence either way: no claim — but never silently.
        console.warn('editMoney: what an edit\'s money did could not be read', error);
        return [];
    }
}
