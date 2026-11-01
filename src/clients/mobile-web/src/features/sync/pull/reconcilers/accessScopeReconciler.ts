/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a; founder D-22 / D-26) — the phone keeps ONLY what the server lets this person
 * read. Since MU-3 the server sends each person only his scope (`accessScopes`) — but a phone that pulled
 * before (any build, and every pull before a narrowing) still HOLDS what it was sent then. This reconciler
 * removes it, by a filter scan over the tables that already exist: NO Dexie version bump.
 *
 * What it removes, per the server's scopes (and nothing when the server sent none — an older server):
 *   - a farm the server no longer lists (paused, removed, never approved): the farm, its plots and crops,
 *     its records, photos, money, attendance, job cards, tests and warnings;
 *   - without SEE MONEY: the farm's cost entries (and their corrections), day ledger, job cards, money
 *     receipts — and the amounts other people's records state;
 *   - without SEE WAGES: the wage and total on other people's labour;
 *   - OWN RECORDS ONLY (a कामगार): every record someone else made, and its photos;
 *   - without attendance / tests / warnings: those rows.
 *
 * What it NEVER touches (doctrine P10 — unsynced intent is not cache): a record with a change still in the
 * outbox, a photo still uploading, anything the outbox holds, and this person's OWN records. Everything
 * removed is the server's copy; when the owner widens the scope, the next pull re-sends it (the server's
 * per-farm cursor reset). Must run inside the orchestrator's `db.transaction('rw', ...)`.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/dtos';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../types';
import { ACCESS_SCOPES_META_KEY, OUT_OF_SCOPE_FARMS_META_KEY, readAccessScopes, readOutOfScopeFarmIds } from '../../../../infrastructure/storage/accessScopeStore';
import { clearLabourReadoutsForFarm } from '../../../../infrastructure/storage/LabourReadoutCache';
import { purgeLabourCachesForFarm } from '../../../../infrastructure/storage/labourFarmAccess';
import { dayLedgerMetaKey } from '../helpers/dayLedgerMetaKey';

export interface AccessScopeContext {
    /** This phone's signed-in person; `null` = unknown, then nothing is attributed to him or removed as another's. */
    userId: string | null;
    /** Records with a change still in the outbox: never touched. `undefined` = the outbox could not be read: no record is touched. */
    pendingLogIds: Set<string> | undefined;
    receivedAtUtc: string;
}

export interface AccessScopeOutcome {
    /** `false` = the server sent no scopes (older server): nothing was done. */
    applied: boolean;
    outOfScopeFarmIds: string[];
    removedLogs: number;
    trimmedLogs: number;
    removedMoneyRows: number;
}

/** The amounts a record's bucket item states (the server's `LogContentDocument.MoneyKeys`), plus a crew's wage. */
const MONEY_KEYS = new Set(['cost', 'rentalCost', 'fuelCost', 'totalAmount', 'unitPrice', 'total', 'totalCost', 'wagePerPerson']);
const WAGE_KEYS = new Set(['wagePerPerson', 'totalCost']);
const MONEY_BUCKETS = ['cropActivities', 'irrigation', 'inputs', 'machinery', 'activityExpenses', 'labour'] as const;

/** The maker a record made on THIS phone carries until a pull brings it back with the server's id (`activeOperatorId`). */
const LOCAL_MAKER = 'owner';

const NOTHING: AccessScopeOutcome = { applied: false, outOfScopeFarmIds: [], removedLogs: 0, trimmedLogs: 0, removedMoneyRows: 0 };

