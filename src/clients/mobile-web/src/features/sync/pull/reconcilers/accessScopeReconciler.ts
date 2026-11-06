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
 *   - a farm the server EXPLICITLY says this person no longer reads (`status` Paused / Waiting / Removed — the
 *     server answers so only for a farm this phone named in the pull, `farms=`): the farm, its plots and crops (and
 *     the crop list's plots), its records, photos, money, attendance, job cards, tests and warnings. A farm merely
 *     ABSENT from the answer is never removed (fix 1, F9), and a farm this person registered never is;
 *   - job cards stay (the farm's work, fix 1 F7): a कामगार keeps only his own; without SEE WAGES another worker's
 *     card loses its rates and payout;
 *   - without SEE MONEY: the farm's cost entries (and their corrections), day ledger, bill and receipt photos
 *     (`Bill`, the farm-linked bills of older builds, `CostEntry`), the amounts other people's records state, and
 *     the words of another person's record that mentions money (fix 1, F3 — D-66);
 *   - without SEE WAGES: the per-person wage on other people's labour (a crew's total is MONEY, fix 1 F4), a job
 *     card's pay and its payout id (fix 2 N3), and the words of another person's record that mentions money (fix 2
 *     N4 = D-67). Every copy it trims says so (`amountsWithheld`, fix 2 N2);
 *   - OWN RECORDS ONLY (a कामगार): every record someone else made, and its photos;
 *   - without attendance / tests / warnings: those rows;
 *   - lane MU-4: outside a chosen-plots seat's PLOTS, and other people's money on an own-work seat (`plotScopePurge`).
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
import { ACCESS_SCOPES_META_KEY, OUT_OF_SCOPE_FARMS_META_KEY, isReadableScope, readAccessScopes, readOutOfScopeFarmIds } from '../../../../infrastructure/storage/accessScopeStore';
import { clearLabourReadoutsForFarm } from '../../../../infrastructure/storage/LabourReadoutCache';
import { purgeLabourCachesForFarm } from '../../../../infrastructure/storage/labourFarmAccess';
import { ApprovalSeenStore } from '../../../../infrastructure/storage/ApprovalSeenStore';
import { dayLedgerMetaKey } from '../helpers/dayLedgerMetaKey';
import { logMentionsMoney, MONEY_KEYS, textMentionsMoney, WORD_KEYS } from '../helpers/moneyMention';
import { purgeOutsidePlots, removeCatalogPlots } from './plotScopePurge';

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

/** A named worker's own pay (fix 1, F4): the crew's total is MONEY and stays with see money. */
const WAGE_KEYS = new Set(['wagePerPerson']);
const MONEY_BUCKETS = ['cropActivities', 'irrigation', 'inputs', 'machinery', 'activityExpenses', 'labour'] as const;
const WORD_BUCKETS = ['cropActivities', 'irrigation', 'inputs', 'observations', 'machinery', 'activityExpenses', 'plannedTasks', 'labour'] as const;
/** Bill and receipt photos are money (fix 1, F2): `Bill` from this build, `Farm` from every earlier bill flow. */
const MONEY_PHOTO_PARENTS = new Set(['Bill', 'Farm', 'CostEntry']);

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

    // fix 1 (F9) — only an Active entry is read as what he may see; a Paused / Waiting / Removed entry is the
    // server's explicit word that he reads nothing of that farm now.
    const byFarm = new Map<string, FarmAccessScopeDto>(scopes.filter(isReadableScope).map(s => [s.farmId, s]));
    const notReadable = new Set(scopes.filter(s => !isReadableScope(s)).map(s => s.farmId));
    const scopeOf = (farmId: string | null | undefined): FarmAccessScopeDto | undefined =>
        farmId ? byFarm.get(farmId) : undefined;
    const outcome: AccessScopeOutcome = { applied: true, outOfScopeFarmIds: [], removedLogs: 0, trimmedLogs: 0, removedMoneyRows: 0 };

    // ── Farms the server SAYS he no longer reads (fix 1, F9) ─────────────────────────────
    //    Never on a missing entry; never a farm he registered (his own farm is never taken off his phone by an
    //    answer, whatever it says), nor a farm row this phone still holds as unsent (made or changed here and not
    //    yet on the server: P10); nothing at all when this phone does not know who is signed in.
    const heldFarmIds = new Set<string>();
    const registered = new Set<string>();
    for (const farm of await db.farms.toArray()) {
        heldFarmIds.add(farm.id);
        const owner = (farm.payload as { ownerUserId?: unknown } | null)?.ownerUserId;
        const unsent = typeof farm.syncStatus === 'string' && farm.syncStatus !== 'synced';
        if ((ctx.userId && owner === ctx.userId) || unsent) registered.add(farm.id);
    }
    for (const plot of await db.plots.toArray()) heldFarmIds.add(plot.farmId);
    for (const cycle of await db.cropCycles.toArray()) heldFarmIds.add(cycle.farmId);
    const gone = ctx.userId
        ? [...heldFarmIds].filter(id => id && notReadable.has(id) && !byFarm.has(id) && !registered.has(id))
        : [];
    outcome.outOfScopeFarmIds = gone;
    const goneSet = new Set(gone);

    const cycleFarm = new Map<string, string>();
    for (const cycle of await db.cropCycles.toArray()) cycleFarm.set(cycle.id, cycle.farmId);

    const gonePlotIds = new Set((await db.plots.where('farmId').anyOf(gone).toArray()).map(p => p.id));
    await db.farms.bulkDelete(gone);
    await db.plots.where('farmId').anyOf(gone).delete();
    await removeCatalogPlots(db, gonePlotIds);
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
        // lane MU-4 fix pass 1 (M5, D-28) — his OWN submissions stay (with their status) on a farm he still reads: the server
        // sends them to every working seat. A farm that is gone takes them too.
        const own = !!ctx.userId && (entry.payload as { createdByUserId?: unknown } | null)?.createdByUserId === ctx.userId;
        if (moneyWithheld(entry.farmId) && !(own && !goneSet.has(entry.farmId))) removedEntryIds.push(entry.id);
    }
    await db.costEntries.bulkDelete(removedEntryIds);
    const removedEntries = new Set(removedEntryIds);
    const corrections = (await db.financeCorrections.toArray()).filter(c => removedEntries.has(c.costEntryId)).map(c => c.id);
    await db.financeCorrections.bulkDelete(corrections);
    const ledgers = (await db.dayLedgers.toArray()).filter(l => moneyWithheld(l.farmId)).map(l => l.id);
    await db.dayLedgers.bulkDelete(ledgers);
    await db.appMeta.bulkDelete(ledgers.map(dayLedgerMetaKey));
    // Job cards (fix 1, F7) are the farm's WORK: kept for every seat that reads the farm's work (a कामगार keeps the cards
    // assigned to him); only their pay — rates and payout, a WAGE — is taken off another worker's card without see wages.
    const jobCards: string[] = [];
    for (const card of await db.jobCards.toArray()) {
        const scope = scopeOf(card.farmId);
        const his = !!ctx.userId && card.assignedWorkerUserId === ctx.userId;
        if (goneSet.has(card.farmId) || (scope?.ownRecordsOnly && !his)) {
            jobCards.push(card.id);
        } else if (scope && !scope.seeWages && !his && (card.estimatedTotalAmount != null || card.payoutCostEntryId
            || card.lineItems?.some(i => i.ratePerHourAmount != null || textMentionsMoney(i.notes))
            || textMentionsMoney(card.cancellationReason))) {
            // Fix 2 (N3): the payout's money-entry id goes with the pay (that entry reaches every see-money seat, so the
            // id would join a named worker to what he was paid); a line's own words that name money go whole (N4).
            const next: Record<string, unknown> = {
                ...card,
                estimatedTotalAmount: null,
                lineItems: (card.lineItems ?? []).map(i => {
                    const line: Record<string, unknown> = { ...i, ratePerHourAmount: null };
                    if (textMentionsMoney(i.notes)) delete line.notes;
                    return line;
                }),
            };
            delete next.payoutCostEntryId;
            if (textMentionsMoney(card.cancellationReason)) delete next.cancellationReason;
            await db.jobCards.put(next as never);
        }
    }
    await db.jobCards.bulkDelete(jobCards);
    outcome.removedMoneyRows = removedEntryIds.length + corrections.length + ledgers.length + jobCards.length;
    await trimMirror(db, 'shramsafal_finance_cost_entries_v1', row => !removedEntries.has(String(row.id ?? ''))
        && (!moneyWithheld(String(row.farmId ?? '')) || (!!ctx.userId && row.createdByUserId === ctx.userId && !goneSet.has(String(row.farmId ?? '')))), ctx.receivedAtUtc);
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
            // F3 / fix 2 N4 (D-67) — asked of the copy as held, BEFORE its amounts are removed: the words of a record that
            // mentions money stay only with see WAGES (a named worker's pay can be in them).
            const wordsForMoney = !scope.seeWages && logMentionsMoney(log) && !alreadyWithoutWords(log);
            const stripped = !scope.seeMoney ? withoutMoney(log) : !scope.seeWages ? withoutWages(log) : log;
            // Fix 2 (N2): a copy the purge trimmed SAYS so, so an edit of it never reads the missing amounts as deleted.
            const priced = stripped === log ? log : ({ ...stripped, amountsWithheld: true } as DailyLog);
            const trimmed = wordsForMoney ? withoutWords(priced) : priced;
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
            || (MONEY_PHOTO_PARENTS.has(attachment.linkedEntityType ?? '') && scope?.seeMoney === false)
            || (attachment.linkedEntityType === 'DailyLog' && !!attachment.linkedEntityId && removedLogIds.has(attachment.linkedEntityId));
        if (remove) await db.attachments.delete(attachment.id);
    }

    // ── spec: plr-d10 lane MU-4 — and his PLOTS (a chosen-plots seat), his own work's money (an own-work seat) ──
    const placed = await purgeOutsidePlots(db, [...byFarm.values()], ctx);
    outcome.removedLogs += placed.removedLogIds.length;
    outcome.removedMoneyRows += placed.removedMoneyIds.length;

    // ── The wage book this phone cached (localStorage read-out) for a farm whose wages stopped being his
    //    — gone, or see wages now off where the last answer (or no answer, before MU-3) did not say so:
    //    cleared once, so an offline open can never show a wage the server no longer sends him. A farm
    //    that is gone loses its cached crew roster too.
    const previous = new Map((await readAccessScopes(db))?.scopes.map(s => [s.farmId, s]) ?? []);
    for (const farmId of gone) purgeLabourCachesForFarm(ctx.userId, farmId);
    // Item 14 — other people's names: a person who now reads no farm's team (every farm he still reads is his own
    // records only) keeps only himself in the profile's people list.
    const readsATeam = [...byFarm.values()].some(s => !s.ownRecordsOnly);
    if (ctx.userId && !readsATeam && (gone.length > 0 || byFarm.size > 0)) {
        await keepOnlySelfInProfile(db, ctx.userId);
    }
    for (const s of scopes) {
        if (!s.seeWages && previous.get(s.farmId)?.seeWages !== false && ctx.userId) {
            clearLabourReadoutsForFarm(ctx.userId, s.farmId);
        }
        // lane L4b fix round 2 (L-b) — the amounts he saw in the approval sheet go with the farm's money.
        if (!s.seeMoney && ctx.userId) ApprovalSeenStore.dropAmounts(ctx.userId, s.farmId);
    }

    // ── Remember the server's answer (the save path reads it) ───────────────────────────
    const previouslyOut = await readOutOfScopeFarmIds(db);
    const out = new Set([...previouslyOut, ...gone, ...[...notReadable].filter(id => !registered.has(id))]
        .filter(id => !byFarm.has(id)));
    await db.appMeta.put({ key: ACCESS_SCOPES_META_KEY, value: { receivedAtUtc: ctx.receivedAtUtc, scopes }, updatedAt: ctx.receivedAtUtc });
    await db.appMeta.put({
        key: OUT_OF_SCOPE_FARMS_META_KEY,
        value: { farmIds: [...out], updatedAtUtc: ctx.receivedAtUtc },
        updatedAt: ctx.receivedAtUtc,
    });

    return outcome;
}

