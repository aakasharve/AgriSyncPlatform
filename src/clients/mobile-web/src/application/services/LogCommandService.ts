import { AgriLogResponse } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { LogScope, CropProfile, FarmerProfile, DailyLog } from '../../types';
import { LogFactory } from '../../core/domain/LogFactory';
import { LogsRepository } from '../ports';
import { WeatherPort } from '../ports/WeatherPort';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { ensureLabourAssignmentIds, stampCreationFarmId } from '../../core/domain/helpers/log-factory-helpers';
import { systemClock } from '../../core/domain/services/Clock';
import { getWeatherForLocation } from '../usecases/AttachWeatherSnapshot';
import { financeCommandService } from '../../features/finance/financeCommandService';
import { MoneyCategory } from '../../features/finance/finance.types';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
// Labour Phase 2 / T2 — the use case's own response type, so the additive
// `persistedLabourCorrections` evidence survives this pass-through instead of
// being erased by a narrower inline structural type.
import type { UpdateLogResponse } from '../usecases/UpdateLog';

// Define the Service Interface
export interface LogCommandService {
    createFromVoice(
        response: AgriLogResponse,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        provenance?: LogProvenance
    ): Promise<DailyLog[]>;

    createFromManual(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile
    ): Promise<DailyLog[]>;

    confirmAndSave(
        logs: DailyLog[],
        updateState?: React.Dispatch<React.SetStateAction<DailyLog[]>>
    ): Promise<void>;

    updateLog(
        logId: string,
        updates: Partial<DailyLog>,
        profile: FarmerProfile,
        reason: string
    ): Promise<UpdateLogResponse>;
}

// Define dependencies for internal use (can be injected later)
// For now, importing singleton repositories and services directly to match current architecture patterns
// Define dependencies for internal use (can be injected later)
// Removed direct import of DexieLogsRepository to enforce boundary
import { updateLog } from '../usecases/UpdateLog';
// import { auditRepository } from '../../infrastructure/storage/AuditLogRepository'; // Deprecated Fix-07

export class LogCommandServiceImpl implements LogCommandService {

    constructor(
        private repo: LogsRepository,
        private weatherProvider?: WeatherPort
    ) { }

    /**
     * Orchestrates creating logs from Voice/AI response.
     * Includes Weather Enrichment.
     * Does NOT persist; returns Hydrated logs for review/confirmation.
     */
    async createFromVoice(
        response: AgriLogResponse,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        provenance?: LogProvenance
    ): Promise<DailyLog[]> {
        // 1. Factory Creation
        const logs = LogFactory.createFromVoiceResult(
            response,
            scope,
            crops,
            profile,
            undefined, // weatherStamps (enriched later)
            provenance,
            systemClock,
            idGenerator
        );

        // 2. Enrichment (Weather)
        await this.enrichWithWeather(logs, crops, profile);

        return logs;
    }

    /**
     * Creates logs from Manual Entry Form.
     * Includes Weather Enrichment.
     * Returns Hydrated logs.
     */
    async createFromManual(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile
    ): Promise<DailyLog[]> {

        // 1. Factory Creation
        const logs = LogFactory.createFromManualEntry(
            data,
            scope,
            crops,
            profile,
            systemClock,
            idGenerator
        );

        // 2. Enrichment
        await this.enrichWithWeather(logs, crops, profile);

        return logs;
    }

