/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26; orchestrator call 9) — "restricting access should stop further delivery and
 * clear app-managed cached copies when the device reconnects". When the farm's primary account holder narrows who
 * sees a record, a phone that already holds it must let it go on the next sync. Two ways it learns:
 *
 *   1. the pull's `withdrawnRecords` — kind + id, nothing else — for a record it can hold whose audience changed after
 *      its cursor (the server names each one exactly once);
 *   2. a FULL pull (cursor '0': the one-time rebuild, or after a refused move) names nothing; instead it IS the whole
 *      list, so a server copy of a record on a farm the answer reads, that the answer no longer carries, is no longer
 *      his (my call: the sweep). Only records — a log, a money entry — and only copies the server sent.
 *
 * What goes with a record: a work record takes its photos (its labour, words and content live inside it); a money record
 * takes its corrections, its day-ledger rows, its photos and the bill photos it names, and leaves the money mirrors.
 *
 * What is NEVER touched (doctrine P10 — unsynced intent is not cache): a record — work or money — with a change still in
 * the outbox (a refusal parked for him to decide included), a record made on this phone and not yet acknowledged, a
 * photo still uploading, and this person's OWN records (the maker always stays: never remembered, nothing to do later).
 * A record held back for one of the other reasons is remembered (`appMeta`, no Dexie version bump) and let go on a
 * later sync — or the moment he discards the parked change (`applyPendingWithdrawals`) — once nothing holds it, unless
 * the server has sent it again meanwhile (he regained it).
 *
 * Fix pass 1 (M6): what a pull names is remembered FIRST, before anything can stop this pass (an unknown person, an
 * unreadable outbox): the cursor moves past those names, so a name not stored here would never come again.
 * `reconcileWithdrawnRecords` must run inside the orchestrator's `db.transaction('rw', ...)`.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { RecordKindName, WithdrawnRecordDto } from '../../../../infrastructure/api/recordAudienceDtos';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { AttachmentRecord } from '../../../../infrastructure/storage/DexieDatabase.types';
import { isReadableScope } from '../../../../infrastructure/storage/accessScopeStore';
import { dayLedgerMetaKey } from '../helpers/dayLedgerMetaKey';
import { readWithdrawalHolds } from '../internal/pendingMutations';

/** `appMeta` key: the withdrawals this phone could not apply yet. */
export const PENDING_WITHDRAWALS_META_KEY = 'shramsafal_withdrawn_records_pending_v1'; // gitleaks:allow (a storage name, not a secret)

export interface WithdrawnContext {
    /** This phone's signed-in person; `null` = unknown: nothing is removed (what the pull names is still remembered). */
    userId: string | null;
    /** Work records with a change still in the outbox. `undefined` = the outbox could not be read: nothing is removed. */
    pendingLogIds: Set<string> | undefined;
    /** Money records with a change still in the outbox (fix pass 1, M6). `undefined` = unreadable: nothing is removed. */
    pendingMoneyIds: Set<string> | undefined;
    receivedAtUtc: string;
    /** The pull was asked from the beginning (cursor '0'): its records are the whole list. */
    fullPull: boolean;
}

export interface WithdrawnOutcome {
    removedLogs: number;
    removedMoney: number;
    /** Records still held back (a change of his is waiting on them). */
    heldBack: number;
}

const key = (r: WithdrawnRecordDto) => `${r.kind}:${r.id}`;

export async function reconcileWithdrawnRecords(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    ctx: WithdrawnContext,
): Promise<WithdrawnOutcome> {
    // spec: plr-d10 lane L8c-1 - a task taken from its old assignee by a reassign. A plain cache copy of what the server sent:
    // removed now (his queued answers to it are refused visibly by the server, P10), unless the server sent it again.
    const sentTasks = new Set((payload.plannedWork ?? []).map(t => t.id));
    for (const r of payload.withdrawnRecords ?? []) {
        if (r?.kind === 'PlannedWork' && typeof r.id === 'string' && r.id && !sentTasks.has(r.id)) {
            await db.plannedWork.delete(r.id);
        }
    }

    const sentLogs = new Set((payload.dailyLogs ?? []).map(l => l.id));
    const sentMoney = new Set((payload.costEntries ?? []).map(c => c.id));
    const sentAgain = (r: WithdrawnRecordDto) => (r.kind === 'DailyLog' ? sentLogs : sentMoney).has(r.id);

    const wanted = new Map<string, WithdrawnRecordDto>();
    for (const r of await readPending(db)) wanted.set(key(r), r);
    for (const r of payload.withdrawnRecords ?? []) {
        if ((r?.kind === 'DailyLog' || r?.kind === 'CostEntry') && typeof r.id === 'string' && r.id) wanted.set(key(r), r);
    }
    if (ctx.fullPull) {
        for (const r of await sweepFullPull(db, payload, ctx.userId)) wanted.set(key(r), r);
    }
    // He regained it: the fresh copy stands, and the name is forgotten.
    const candidates = [...wanted.values()].filter(r => !sentAgain(r));

    if (!ctx.userId || !ctx.pendingLogIds || !ctx.pendingMoneyIds) {
        // M6 — nothing is removed without knowing who he is and what he still owes the server, but every name is kept.
        await writePending(db, candidates, ctx.receivedAtUtc);
        return { removedLogs: 0, removedMoney: 0, heldBack: candidates.length };
    }
    return applyWithdrawals(db, candidates, { userId: ctx.userId, logs: ctx.pendingLogIds, money: ctx.pendingMoneyIds, at: ctx.receivedAtUtc });
}