/** Item 14 — the profile's people list keeps only this person (the server sends a कामगार no other name). */
async function keepOnlySelfInProfile(db: AgriLogDatabase, userId: string): Promise<void> {
    const row = await db.farmerProfile.get('self');
    const profile = row?.data as { operators?: { id?: string }[] } | undefined;
    if (!row || !profile || !Array.isArray(profile.operators)) return;
    const kept = profile.operators.filter(o => o?.id === userId);
    if (kept.length !== profile.operators.length) {
        await db.farmerProfile.put({ ...row, data: { ...profile, operators: kept } });
    }
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
        const stripped = items.map(item => (bucket === 'labour' ? markLabourWithheld(item, true) : stripKeys(item, MONEY_KEYS)));
        if (stripped.some((item, i) => item !== items[i])) {
            next[bucket] = stripped;
            changed = true;
        }
    }

    return changed ? (next as unknown as DailyLog) : log;
}

/** Already trimmed of its words by an earlier pass (nothing left to take): not written again. */
function alreadyWithoutWords(log: DailyLog): boolean {
    return log.wordsWithheldForMoney === true && log.fullTranscript === undefined;
}

/**
 * F3 (D-66) — another person's record that mentions money, WITHOUT his words: the transcript, each item's phrase,
 * Sathi's restatement, notes and descriptions are removed WHOLE (never cut), and the record says why. The work stays.
 */
