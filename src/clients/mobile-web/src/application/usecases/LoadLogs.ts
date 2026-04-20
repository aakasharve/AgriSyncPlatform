/**
 * LoadLogs Use-Case
 *
 * Orchestrates loading/querying of DailyLog entries.
 * This is the SINGLE entry point for log retrieval.
 *
 * Query types:
 * - All logs
 * - By date
 * - By plot/crop
 * - By verification status
 * - Today's summary
 *
 * Responsibilities:
 * - Query repository
 * - Filter and aggregate results
 * - Compute derived data (counts, totals)
 */

import { DailyLog, LogVerificationStatus, CropProfile } from '../../types';
import { LogsRepository } from '../ports';
import { getDateKey, getTodayKey } from '../../core/domain/services/DateKeyService';

/**
 * Filter options for loading logs.
 */
export interface LoadLogsFilter {
    dateFrom?: string;
    dateTo?: string;
    plotIds?: string[];
    cropIds?: string[];
    verificationStatus?: LogVerificationStatus;
}

/**
 * Summary of today's activity.
 */
export interface TodaySummary {
    totalLogs: number;
    totalPlots: number;
    totalCost: number;
    pendingVerification: number;
    logsBySegment: Record<string, number>;
}

/**
 * Load all logs.
 */
export async function loadAllLogs(repository: LogsRepository): Promise<DailyLog[]> {
    return repository.getAll();
}

/**
 * Load logs for a specific date.
 */
export async function loadLogsByDate(
    repository: LogsRepository,
    date: string
): Promise<DailyLog[]> {
    return repository.getByDate(date);
}

/**
 * Load logs for today.
 */
export async function loadTodayLogs(repository: LogsRepository): Promise<DailyLog[]> {
    const today = getTodayKey();
    return repository.getByDate(today);
}

/**
 * Load logs with filters.
 */
export async function loadLogsWithFilter(
    repository: LogsRepository,
    filter: LoadLogsFilter
): Promise<DailyLog[]> {
    const allLogs = await repository.getAll();

    return allLogs.filter(log => {
        // Date range filter
        if (filter.dateFrom && log.date < filter.dateFrom) return false;
        if (filter.dateTo && log.date > filter.dateTo) return false;

        // Plot filter
        if (filter.plotIds && filter.plotIds.length > 0) {
            const logPlotIds = log.context.selection.flatMap(s => s.selectedPlotIds);
            if (!filter.plotIds.some(pid => logPlotIds.includes(pid))) return false;
        }

        // Crop filter
        if (filter.cropIds && filter.cropIds.length > 0) {
            const logCropIds = log.context.selection.map(s => s.cropId);
            if (!filter.cropIds.some(cid => logCropIds.includes(cid))) return false;
        }

        // Verification status filter
        if (filter.verificationStatus) {
            const logStatus = log.verification?.status ?? LogVerificationStatus.PENDING;
            if (logStatus !== filter.verificationStatus) return false;
        }

        return true;
    });
}

/**
 * Get summary of today's activity.
 */
export async function getTodaySummary(
    repository: LogsRepository,
    crops: CropProfile[]
): Promise<TodaySummary> {
    const todayLogs = await loadTodayLogs(repository);

    const plotIds = new Set<string>();
    let totalCost = 0;
    let pendingVerification = 0;
    const logsBySegment: Record<string, number> = {};

    todayLogs.forEach(log => {
        // Collect plot IDs
        log.context.selection.forEach(sel => {
            sel.selectedPlotIds.forEach(pid => plotIds.add(pid));
        });

        // Sum costs
        totalCost += log.financialSummary?.grandTotal || 0;

        // Count pending verification
        if (!log.verification || log.verification.status === LogVerificationStatus.PENDING) {
            pendingVerification++;
        }

        // Count by segment type
        if (log.cropActivities?.length) {
            logsBySegment['cropActivities'] = (logsBySegment['cropActivities'] || 0) + log.cropActivities.length;
        }
        if (log.irrigation?.length) {
            logsBySegment['irrigation'] = (logsBySegment['irrigation'] || 0) + log.irrigation.length;
        }
        if (log.labour?.length) {
            logsBySegment['labour'] = (logsBySegment['labour'] || 0) + log.labour.length;
        }
        if (log.inputs?.length) {
            logsBySegment['inputs'] = (logsBySegment['inputs'] || 0) + log.inputs.length;
        }
        if (log.machinery?.length) {
            logsBySegment['machinery'] = (logsBySegment['machinery'] || 0) + log.machinery.length;
        }
    });

    return {
        totalLogs: todayLogs.length,
        totalPlots: plotIds.size,
        totalCost,
        pendingVerification,
        logsBySegment
    };
}

/**
 * Get logs grouped by date for a date range.
 */
export async function loadLogsGroupedByDate(
    repository: LogsRepository,
    dateFrom: string,
    dateTo: string
): Promise<Record<string, DailyLog[]>> {
    const logs = await loadLogsWithFilter(repository, { dateFrom, dateTo });

    return logs.reduce((acc, log) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
    }, {} as Record<string, DailyLog[]>);
}