interface Holds { userId: string; logs: Set<string>; money: Set<string>; at: string }

async function applyWithdrawals(db: AgriLogDatabase, candidates: WithdrawnRecordDto[], holds: Holds): Promise<WithdrawnOutcome> {
    const outcome: WithdrawnOutcome = { removedLogs: 0, removedMoney: 0, heldBack: 0 };
    const stillHeld: WithdrawnRecordDto[] = [];
    for (const record of candidates) {
        const removed = record.kind === 'DailyLog'
            ? await removeLog(db, record.id, holds)
            : await removeMoney(db, record.id, holds);
        if (removed === 'held') stillHeld.push(record);
        else if (removed === 'removed' && record.kind === 'DailyLog') outcome.removedLogs++;
        else if (removed === 'removed') outcome.removedMoney++;
    }
    outcome.heldBack = stillHeld.length;
    await writePending(db, stillHeld, holds.at);
    return outcome;
}

/** The tables a withdrawal touches (`applyPendingWithdrawals` opens its own transaction on exactly these). */
const WITHDRAWAL_TABLES = (db: AgriLogDatabase) => [
    db.logs, db.attachments, db.uploadQueue, db.appMeta, db.costEntries, db.financeCorrections, db.dayLedgers,
];

/**
 * Fix pass 1 (M6) — apply the remembered withdrawals NOW (he just discarded the parked change that held a record), not
 * on the next sync. Nothing new is named here; the same holds apply (anything still owed to the server stays).
 */
export async function applyPendingWithdrawals(db: AgriLogDatabase, userId: string | null, at: string): Promise<WithdrawnOutcome> {
    const holds = await readWithdrawalHolds(db);
    if (!userId || !holds) return { removedLogs: 0, removedMoney: 0, heldBack: 0 };
    return db.transaction('rw', WITHDRAWAL_TABLES(db), async () =>
        applyWithdrawals(db, await readPending(db), { userId, logs: holds.logIds, money: holds.moneyIds, at }));
}

async function writePending(db: AgriLogDatabase, records: WithdrawnRecordDto[], at: string): Promise<void> {
    await db.appMeta.put({ key: PENDING_WITHDRAWALS_META_KEY, value: records, updatedAt: at });
}

