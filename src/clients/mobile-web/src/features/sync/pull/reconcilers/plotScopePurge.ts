/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6, §11.7) — the phone keeps only what the server says this
 * person's PLOTS allow. The server sends a chosen-plots seat only his plots' rows (`accessScopes[].plotScope` /
 * `plotIds`); a phone that pulled before a narrowing still HOLDS the rest, and this removes it, by a filter scan over the
 * tables that already exist (no Dexie version bump), inside the pull's own transaction (`accessScopeReconciler`).
 *
 * The same one rule the server applies (`RecordPlaceRule`, `FarmReadScope.CoversPlot`):
 *   - his plots only: other plots, their crop seasons and planned steps, and their entries in the crop list leave;
 *   - a work or money record stays when one of its plots is his, or — whole-farm / unplaced — when he made it;
 *   - a split bill keeps only his share lines; a task, a test, a warning and an attention card stay on his plots only;
 *   - a bill photo stays only with money he keeps (or when he took it; an upload still going is never touched);
 *   - an own-work seat (and the कामगार label): nothing of other people's money either (§11.7).
 * NEVER touched (doctrine P10): a record with a change still in the outbox, anything this phone has not had back from
 * the server, and his own records. Everything removed is the server's copy; a widening re-sends it (the server's
 * per-farm cursor reset).
 */
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/dtos';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../types';
import { dayLedgerMetaKey } from '../helpers/dayLedgerMetaKey';

export interface PlotScopePurgeContext {
    userId: string | null;
    /** Records with a change still in the outbox: never touched. `undefined` = unknown: no record is touched. */
    pendingLogIds: Set<string> | undefined;
    receivedAtUtc: string;
}

export interface PlotScopePurgeOutcome {
    removedPlotIds: string[];
    removedLogIds: string[];
    removedMoneyIds: string[];
}

/** The maker a record made on THIS phone carries until a pull brings it back with the server's id. */
const LOCAL_MAKER = 'owner';

/** The plots a scope covers, or `null` for every plot (every scope but chosen plots, and an older server). */
export function coveredPlots(scope: FarmAccessScopeDto | undefined): ReadonlySet<string> | null {
    return scope?.plotScope === 'ChosenPlots' && Array.isArray(scope.plotIds) ? new Set(scope.plotIds) : null;
}

/** The plots a stored record names (none = the whole farm's). */
export function plotsOfLog(log: DailyLog | undefined): string[] {
    const selection = (log?.context as { selection?: { selectedPlotIds?: unknown }[] } | undefined)?.selection;
    return Array.isArray(selection)
        ? selection.flatMap(s => (Array.isArray(s?.selectedPlotIds) ? s.selectedPlotIds.filter((p): p is string => typeof p === 'string') : []))
        : [];
}