    /**
     * Persists logs to the appropriate storage (Demo vs Real).
     * Handles Batch Save.
     */
    async confirmAndSave(
        logs: DailyLog[],
        // isDemoMode removed - service is agnostic
        // mockSetter/realSetter unified
        updateState?: React.Dispatch<React.SetStateAction<DailyLog[]>>
    ): Promise<void> {

        // 1. Labour V1 Task 7.3 — mint the stable engagement id at the ONE
        // shared write boundary. All four LogFactory branches (manual+plot,
        // manual+entire-farm, voice+plot, voice+entire-farm) and the wizard
        // funnel through this method, so this single call covers every path
        // that can create a labour engagement. It MUTATES the labour events
        // in place: every caller passes its own `logs` reference on to
        // `enqueueLogsForSync` afterwards, so a copying helper would put the
        // ids in Dexie but never on the wire. Idempotent — an event that
        // already carries an id is left alone.
        ensureLabourAssignmentIds(logs, idGenerator);

        // 2. LABOUR_PHASE2 B1c — record WHICH FARM this work belongs to, now,
        //    while the answer is still a fact rather than an inference.
        //
        //    THE DEFECT THIS CLOSES. `logSyncMutationService.resolveLogFarmId`
        //    reads the farm off a PLOT. A संपूर्ण शेत log has no plot by
        //    definition, so it resolved to nothing, was never queued, and never
        //    left the handset — the farmer's eight workers stayed on the phone.
        //    The push path had no honest non-plot source to reach for, and
        //    guessing "the only farm in Dexie" on a product where multi-farm-
        //    per-login is a CORE use case is the first-plot fabrication founder
        //    decision O-1 closed, moved up a layer.
        //
        //    THE SOURCE. `SessionStore.getCurrentFarmId()` — the same
        //    synchronous, localStorage-backed farm id `FarmContext` and
        //    `switchFarm` keep in sync, and the id rendered in the
        //    `FarmContextSwitcher` pill that `AppHeader` shows on every screen.
        //    It is not a guess about the farmer's intent: it is the farm the app
        //    was displaying as the working context at the instant they saved.
        //    It is also the SAME accessor `captureMoneyEventsFromLog` below
        //    already relies on for exactly this question (Decision 3a,
        //    2026-07-19) — one answer to "which farm", not two.
        //
        //    WHY HERE. This method is the single write boundary every creating
        //    path funnels through — all four `LogFactory` branches and the
        //    wizard, which builds its own records. It runs BEFORE
        //    `repo.batchSave`, so the farm is persisted with the log, and it
        //    mutates in place, so the caller's array (which goes straight on to
        //    `enqueueLogsForSync`) carries it to the wire.
        //
        //    NOT A CAPTURE-PATH CHANGE (`P9`): no new field is asked of the
        //    farmer, nothing is prompted, and nothing blocks. A null farm
        //    context stamps nothing and the save proceeds unchanged.
        stampCreationFarmId(logs, SessionStore.getCurrentFarmId());

        // 3. Update UI State (Optimistic or Confirmed)
        if (updateState) {
            updateState(prev => [...logs, ...prev]);
        }

        // 4. Persist to Repository (Always)
        // Repo implementation determines storage (Dexie vs LocalStorage)
        await this.repo.batchSave(logs);

        // 5. Finance spine capture
        logs.forEach(log => this.captureMoneyEventsFromLog(log));
    }

    // ... properties

    // private auditRepo = auditRepository; // Deprecated Fix-07

    // ... methods

    /**
     * Updates an existing log with security checks and auditing.
     * Wraps the updateLog usecase.
     */
    async updateLog(
        logId: string,
        updates: Partial<DailyLog>,
        profile: FarmerProfile,
        reason: string
    ): Promise<UpdateLogResponse> {
        return await updateLog(
            {
                logId,
                updatedData: updates,
                actorId: profile.activeOperatorId || 'unknown',
                reason
            },
            this.repo,
            profile
        );
    }

    // --- PRIVATE HELPERS ---

    /**
     * LABOUR_PHASE2 B1b — enrich only a record that names exactly ONE plot.
     *
     * A `WeatherStamp` is a reading taken at one plot's coordinates and carries
     * that plot's id. A record naming three plots has one weather slot and no
     * single answer for it, so it states none: attaching the first plot's
     * reading would present a measurement of one place as the record's own,
     * which is the first-plot pick founder decision O-1 closed, and dropping the
     * `plotId` off the stamp would keep the number while discarding where it
     * came from (`P8`).
     *
     * KNOWN LOSS, carried deliberately: a multi-plot save no longer captures
     * weather at all, where the per-plot split used to capture one stamp per
     * plot. Holding several is a `DailyLog` shape change, not a Phase 2b edit.
     */
    private async enrichWithWeather(logs: DailyLog[], crops: CropProfile[], profile: FarmerProfile) {
        const weatherProvider = this.weatherProvider;
        if (!weatherProvider) return;

        await Promise.all(logs.map(async (log) => {
            const assertedPlotIds = log.context.selection.flatMap(entry => entry.selectedPlotIds || []);
            if (assertedPlotIds.length === 1) {
                const plotId = assertedPlotIds[0];
                const crop = crops.find(c => c.id === log.context.selection[0].cropId);
                const plot = crop?.plots.find(p => p.id === plotId);
                if (plot) {
                    try {
                        const geo = plot.geo || { lat: profile.location?.lat || 0, lon: profile.location?.lon || 0, source: 'approx' };
                        const stamp = await getWeatherForLocation(geo, weatherProvider);
                        stamp.plotId = plotId;
                        log.weatherStamp = stamp;
                    } catch (e) { console.error("Weather enrichment failed", e); }
                }
            }
        }));
    }