export async function reconcileAccessScopes(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    ctx: AccessScopeContext,
): Promise<AccessScopeOutcome> {
    const scopes = payload.accessScopes;
    if (!Array.isArray(scopes)) return NOTHING;

    const byFarm = new Map<string, FarmAccessScopeDto>(scopes.map(s => [s.farmId, s]));
    const scopeOf = (farmId: string | null | undefined): FarmAccessScopeDto | undefined =>
        farmId ? byFarm.get(farmId) : undefined;
    const outcome: AccessScopeOutcome = { applied: true, outOfScopeFarmIds: [], removedLogs: 0, trimmedLogs: 0, removedMoneyRows: 0 };

    // ── Farms the server no longer sends ────────────────────────────────────────────────
    const heldFarmIds = new Set<string>();
    for (const farm of await db.farms.toArray()) heldFarmIds.add(farm.id);
    for (const plot of await db.plots.toArray()) heldFarmIds.add(plot.farmId);
    for (const cycle of await db.cropCycles.toArray()) heldFarmIds.add(cycle.farmId);
    const gone = [...heldFarmIds].filter(id => id && !byFarm.has(id));
    outcome.outOfScopeFarmIds = gone;
    const goneSet = new Set(gone);

    const cycleFarm = new Map<string, string>();
    for (const cycle of await db.cropCycles.toArray()) cycleFarm.set(cycle.id, cycle.farmId);

    await db.farms.bulkDelete(gone);
    await db.plots.where('farmId').anyOf(gone).delete();
    await db.cropCycles.where('farmId').anyOf(gone).delete();
    for (const task of await db.plannedTasks.toArray()) {
        const farmId = cycleFarm.get(task.cropCycleId);
        if (farmId && (goneSet.has(farmId) || scopeOf(farmId)?.seeFarmOverview === false)) {
            await db.plannedTasks.delete(task.id);
        }
    }

    // ── Money: where the farm is gone or its money is not his ───────────────────────────
    const moneyWithheld = (farmId: string) => goneSet.has(farmId) || scopeOf(farmId)?.seeMoney === false;
    const removedEntryIds: string[] = [];
    for (const entry of await db.costEntries.toArray()) {
        if (moneyWithheld(entry.farmId)) removedEntryIds.push(entry.id);
    }
    await db.costEntries.bulkDelete(removedEntryIds);
    const removedEntries = new Set(removedEntryIds);
    const corrections = (await db.financeCorrections.toArray()).filter(c => removedEntries.has(c.costEntryId)).map(c => c.id);
    await db.financeCorrections.bulkDelete(corrections);
    const ledgers = (await db.dayLedgers.toArray()).filter(l => moneyWithheld(l.farmId)).map(l => l.id);
    await db.dayLedgers.bulkDelete(ledgers);
    await db.appMeta.bulkDelete(ledgers.map(dayLedgerMetaKey));
    const jobCards = (await db.jobCards.toArray()).filter(j => moneyWithheld(j.farmId)).map(j => j.id);
    await db.jobCards.bulkDelete(jobCards);
    outcome.removedMoneyRows = removedEntryIds.length + corrections.length + ledgers.length + jobCards.length;
    await trimMirror(db, 'shramsafal_finance_cost_entries_v1', row => !moneyWithheld(String(row.farmId ?? '')), ctx.receivedAtUtc);
    await trimMirror(db, 'shramsafal_finance_corrections_v1', row => !removedEntries.has(String(row.costEntryId ?? '')), ctx.receivedAtUtc);

    // ── Attendance, tests, warnings ─────────────────────────────────────────────────────
    const withheld = (farmId: string, key: 'seeAttendance' | 'seeTests' | 'seeCompliance') =>
        goneSet.has(farmId) || scopeOf(farmId)?.[key] === false;
    await db.attendanceMarks.bulkDelete((await db.attendanceMarks.toArray()).filter(m => withheld(m.farmId, 'seeAttendance')).map(m => m.id));
    const tests = (await db.testInstances.toArray()).filter(t => withheld(t.farmId, 'seeTests')).map(t => t.id);
    await db.testInstances.bulkDelete(tests);
    await db.testRecommendations.where('testInstanceId').anyOf(tests).delete();
    await db.complianceSignals.bulkDelete((await db.complianceSignals.toArray()).filter(s => withheld(s.farmId, 'seeCompliance')).map(s => s.id));

    // ── Records: only the SERVER's copy (pulled, `serverModifiedAtUtc` set), never one with a change still
    //    queued, and never his own. A record made on this phone carries a local maker ('owner') until a pull
    //    brings it back with his server id, so "made by someone else" is only ever said of a pulled copy
    //    whose server maker is another person.
    const removedLogIds = new Set<string>();
    if (ctx.pendingLogIds) {
        for (const record of await db.logs.toArray()) {
            const log = record.log;
            const farmId = log?.meta?.farmId;
            if (!log || !farmId || !record.serverModifiedAtUtc || ctx.pendingLogIds.has(record.id)) continue;
            const maker = log.meta?.createdByOperatorId;
            const byAnother = !!ctx.userId && !!maker && maker !== ctx.userId && maker !== LOCAL_MAKER;
            const scope = scopeOf(farmId);
            if (goneSet.has(farmId) || (scope?.ownRecordsOnly && byAnother)) {
                await db.logs.delete(record.id);
                removedLogIds.add(record.id);
                outcome.removedLogs++;
                continue;
            }

            if (!scope || !byAnother) continue;
            const trimmed = !scope.seeMoney ? withoutMoney(log) : !scope.seeWages ? withoutWages(log) : log;
            if (trimmed !== log) {
                await db.logs.update(record.id, { log: trimmed });
                outcome.trimmedLogs++;
            }
        }
    }

    // ── Photos follow their parent (only the server's copies; never one still uploading) ─
    for (const attachment of await db.attachments.toArray()) {
        if (!attachment.remoteAttachmentId || attachment.status !== 'uploaded') continue;
        const queued = await db.uploadQueue.where('attachmentId').equals(attachment.id).toArray();
        if (queued.some(item => item.status !== 'completed')) continue;
        const scope = scopeOf(attachment.farmId);
        const remove = goneSet.has(attachment.farmId)
            || (attachment.linkedEntityType === 'CostEntry' && scope?.seeMoney === false)
            || (attachment.linkedEntityType === 'DailyLog' && !!attachment.linkedEntityId && removedLogIds.has(attachment.linkedEntityId));
        if (remove) await db.attachments.delete(attachment.id);
    }

    // ── The wage book this phone cached (localStorage read-out) for a farm whose wages stopped being his
    //    — gone, or see wages now off where the last answer (or no answer, before MU-3) did not say so:
    //    cleared once, so an offline open can never show a wage the server no longer sends him. A farm
    //    that is gone loses its cached crew roster too.
    const previous = new Map((await readAccessScopes(db))?.scopes.map(s => [s.farmId, s]) ?? []);
    for (const farmId of gone) purgeLabourCachesForFarm(ctx.userId, farmId);
    for (const s of scopes) {
        if (!s.seeWages && previous.get(s.farmId)?.seeWages !== false && ctx.userId) {
            clearLabourReadoutsForFarm(ctx.userId, s.farmId);
        }
    }

    // ── Remember the server's answer (the save path reads it) ───────────────────────────
    const previouslyOut = await readOutOfScopeFarmIds(db);
    const out = new Set([...previouslyOut, ...gone].filter(id => !byFarm.has(id)));
    await db.appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: ctx.receivedAtUtc, scopes }, updatedAt: ctx.receivedAtUtc });
    await db.appMeta.put({
        key: OUT_OF_SCOPE_FARMS_META_KEY,
        value: { farmIds: [...out], updatedAtUtc: ctx.receivedAtUtc },
        updatedAt: ctx.receivedAtUtc,
    });

    return outcome;
}