export async function purgeOutsidePlots(
    db: AgriLogDatabase,
    scopes: readonly FarmAccessScopeDto[],
    ctx: PlotScopePurgeContext,
): Promise<PlotScopePurgeOutcome> {
    const outcome: PlotScopePurgeOutcome = { removedPlotIds: [], removedLogIds: [], removedMoneyIds: [] };
    const chosen = new Map<string, ReadonlySet<string>>();
    const ownOnly = new Set<string>();
    for (const scope of scopes) {
        const his = coveredPlots(scope);
        if (his) chosen.set(scope.farmId, his);
        if (scope.ownRecordsOnly) ownOnly.add(scope.farmId);
    }
    if (chosen.size === 0 && ownOnly.size === 0) return outcome;
    const me = ctx.userId;
    const mine = (who: unknown) => !!me && who === me;

    // ── Plots, seasons, planned steps, the crop list ─────────────────────────────────────
    const removedCycles = new Set<string>();
    for (const [farmId, his] of chosen) {
        for (const plot of await db.plots.where('farmId').equals(farmId).toArray()) {
            const unsent = typeof plot.syncStatus === 'string' && plot.syncStatus !== 'synced';
            if (!his.has(plot.id) && !unsent) outcome.removedPlotIds.push(plot.id);
        }
        for (const cycle of await db.cropCycles.where('farmId').equals(farmId).toArray()) {
            if (!his.has(cycle.plotId)) removedCycles.add(cycle.id);
        }
    }
    await db.plots.bulkDelete(outcome.removedPlotIds);
    await removeCatalogPlots(db, new Set(outcome.removedPlotIds));
    await db.cropCycles.bulkDelete([...removedCycles]);
    if (removedCycles.size > 0) await db.plannedTasks.where('cropCycleId').anyOf([...removedCycles]).delete();

    // ── Work records (only the server's copies, never one with a change queued) ─────────
    if (ctx.pendingLogIds && chosen.size > 0) {
        for (const record of await db.logs.toArray()) {
            const log = record.log;
            const farmId = log?.meta?.farmId;
            const his = farmId ? chosen.get(farmId) : undefined;
            if (!log || !his || !record.serverModifiedAtUtc || ctx.pendingLogIds.has(record.id)) continue;
            const maker = log.meta?.createdByOperatorId;
            const plots = plotsOfLog(log);
            const keep = plots.length > 0 ? plots.some(p => his.has(p)) : (mine(maker) || maker === LOCAL_MAKER);
            if (!keep) {
                await db.logs.delete(record.id);
                outcome.removedLogIds.push(record.id);
            }
        }
    }

    // ── Money: his plots' (or, unplaced, his own); an own-work seat: his own only ────────
    const removedMoney = new Set<string>();
    for (const entry of await db.costEntries.toArray()) {
        const payload = (entry.payload ?? {}) as { plotId?: string | null; createdByUserId?: string };
        if (mine(payload.createdByUserId)) continue;
        const his = chosen.get(entry.farmId);
        const outside = his ? !(payload.plotId && his.has(payload.plotId)) : ownOnly.has(entry.farmId);
        if (outside) removedMoney.add(entry.id);
    }
    outcome.removedMoneyIds = [...removedMoney];
    await db.costEntries.bulkDelete(outcome.removedMoneyIds);
    await db.financeCorrections.bulkDelete(
        (await db.financeCorrections.toArray()).filter(c => removedMoney.has(c.costEntryId)).map(c => c.id));
    await trimFinanceMirror(db, chosen, ownOnly, me, removedMoney, ctx.receivedAtUtc);

    // A split bill: his share lines only (D-39); an own-work seat: none of another person's.
    for (const ledger of await db.dayLedgers.toArray()) {
        const payload = (ledger.payload ?? {}) as { createdByUserId?: string; allocations?: { plotId?: string }[] };
        if (mine(payload.createdByUserId)) continue;
        const his = chosen.get(ledger.farmId);
        if (!his && !ownOnly.has(ledger.farmId)) continue;
        const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
        const kept = his ? allocations.filter(a => !!a?.plotId && his.has(a.plotId)) : [];
        if (kept.length === 0) {
            await db.dayLedgers.delete(ledger.id);
            await db.appMeta.delete(dayLedgerMetaKey(ledger.id));
        } else if (kept.length < allocations.length) {
            await db.dayLedgers.put({ ...ledger, payload: { ...payload, allocations: kept } });
        }
    }

    // ── Tasks, tests, warnings, attention: his plots only ────────────────────────────────
    const offPlot = (farmId: string, plotId: string | null | undefined) => {
        const his = chosen.get(farmId);
        return !!his && !(plotId && his.has(plotId));
    };
    await db.jobCards.bulkDelete((await db.jobCards.toArray()).filter(j => offPlot(j.farmId, j.plotId)).map(j => j.id));
    const tests = (await db.testInstances.toArray()).filter(t => offPlot(t.farmId, t.plotId)).map(t => t.id);
    await db.testInstances.bulkDelete(tests);
    if (tests.length > 0) await db.testRecommendations.where('testInstanceId').anyOf(tests).delete();
    await db.complianceSignals.bulkDelete((await db.complianceSignals.toArray()).filter(s => offPlot(s.farmId, s.plotId)).map(s => s.id));
    await db.attentionCards.bulkDelete((await db.attentionCards.toArray()).filter(c => offPlot(c.farmId, c.plotId)).map(c => c.cardId));

    // ── Photos: a removed record's or money's; a bill no money he keeps names ────────────
    const removedLogs = new Set(outcome.removedLogIds);
    const keptBills = new Set<string>();
    for (const entry of await db.costEntries.toArray()) {
        const named = (entry.payload as { clientAttachmentIds?: unknown } | null)?.clientAttachmentIds;
        if (Array.isArray(named)) named.forEach(id => typeof id === 'string' && keptBills.add(id));
    }
    for (const attachment of await db.attachments.toArray()) {
        if (!attachment.remoteAttachmentId || attachment.status !== 'uploaded') continue;
        const queued = await db.uploadQueue.where('attachmentId').equals(attachment.id).toArray();
        if (queued.some(item => item.status !== 'completed')) continue;
        const parent = attachment.linkedEntityType ?? '';
        const linked = attachment.linkedEntityId ?? '';
        const placeNarrowed = chosen.has(attachment.farmId) || ownOnly.has(attachment.farmId);
        const remove = (parent === 'DailyLog' && removedLogs.has(linked))
            || (parent === 'CostEntry' && removedMoney.has(linked))
            || ((parent === 'Bill' || parent === 'Farm') && placeNarrowed
                && !keptBills.has(attachment.remoteAttachmentId) && !keptBills.has(attachment.id));
        if (remove) await db.attachments.delete(attachment.id);
    }

    return outcome;
}

/** Item 14 (MU-3) — the crop list (`crops`) loses plots that left; a crop left with no plot goes too. */
export async function removeCatalogPlots(db: AgriLogDatabase, plotIds: ReadonlySet<string>): Promise<void> {
    if (plotIds.size === 0) return;
    for (const row of await db.crops.toArray()) {
        const crop = row.data as { plots?: { id?: string }[] } | null;
        const plots = Array.isArray(crop?.plots) ? crop.plots : [];
        const kept = plots.filter(p => !p?.id || !plotIds.has(p.id));
        if (kept.length === plots.length) continue;
        if (kept.length === 0) await db.crops.delete(row.id);
        else await db.crops.put({ ...row, data: { ...crop, plots: kept } });
    }
}

/** The finance screen's mirror in `appMeta` keeps exactly the money rows the tables keep. */
async function trimFinanceMirror(
    db: AgriLogDatabase,
    chosen: ReadonlyMap<string, ReadonlySet<string>>,
    ownOnly: ReadonlySet<string>,
    me: string | null,
    removed: ReadonlySet<string>,
    receivedAtUtc: string,
): Promise<void> {
    const key = 'shramsafal_finance_cost_entries_v1'; // gitleaks:allow (a storage name, not a secret)
    const row = await db.appMeta.get(key);
    if (!row || !Array.isArray(row.value)) return;
    const rows = row.value as Record<string, unknown>[];
    const kept = rows.filter(r => {
        const farmId = String(r.farmId ?? '');
        if (removed.has(String(r.id ?? ''))) return false;
        if (!!me && r.createdByUserId === me) return true;
        const his = chosen.get(farmId);
        if (his) return typeof r.plotId === 'string' && his.has(r.plotId);
        return !ownOnly.has(farmId);
    });
    if (kept.length !== rows.length) await db.appMeta.put({ key, value: kept, updatedAt: receivedAtUtc });
}