    private captureMoneyEventsFromLog(log: DailyLog): void {
        const selection = log.context.selection?.[0];
        // Phase 3 / Decision 3a (2026-07-19): `selection.farmId` is almost
        // never populated by LogFactory, so every call below used to fall
        // through `createMoneyEventFromSource`'s fallback chain (a STALE
        // cached event's farmId — wrong farm for a multi-farm user who just
        // switched — or the literal string 'farm_unknown' on a virgin
        // cache). Both the sync-contract's `AddCostEntryPayload.farmId` AND
        // `costEntryId` fields are `ZGuid` (bare UUID), so a non-UUID farmId
        // fails validation exactly like the `me_<uuid>` costEntryId bug:
        // silently, on-device, before the mutation ever reaches the outbox.
        // `SessionStore.getCurrentFarmId()` is the same synchronous,
        // reliably-current farm id `FarmContext`/`switchFarm` keep in sync —
        // a real fix, not another guess.
        const farmId = selection?.farmId ?? SessionStore.getCurrentFarmId() ?? undefined;

        // LABOUR_PHASE2 B1b — a money event may name a plot and a crop ONLY when
        // the record names exactly one of each.
        //
        // This read used to be `selection[0].cropId` and
        // `selection[0].selectedPlotIds[0]`, which was safe only because the
        // per-plot split guaranteed one crop and one plot per record — and it
        // was the split that had already divided the money 3/3/2 on the way in.
        // With the split gone, the same two lines would post the FULL amount
        // against the first plot alone: a farm's whole shared wage bill recorded
        // as one plot's cost, which is a worse fabrication than the one this
        // task removes.
        //
        // A multi-plot amount lives at exactly the level of aggregation the
        // farmer asserted and is excluded from every narrower filter. Splitting
        // it across plots is a Finance decision with an explicit, farmer-visible
        // strategy — `ExpenseAllocationPolicy` already exists for that, is
        // wired, and is reachable. It is not a Labour edit and never an implicit
        // default.
        const allSelections = log.context.selection || [];
        const assertedCropIds = new Set(allSelections.map(entry => entry.cropId).filter(Boolean));
        const assertedPlotIds = allSelections.flatMap(entry => entry.selectedPlotIds || []);
        const soleCropId = assertedCropIds.size === 1 ? [...assertedCropIds][0] : undefined;
        const cropId = soleCropId && soleCropId !== 'FARM_GLOBAL' ? soleCropId : undefined;
        const plotId = assertedPlotIds.length === 1 ? assertedPlotIds[0] : undefined;
        const baseDateTime = (log.meta?.createdAtISO || `${log.date}T12:00:00`);
        const createdBy = log.meta?.createdByOperatorId || 'owner';

        log.labour.forEach((entry) => {
            // NO-MULTIPLY (Decision 3a): only an EXPLICIT stated total ever
            // becomes a real expense — never a fabricated rate × count. The
            // server-side LabourAssignment governor already refuses this
            // multiply (LedgerDerivationService); this client-side capture
            // used to do the multiply anyway and sync the invented total as
            // a real CostEntry the moment the costEntryId/farmId bugs above
            // are fixed — reintroducing, in the finance ledger, the exact
            // number the farmer never said. If no total was stated, there is
            // nothing to record yet (voice review shows "—", not a guess).
            const amount = entry.totalCost;
            if (!amount) return;
            financeCommandService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:labour:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Labour',
                farmId,
                cropId,
                plotId,
                amount,
                qty: entry.count,
                unit: 'person',
                unitPrice: entry.wagePerPerson,
                notes: entry.activity,
                createdByUserId: createdBy
            });
        });

        log.inputs.forEach((entry) => {
            const amount = entry.cost;
            if (!amount) return;
            financeCommandService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:input:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Input',
                farmId,
                cropId,
                plotId,
                amount,
                qty: entry.quantity,
                unit: entry.unit,
                notes: entry.productName || entry.mix?.map(i => i.productName).join(', '),
                createdByUserId: createdBy
            });
        });

        log.machinery.forEach((entry) => {
            const amount = (entry.rentalCost || 0) + (entry.fuelCost || 0);
            if (!amount) return;
            financeCommandService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:machinery:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Machinery',
                farmId,
                cropId,
                plotId,
                amount,
                qty: entry.hoursUsed,
                unit: 'hour',
                notes: entry.type,
                createdByUserId: createdBy
            });
        });

        (log.activityExpenses || []).forEach((entry) => {
            const category = this.mapActivityExpenseCategory(entry.category);
            const amount = entry.totalAmount || 0;
            if (!amount) return;
            financeCommandService.createMoneyEventFromSource({
                type: 'Manual',
                sourceId: `${log.id}:activity-expense:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category,
                farmId,
                cropId,
                plotId,
                amount,
                vendorName: entry.vendor,
                notes: entry.reason,
                createdByUserId: createdBy
            });
        });
    }

    private mapActivityExpenseCategory(category?: string): MoneyCategory {
        const normalized = (category || '').toLowerCase();
        if (normalized.includes('labour')) return 'Labour';
        if (normalized.includes('fuel')) return 'Fuel';
        if (normalized.includes('transport')) return 'Transport';
        if (normalized.includes('machinery')) return 'Machinery';
        if (normalized.includes('repair')) return 'Repair';
        if (normalized.includes('electric')) return 'Electricity';
        if (normalized.includes('input') || normalized.includes('fertilizer') || normalized.includes('pesticide')) return 'Input';
        return 'Other';
    }
}

// Export singleton
// Export Class only - Hooks should instantiate with injected Repo
// export const logCommandService = new LogCommandServiceImpl();
