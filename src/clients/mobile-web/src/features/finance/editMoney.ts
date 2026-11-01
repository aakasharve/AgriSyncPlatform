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
 *     (`moneyNotFollowed.ts`). Fix pass 1 (review 4): kept PER MONEY ID, and cleared only when that money is known to be
 *     in step — a later answer names it as made or corrected, or this phone's own first money for it reaches the server
 *     (sent at the line's current amount, call C). An edit that touched no price never clears them.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

/** Why a changed line's money did not follow its edit (the server's names). */
export type MoneyNotFollowedReason =
    | 'notFound' | 'shared' | 'jobCard' | 'detailsNotHeld' | 'notAllowed' | 'idTaken'
    // fix pass 1 (review 10): a value too long for the money book.
    | 'tooLong'
    // fix pass 4: its latest correction was made in the money book, so no edit changes it.
    | 'moneyBook'
    // fix pass 5 (N4): money of a line that is gone is kept, so no new money was made beside it.
    | 'oldMoneyKept';

const REASONS: ReadonlySet<string> = new Set<MoneyNotFollowedReason>(
    ['notFound', 'shared', 'jobCard', 'detailsNotHeld', 'notAllowed', 'idTaken', 'tooLong', 'moneyBook', 'oldMoneyKept']);

/** One line whose money did not follow: the money id it has (or would have; `kind:lineId` from an answer without one) and why. */
export interface MoneyNotFollowedLine { key: string; reason: MoneyNotFollowedReason }

/** One money row as the server sends it (the fields this module relies on; the rest is kept as sent). */
interface ServerRow { id: string; [field: string]: unknown }
interface ServerCostEntry extends ServerRow { farmId: string }
interface ServerCorrection extends ServerRow { costEntryId: string }

export interface EditMoneyAnswer {
    moneyChanged: ServerCostEntry[];
    moneyCorrections: ServerCorrection[];
    notFollowed: MoneyNotFollowedLine[];
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
        const line = (row ?? {}) as { reason?: unknown; costEntryId?: unknown; kind?: unknown; lineId?: unknown };
        const reason = String(line.reason ?? '');
        const key = typeof line.costEntryId === 'string' && line.costEntryId ? line.costEntryId.toLowerCase() : `${String(line.kind)}:${String(line.lineId)}`;
        return { key, reason: (REASONS.has(reason) ? reason : 'notFound') as MoneyNotFollowedReason };
    });
    return { moneyChanged, moneyCorrections, notFollowed };
}

/** Where the reasons are kept: record id → (money id → why it is not in step), and when last written. */
const NOT_FOLLOWED_KEY = 'ofm_edit_money_not_followed_v1';
type NotFollowedMap = Record<string, { lines: Record<string, MoneyNotFollowedReason>; at: string }>;

const asMap = (value: unknown): NotFollowedMap => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const map: NotFollowedMap = {};
    for (const [logId, entry] of Object.entries(value as Record<string, unknown>)) {
        const e = (entry ?? {}) as { lines?: unknown; reasons?: unknown; at?: unknown };
        const lines = typeof e.lines === 'object' && e.lines !== null ? { ...(e.lines as Record<string, MoneyNotFollowedReason>) } : {};
        // Kept by the first build of this lane as a plain list: read as unnamed lines.
        if (Array.isArray(e.reasons)) e.reasons.forEach((reason, i) => { lines[`unnamed:${i}`] = reason as MoneyNotFollowedReason; });
        if (Object.keys(lines).length > 0) map[logId] = { lines, at: String(e.at ?? '') };
    }
    return map;
};

/** The money ids an answer says are now in step: made, corrected, or flagged with their amount as it stands. */
const inStepIds = (answer: EditMoneyAnswer): Set<string> =>
    new Set([...answer.moneyChanged.map(e => e.id), ...answer.moneyCorrections.map(c => c.costEntryId)].map(id => id.toLowerCase()));

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
            const lines = { ...(map[dailyLogId]?.lines ?? {}) };
            const inStep = inStepIds(answer);
            for (const key of Object.keys(lines)) if (inStep.has(key)) delete lines[key];
            for (const line of answer.notFollowed) lines[line.key] = line.reason;
            if (Object.keys(lines).length > 0) map[dailyLogId] = { lines, at };
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

/** Why money of this record is not in step with its edits (`[]` = none known). */
export async function readMoneyNotFollowed(dailyLogId: string): Promise<MoneyNotFollowedReason[]> {
    try {
        const map = asMap((await getDatabase().appMeta.get(NOT_FOLLOWED_KEY))?.value);
        return Object.values(map[dailyLogId]?.lines ?? {});
    } catch (error) {
        // No evidence either way: no claim — but never silently.
        console.warn('editMoney: what an edit\'s money did could not be read', error);
        return [];
    }
}

/**
 * Fix pass 1 (call C, review 4) — this phone's own first money for `costEntryId` reached the server, sent at its line's
 * current amount: that money is in step, so its "did not change" words go.
 */
export async function clearMoneyNotFollowedFor(costEntryId: string): Promise<void> {
    const id = costEntryId.toLowerCase();
    const db = getDatabase();
    await db.transaction('rw', db.appMeta, async () => {
        const map = asMap((await db.appMeta.get(NOT_FOLLOWED_KEY))?.value);
        let changed = false;
        for (const [logId, entry] of Object.entries(map)) {
            if (!(id in entry.lines)) continue;
            delete entry.lines[id];
            changed = true;
            if (Object.keys(entry.lines).length === 0) delete map[logId];
        }
        if (changed) await db.appMeta.put({ key: NOT_FOLLOWED_KEY, value: map, updatedAt: new Date().toISOString() });
    });
}
