import { AgriLogResponse } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { LogScope, CropProfile, FarmerProfile, DailyLog } from '../../types';
import { LogFactory } from '../../core/domain/LogFactory';
import { LogsRepository } from '../ports';
import { WeatherPort } from '../ports/WeatherPort';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { runAiContractGate, isContractGateFailure } from './AiContractGate';
import { getWeatherForLocation } from '../usecases/AttachWeatherSnapshot';
import { financeService } from '../../features/finance/financeService';
import { MoneyCategory } from '../../features/finance/finance.types';

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
    ): Promise<{ success: boolean; log?: DailyLog; error?: string }>;
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
        const gateResult = runAiContractGate(response, provenance);
        if (isContractGateFailure(gateResult)) {
            throw new Error(gateResult.error);
        }

        // 1. Factory Creation
        const logs = LogFactory.createFromVoiceResult(
            gateResult.data,
            scope,
            crops,
            profile,
            undefined, // weatherStamps (enriched later)
            gateResult.provenance,
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

        // 1. Update UI State (Optimistic or Confirmed)
        if (updateState) {
            updateState(prev => [...logs, ...prev]);
        }

        // 2. Persist to Repository (Always)
        // Repo implementation determines storage (Dexie vs LocalStorage)
        await this.repo.batchSave(logs);

        // 3. Finance spine capture
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
    ): Promise<{ success: boolean; log?: DailyLog; error?: string }> {
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

    private async enrichWithWeather(logs: DailyLog[], crops: CropProfile[], profile: FarmerProfile) {
        if (!this.weatherProvider) return;

        await Promise.all(logs.map(async (log) => {
            if (log.context.selection[0].selectedPlotIds.length > 0) {
                const plotId = log.context.selection[0].selectedPlotIds[0];
                const crop = crops.find(c => c.id === log.context.selection[0].cropId);
                const plot = crop?.plots.find(p => p.id === plotId);
                if (plot) {
                    try {
                        const geo = plot.geo || { lat: profile.location?.lat || 0, lon: profile.location?.lon || 0, source: 'approx' };
                        const stamp = await getWeatherForLocation(geo, this.weatherProvider);
                        stamp.plotId = plotId;
                        log.weatherStamp = stamp;
                    } catch (e) { console.error("Weather enrichment failed", e); }
                }
            }
        }));
    }

    private captureMoneyEventsFromLog(log: DailyLog): void {
        const selection = log.context.selection?.[0];
        const cropId = selection?.cropId && selection.cropId !== 'FARM_GLOBAL' ? selection.cropId : undefined;
        const plotId = selection?.selectedPlotIds?.[0];
        const baseDateTime = (log.meta?.createdAtISO || `${log.date}T12:00:00`);
        const createdBy = log.meta?.createdByOperatorId || 'owner';

        log.labour.forEach((entry) => {
            const amount = entry.totalCost ?? ((entry.count || 0) * (entry.wagePerPerson || 0));
            if (!amount) return;
            financeService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:labour:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Labour',
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
            financeService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:input:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Input',
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
            financeService.createMoneyEventFromSource({
                type: 'VoiceLog',
                sourceId: `${log.id}:machinery:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category: 'Machinery',
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
            financeService.createMoneyEventFromSource({
                type: 'Manual',
                sourceId: `${log.id}:activity-expense:${entry.id}`,
                dateTime: baseDateTime,
                eventType: 'Expense',
                category,
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