async function readPending(db: AgriLogDatabase): Promise<WithdrawnRecordDto[]> {
    const value = (await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value;
    return Array.isArray(value)
        ? (value as WithdrawnRecordDto[]).filter(r => (r?.kind === 'DailyLog' || r?.kind === 'CostEntry') && typeof r.id === 'string')
        : [];
}

/**
 * A full pull carries every record of every farm it reads: a SERVER copy (pulled: `serverModifiedAtUtc` / a money row
 * from the server) on such a farm that the answer does not carry, and that someone else made, is no longer his.
 * Money only where the farm's money is read (otherwise MU-3's purge already owns it).
 */
async function sweepFullPull(db: AgriLogDatabase, payload: SyncPullResponse, userId: string | null): Promise<WithdrawnRecordDto[]> {
    const scopes = Array.isArray(payload.accessScopes) ? payload.accessScopes.filter(isReadableScope) : [];
    if (scopes.length === 0) return []; // an older server: the phone does not guess
    const readsRecords = new Set(scopes.filter(s => !s.ownRecordsOnly).map(s => s.farmId));
    const readsMoney = new Set(scopes.filter(s => s.seeMoney).map(s => s.farmId));
    const sentLogs = new Set((payload.dailyLogs ?? []).map(l => l.id));
    const sentMoney = new Set((payload.costEntries ?? []).map(c => c.id));
    const gone: WithdrawnRecordDto[] = [];
    for (const row of await db.logs.toArray()) {
        const farmId = row.log?.meta?.farmId;
        const maker = row.log?.meta?.createdByOperatorId;
        if (!row.serverModifiedAtUtc || !farmId || !readsRecords.has(farmId) || sentLogs.has(row.id)) continue;
        if (!maker || maker === userId) continue;
        gone.push({ kind: 'DailyLog', id: row.id });
    }
    for (const row of await db.costEntries.toArray()) {
        const entry = row.payload as { createdByUserId?: unknown } | null;
        if (!readsMoney.has(row.farmId) || sentMoney.has(row.id)) continue;
        if (!entry || entry.createdByUserId === userId) continue;
        gone.push({ kind: 'CostEntry', id: row.id });
    }
    return gone;
}

type Removal = 'removed' | 'held' | 'absent';

async function removeLog(db: AgriLogDatabase, id: string, holds: Holds): Promise<Removal> {
    const row = await db.logs.get(id);
    if (!row) return 'absent';
    // The maker always stays: nothing to remove, now or later.
    if (row.log?.meta?.createdByOperatorId === holds.userId) return 'absent';
    // P10: a change still queued (or parked for him to decide), or a record not yet acknowledged — not now.
    if (holds.logs.has(id) || !row.serverModifiedAtUtc) return 'held';
    if (await photosStillUploading(db, [id])) return 'held';
    await db.logs.delete(id);
    await removePhotos(db, a => a.linkedEntityType === 'DailyLog' && a.linkedEntityId === id);
    return 'removed';
}

async function removeMoney(db: AgriLogDatabase, id: string, holds: Holds): Promise<Removal> {
    const row = await db.costEntries.get(id);
    if (!row) return 'absent';
    const entry = row.payload as { createdByUserId?: unknown; clientAttachmentIds?: unknown } | null;
    if (entry?.createdByUserId === holds.userId) return 'absent'; // the maker always stays
    if (holds.money.has(id)) return 'held'; // M6 — a money change of his still waits on it (P10)
    const bills = new Set(Array.isArray(entry?.clientAttachmentIds) ? (entry!.clientAttachmentIds as unknown[]).filter((x): x is string => typeof x === 'string') : []);
    if (await photosStillUploading(db, [id], bills)) return 'held';
    await db.costEntries.delete(id);
    const corrections = (await db.financeCorrections.toArray()).filter(c => c.costEntryId === id).map(c => c.id);
    await db.financeCorrections.bulkDelete(corrections);
    const ledgers = (await db.dayLedgers.toArray())
        .filter(l => (l.payload as { sourceCostEntryId?: unknown } | null)?.sourceCostEntryId === id)
        .map(l => l.id);
    await db.dayLedgers.bulkDelete(ledgers);
    await db.appMeta.bulkDelete(ledgers.map(dayLedgerMetaKey));
    await removePhotos(db, a => (a.linkedEntityType === 'CostEntry' && a.linkedEntityId === id) || bills.has(a.remoteAttachmentId ?? a.id));
    await trimMirror(db, 'shramsafal_finance_cost_entries_v1', r => r.id !== id, holds.at);
    await trimMirror(db, 'shramsafal_finance_corrections_v1', r => r.costEntryId !== id, holds.at);
    return 'removed';
}

type AttachmentRow = AttachmentRecord;

/** A photo of this record (or one it names) still on its way up: the whole record waits. */
async function photosStillUploading(db: AgriLogDatabase, parentIds: string[], named: ReadonlySet<string> = new Set()): Promise<boolean> {
    const parents = new Set(parentIds);
    for (const a of await db.attachments.toArray()) {
        const mine = (a.linkedEntityId && parents.has(a.linkedEntityId)) || named.has(a.remoteAttachmentId ?? a.id);
        if (!mine) continue;
        if (!a.remoteAttachmentId || a.status !== 'uploaded') return true;
        const queued = await db.uploadQueue.where('attachmentId').equals(a.id).toArray();
        if (queued.some(item => item.status !== 'completed')) return true;
    }
    return false;
}

async function removePhotos(db: AgriLogDatabase, match: (a: AttachmentRow) => boolean): Promise<void> {
    const ids = (await db.attachments.toArray()).filter(match).map(a => a.id);
    await db.attachments.bulkDelete(ids);
}

async function trimMirror(
    db: AgriLogDatabase,
    metaKey: string,
    keep: (row: Record<string, unknown>) => boolean,
    receivedAtUtc: string,
): Promise<void> {
    const row = await db.appMeta.get(metaKey);
    if (!row || !Array.isArray(row.value)) return;
    const kept = (row.value as Record<string, unknown>[]).filter(keep);
    if (kept.length !== row.value.length) await db.appMeta.put({ key: metaKey, value: kept, updatedAt: receivedAtUtc });
}

/** For tests and the money cache: the kinds as the wire names them. */
export const WITHDRAWABLE_KINDS: readonly RecordKindName[] = ['DailyLog', 'CostEntry'];