/** Keep only the rows of a finance mirror in `appMeta` that `keep` admits. */
async function trimMirror(
    db: AgriLogDatabase,
    key: string,
    keep: (row: Record<string, unknown>) => boolean,
    receivedAtUtc: string,
): Promise<void> {
    const row = await db.appMeta.get(key);
    if (!row || !Array.isArray(row.value)) return;
    const kept = (row.value as Record<string, unknown>[]).filter(keep);
    if (kept.length !== row.value.length) {
        await db.appMeta.put({ key, value: kept, updatedAt: receivedAtUtc });
    }
}

/** Another person's record WITHOUT the money it states: every amount in its buckets, its totals. Same log when nothing changes. */
export function withoutMoney(log: DailyLog): DailyLog {
    let changed = log.manualTotalCost !== undefined || log.financialSummary !== undefined;
    const next: Record<string, unknown> = { ...log };
    delete next.manualTotalCost;
    delete next.financialSummary;
    for (const bucket of MONEY_BUCKETS) {
        const items = (log as unknown as Record<string, unknown>)[bucket];
        if (!Array.isArray(items)) continue;
        const stripped = items.map(item => stripKeys(item, MONEY_KEYS));
        if (stripped.some((item, i) => item !== items[i])) {
            next[bucket] = stripped;
            changed = true;
        }
    }

    return changed ? (next as unknown as DailyLog) : log;
}

/** Another person's record WITHOUT the wage and total on its labour. Same log when nothing changes. */
export function withoutWages(log: DailyLog): DailyLog {
    if (!Array.isArray(log.labour)) return log;
    const labour = log.labour.map(item => stripKeys(item, WAGE_KEYS));
    return labour.some((item, i) => item !== log.labour[i]) ? { ...log, labour } as DailyLog : log;
}

/** `value` with every key in `keys` removed at any depth; the same object when none was there. */
function stripKeys<T>(value: T, keys: ReadonlySet<string>): T {
    if (Array.isArray(value)) {
        const items = value.map(item => stripKeys(item, keys));
        return items.some((item, i) => item !== value[i]) ? (items as unknown as T) : value;
    }

    if (!value || typeof value !== 'object') return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key)) {
            changed = true;
            continue;
        }

        const stripped = stripKeys(child, keys);
        if (stripped !== child) changed = true;
        next[key] = stripped;
    }

    return changed ? (next as T) : value;
}