export function withoutWords(log: DailyLog): DailyLog {
    const next: Record<string, unknown> = { ...log, wordsWithheldForMoney: true };
    delete next.fullTranscript;
    delete next.transcriptSnapshot;
    for (const bucket of WORD_BUCKETS) {
        const items = (log as unknown as Record<string, unknown>)[bucket];
        if (Array.isArray(items)) next[bucket] = items.map(item => stripKeys(item, WORD_KEYS));
    }
    const disturbance = (log as unknown as Record<string, unknown>).disturbance;
    if (disturbance && typeof disturbance === 'object') next.disturbance = stripKeys(disturbance, WORD_KEYS);
    return next as unknown as DailyLog;
}

/** Another person's record WITHOUT the per-person wage on its labour (a WAGE). Same log when nothing changes. */
export function withoutWages(log: DailyLog): DailyLog {
    if (!Array.isArray(log.labour)) return log;
    const labour = log.labour.map(item => markLabourWithheld(item, false));
    return labour.some((item, i) => item !== log.labour[i]) ? { ...log, labour } as DailyLog : log;
}

/**
 * F10 — one crew WITHOUT its per-person wage (and, without see money, its total), each stated amount marked as held
 * back by rule (`wageWithheld` / `totalCostWithheld`), never left reading "not stated". Same item when nothing changes.
 */
function markLabourWithheld<T>(item: T, money: boolean): T {
    if (!item || typeof item !== 'object') return item;
    const crew = item as Record<string, unknown>;
    const stated = (key: string) => crew[key] !== undefined && crew[key] !== null;
    const stripped = stripKeys(item, money ? MONEY_KEYS : WAGE_KEYS) as Record<string, unknown>;
    if ((stripped as unknown) === item) return item;
    return {
        ...stripped,
        ...(stated('wagePerPerson') && { wageWithheld: true }),
        ...(money && stated('totalCost') && { totalCostWithheld: true }),
    } as T;
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
