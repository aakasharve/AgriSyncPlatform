import {
    CropProfile,
    DailyLog,
    LogVerificationStatus,
    PlannedTask
} from '../../types';
import {
    calculateDayNumber,
    derivePlannedItemsForDay,
    derivePlannedItemsForStage,
    getCurrentStage,
    getScheduleById,
    getStageStartDay,
    getTemplateForCrop
} from '../../domain/planning/PlanEngine';
import { getDateKey } from '../../domain/system/DateKeyService';

type OperationCategory = 'IRRIGATION' | 'FERTIGATION' | 'FOLIAR_SPRAY' | 'ACTIVITY';

export type DayRiskStatus = 'stable' | 'risk_rising';

export interface DayState {
    date: string;
    plannedCount: number;
    completedCount: number;
    pendingCount: number;
    verifiedCount: number;
    unverifiedCount: number;
    closurePercent: number;
    isClosed: boolean;
    riskStatus: DayRiskStatus;
    riskSignals: string[];
    lastActions: {
        sprayDaysAgo: number | null;
        irrigationDaysAgo: number | null;
    };
}

export interface CostRunningSnapshot {
    today: number;
    week: number;
    cropSoFar: number;
    perAcreRunning: number;
    spendVelocityWeek: number;
    unverifiedToday: number;
    unverifiedTotal: number;
}

export interface VerificationMetrics {
    verificationStreakDays: number;
    trustedDaysThisMonth: number;
    monthLength: number;
}

interface ScopeOptions {
    selectedCropIds?: string[];
    selectedPlotIds?: string[];
}

interface DayStateOptions extends ScopeOptions {
    logs: DailyLog[];
    crops: CropProfile[];
    tasks?: PlannedTask[];
    date?: string;
}

interface CostRunningOptions extends ScopeOptions {
    logs: DailyLog[];
    crops: CropProfile[];
    date?: string;
}

const VERIFIED_STATUSES = new Set<LogVerificationStatus>([
    LogVerificationStatus.VERIFIED,
    LogVerificationStatus.APPROVED
]);

const FARM_GLOBAL = 'FARM_GLOBAL';

const normalizeDateKey = (value: string | Date): string => {
    if (value instanceof Date) return getDateKey(value);
    if (value.includes('T')) return value.split('T')[0];
    return value;
};

const toDate = (dateKey: string): Date => {
    return new Date(`${dateKey}T12:00:00`);
};

const isSprayInput = (input: { method?: string; type?: string }): boolean => {
    const method = (input.method || '').toLowerCase();
    const type = (input.type || '').toLowerCase();
    return method === 'spray' || type === 'pesticide' || type === 'fungicide';
};

const logHasCategoryWork = (log: DailyLog, category: OperationCategory): boolean => {
    if (category === 'IRRIGATION') return (log.irrigation?.length || 0) > 0;
    if (category === 'FERTIGATION') {
        return (log.inputs || []).some(input => !isSprayInput(input));
    }
    if (category === 'FOLIAR_SPRAY') {
        if ((log.inputs || []).some(input => isSprayInput(input))) return true;
        return (log.cropActivities || []).some(activity =>
            (activity.title || '').toLowerCase().includes('spray')
        );
    }

    return (log.cropActivities?.length || 0) > 0
        || (log.labour?.length || 0) > 0
        || (log.machinery?.length || 0) > 0;
};

const logInScope = (log: DailyLog, scope?: ScopeOptions): boolean => {
    if (!scope) return true;
    const selectedCropIds = scope.selectedCropIds || [];
    const selectedPlotIds = scope.selectedPlotIds || [];
    const selections = log.context?.selection || [];

    if (selectedCropIds.length > 0) {
        const hasCrop = selections.some(selection => selectedCropIds.includes(selection.cropId));
        if (!hasCrop) return false;
    }

    if (selectedPlotIds.length > 0) {
        const hasPlot = selections.some(selection =>
            (selection.selectedPlotIds || []).some(plotId => selectedPlotIds.includes(plotId))
        );
        if (!hasPlot) return false;
    }

    return true;
};

const getScopePlots = (crops: CropProfile[], scope?: ScopeOptions) => {
    const selectedCropIds = (scope?.selectedCropIds || []).filter(id => id !== FARM_GLOBAL);
    const selectedPlotIds = scope?.selectedPlotIds || [];

    return crops.flatMap(crop => {
        if (selectedCropIds.length > 0 && !selectedCropIds.includes(crop.id)) return [];
        return crop.plots.filter(plot =>
            selectedPlotIds.length === 0 || selectedPlotIds.includes(plot.id)
        ).map(plot => ({ crop, plot }));
    });
};

const getExecutionCountByCategory = (logs: DailyLog[], category: OperationCategory): number => {
    if (category === 'IRRIGATION') {
        return logs.reduce((sum, log) => sum + (log.irrigation?.length || 0), 0);
    }

    if (category === 'FERTIGATION') {
        return logs.reduce((sum, log) =>
            sum + (log.inputs || []).filter(input => !isSprayInput(input)).length
            , 0);
    }

    if (category === 'FOLIAR_SPRAY') {
        return logs.reduce((sum, log) =>
            sum + (log.inputs || []).filter(input => isSprayInput(input)).length
            , 0);
    }

    return logs.reduce((sum, log) =>
        sum + (log.cropActivities?.length || 0) + (log.labour?.length || 0) + (log.machinery?.length || 0)
        , 0);
};

const getDaysBetween = (fromDateKey: string, toDateKey: string): number => {
    const from = toDate(fromDateKey);
    const to = toDate(toDateKey);
    const diffMs = from.getTime() - to.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

const getAreaInAcres = (value?: number, unit?: string): number => {
    if (!value || value <= 0) return 0;
    if (unit === 'Acre') return value;
    if (unit === 'Guntha') return value * 0.025;
    if (unit === 'Are') return value * 0.0247;
    return value;
};

const getTotalScopedAreaInAcres = (crops: CropProfile[], scope?: ScopeOptions): number => {
    return getScopePlots(crops, scope).reduce((sum, item) => {
        return sum + getAreaInAcres(item.plot.baseline?.totalArea, item.plot.baseline?.unit);
    }, 0);
};

const getLastActionDaysAgo = (
    logs: DailyLog[],
    dateKey: string,
    scope: ScopeOptions | undefined,
    category: 'spray' | 'irrigation'
): number | null => {
    const scopedLogs = logs
        .filter(log => logInScope(log, scope))
        .filter(log => normalizeDateKey(log.date) <= dateKey)
        .sort((a, b) => normalizeDateKey(b.date).localeCompare(normalizeDateKey(a.date)));

    const targetLog = scopedLogs.find(log => {
        if (category === 'irrigation') return (log.irrigation?.length || 0) > 0;
        return logHasCategoryWork(log, 'FOLIAR_SPRAY');
    });

    if (!targetLog) return null;
    return getDaysBetween(dateKey, normalizeDateKey(targetLog.date));
};

const getOverdueStageSignal = (
    logs: DailyLog[],
    crops: CropProfile[],
    dateKey: string,
    scope?: ScopeOptions
): string | null => {
    const scopedPlots = getScopePlots(crops, scope);
    const dayDate = toDate(dateKey);

    for (const item of scopedPlots) {
        const { crop, plot } = item;
        if (!plot.schedule) continue;

        const template =
            getScheduleById(crop.activeScheduleId || '')
            || getScheduleById(plot.schedule.templateId || '')
            || getTemplateForCrop(crop.name);

        if (!template) continue;

        const referenceDate = plot.schedule.referenceDate || plot.startDate || dateKey;
        const currentDay = calculateDayNumber(referenceDate, dayDate);
        const currentStage = getCurrentStage(template, plot.schedule, currentDay);
        if (!currentStage) continue;

        const stageItems = derivePlannedItemsForStage(template, plot.schedule, currentStage.id);
        const overdueItems = stageItems.filter(stageItem =>
            stageItem.dueDate !== undefined && stageItem.dueDate < currentDay
        );
        if (overdueItems.length === 0) continue;

        const stageStartDay = getStageStartDay(currentStage, plot.schedule);
        const stageStartDate = new Date(toDate(referenceDate));
        stageStartDate.setDate(stageStartDate.getDate() + stageStartDay);

        const stageLogs = logs
            .filter(log => logInScope(log, { selectedPlotIds: [plot.id] }))
            .filter(log => {
                const logDate = toDate(normalizeDateKey(log.date));
                return logDate >= stageStartDate && logDate <= dayDate;
            });

        const overdueByCategory = overdueItems.reduce<Record<OperationCategory, number>>((acc, stageItem) => {
            const category = stageItem.category as OperationCategory;
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {
            IRRIGATION: 0,
            FERTIGATION: 0,
            FOLIAR_SPRAY: 0,
            ACTIVITY: 0
        });

        const category = (Object.keys(overdueByCategory) as OperationCategory[]).find(candidate => {
            if ((overdueByCategory[candidate] || 0) === 0) return false;
            const executed = getExecutionCountByCategory(stageLogs, candidate);
            return executed < overdueByCategory[candidate];
        });

        if (!category) continue;

        const delayedItem = overdueItems.find(overdueItem => overdueItem.category === category);
        if (!delayedItem || delayedItem.dueDate === undefined) continue;

        const daysOverdue = Math.max(1, currentDay - delayedItem.dueDate);
        return `${delayedItem.name} window closing (${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue)`;
    }

    return null;
};

const getTaskCompletion = (tasks: PlannedTask[], dateKey: string, scope?: ScopeOptions) => {
    const scopedTasks = tasks.filter(task => {
        if (scope?.selectedCropIds?.length && task.cropId && !scope.selectedCropIds.includes(task.cropId)) {
            return false;
        }
        if (scope?.selectedPlotIds?.length && !scope.selectedPlotIds.includes(task.plotId)) {
            return false;
        }

        if (!task.dueDate) return false;
        return task.dueDate <= dateKey;
    }).filter(task => task.status !== 'cancelled');

    const completed = scopedTasks.filter(task => task.status === 'done').length;
    return {
        planned: scopedTasks.length,
        completed,
        pending: Math.max(0, scopedTasks.length - completed)
    };
};

const clampPercent = (value: number): number => {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

export const isLogVerified = (log: DailyLog): boolean => {
    const status = log.verification?.status;
    if (!status) return false;
    return VERIFIED_STATUSES.has(status);
};

export const isLogUnverified = (log: DailyLog): boolean => !isLogVerified(log);

export const computeDayState = ({
    logs,
    crops,
    tasks = [],
    date = getDateKey(),
    selectedCropIds,
    selectedPlotIds
}: DayStateOptions): DayState => {
    const dateKey = normalizeDateKey(date);
    const scope: ScopeOptions = { selectedCropIds, selectedPlotIds };
    const scopedLogs = logs.filter(log => logInScope(log, scope));
    const dayLogs = scopedLogs.filter(log => normalizeDateKey(log.date) === dateKey);

    const scopedPlots = getScopePlots(crops, scope);
    const plannedByKey = new Map<string, number>();
    const executedByKey = new Map<string, number>();

    scopedPlots.forEach(item => {
        const { crop, plot } = item;
        if (!plot.schedule) return;

        const template =
            getScheduleById(crop.activeScheduleId || '')
            || getScheduleById(plot.schedule.templateId || '')
            || getTemplateForCrop(crop.name);

        if (!template) return;

        const referenceDate = plot.schedule.referenceDate || plot.startDate || dateKey;
        const dayNumber = calculateDayNumber(referenceDate, dateKey);
        const dailyPlan = derivePlannedItemsForDay(template, plot.schedule, dayNumber);

        dailyPlan.plannedItems.forEach(planItem => {
            const category = (planItem.category || 'ACTIVITY') as OperationCategory;
            const planKey = `${plot.id}|${category}`;
            plannedByKey.set(planKey, (plannedByKey.get(planKey) || 0) + 1);
        });

        const plotLogs = dayLogs.filter(log =>
            log.context.selection.some(selection => (selection.selectedPlotIds || []).includes(plot.id))
        );

        (['IRRIGATION', 'FERTIGATION', 'FOLIAR_SPRAY', 'ACTIVITY'] as OperationCategory[]).forEach(category => {
            const executionCount = getExecutionCountByCategory(plotLogs, category);
            executedByKey.set(`${plot.id}|${category}`, executionCount);
        });
    });

    let plannedFromSchedule = 0;
    let doneFromSchedule = 0;
    plannedByKey.forEach((plannedCount, key) => {
        plannedFromSchedule += plannedCount;
        doneFromSchedule += Math.min(plannedCount, executedByKey.get(key) || 0);
    });

    const taskCompletion = getTaskCompletion(tasks, dateKey, scope);
    const plannedCount = plannedFromSchedule + taskCompletion.planned;
    const completedCount = doneFromSchedule + taskCompletion.completed;
    const pendingCount = Math.max(0, plannedCount - completedCount);

    const verifiedCount = dayLogs.filter(log => isLogVerified(log)).length;
    const unverifiedCount = Math.max(0, dayLogs.length - verifiedCount);

    const taskScore = plannedCount === 0 ? 1 : completedCount / plannedCount;
    const verificationScore = dayLogs.length === 0 ? 1 : verifiedCount / dayLogs.length;
    const closurePercent = clampPercent((taskScore * 70) + (verificationScore * 30));
    const isClosed = pendingCount === 0 && unverifiedCount === 0;

    const sprayDaysAgo = getLastActionDaysAgo(scopedLogs, dateKey, scope, 'spray');
    const irrigationDaysAgo = getLastActionDaysAgo(scopedLogs, dateKey, scope, 'irrigation');

    const riskSignals: string[] = [];
    if (pendingCount > 0) {
        riskSignals.push(`${pendingCount} planned activities pending`);
    }
    if (sprayDaysAgo !== null && sprayDaysAgo > 10) {
        riskSignals.push(`Spray delayed (${sprayDaysAgo} days since last spray)`);
    }
    if (irrigationDaysAgo !== null && irrigationDaysAgo > 3) {
        riskSignals.push(`Irrigation gap increasing (${irrigationDaysAgo} days since last irrigation)`);
    }

    const overdueStageSignal = getOverdueStageSignal(logs, crops, dateKey, scope);
    if (overdueStageSignal) {
        riskSignals.push(overdueStageSignal);
    }

    return {
        date: dateKey,
        plannedCount,
        completedCount,
        pendingCount,
        verifiedCount,
        unverifiedCount,
        closurePercent,
        isClosed,
        riskStatus: riskSignals.length > 0 ? 'risk_rising' : 'stable',
        riskSignals,
        lastActions: {
            sprayDaysAgo,
            irrigationDaysAgo
        }
    };
};

export const computeCostRunning = ({
    logs,
    crops,
    date = getDateKey(),
    selectedCropIds,
    selectedPlotIds
}: CostRunningOptions): CostRunningSnapshot => {
    const dateKey = normalizeDateKey(date);
    const scope: ScopeOptions = { selectedCropIds, selectedPlotIds };
    const scopedLogs = logs.filter(log => logInScope(log, scope));

    const todayCost = scopedLogs
        .filter(log => normalizeDateKey(log.date) === dateKey)
        .reduce((sum, log) => sum + (log.financialSummary?.grandTotal || 0), 0);

    const targetDate = toDate(dateKey);
    const weekStart = new Date(targetDate);
    weekStart.setDate(targetDate.getDate() - 6);

    const weekCost = scopedLogs.filter(log => {
        const logDate = toDate(normalizeDateKey(log.date));
        return logDate >= weekStart && logDate <= targetDate;
    }).reduce((sum, log) => sum + (log.financialSummary?.grandTotal || 0), 0);

    const cropSoFarCost = scopedLogs.filter(log => normalizeDateKey(log.date) <= dateKey)
        .reduce((sum, log) => sum + (log.financialSummary?.grandTotal || 0), 0);

    const totalAreaAcres = getTotalScopedAreaInAcres(crops, scope);
    const perAcreRunning = totalAreaAcres > 0 ? cropSoFarCost / totalAreaAcres : 0;

    const unverifiedToday = scopedLogs.filter(log =>
        normalizeDateKey(log.date) === dateKey && isLogUnverified(log)
    ).length;
    const unverifiedTotal = scopedLogs.filter(log => isLogUnverified(log)).length;

    return {
        today: todayCost,
        week: weekCost,
        cropSoFar: cropSoFarCost,
        perAcreRunning,
        spendVelocityWeek: weekCost,
        unverifiedToday,
        unverifiedTotal
    };
};

export const computeVerificationMetrics = (
    logs: DailyLog[],
    date: string = getDateKey()
): VerificationMetrics => {
    const dateKey = normalizeDateKey(date);
    const dateMap = new Map<string, DailyLog[]>();

    logs.forEach(log => {
        const key = normalizeDateKey(log.date);
        const existing = dateMap.get(key) || [];
        existing.push(log);
        dateMap.set(key, existing);
    });

    const dateObj = toDate(dateKey);
    const month = dateObj.getMonth();
    const year = dateObj.getFullYear();
    const monthLength = new Date(year, month + 1, 0).getDate();

    let trustedDaysThisMonth = 0;
    dateMap.forEach((dayLogs, key) => {
        const day = toDate(key);
        if (day.getMonth() !== month || day.getFullYear() !== year) return;
        if (dayLogs.length === 0) return;
        if (dayLogs.every(log => isLogVerified(log))) trustedDaysThisMonth += 1;
    });

    let verificationStreakDays = 0;
    const cursor = toDate(dateKey);
    const maxLookBackDays = 120;
    let streakStarted = false;

    for (let i = 0; i < maxLookBackDays; i += 1) {
        const cursorKey = getDateKey(cursor);
        const dayLogs = dateMap.get(cursorKey) || [];

        if (dayLogs.length === 0) {
            if (streakStarted) break;
        } else if (dayLogs.every(log => isLogVerified(log))) {
            verificationStreakDays += 1;
            streakStarted = true;
        } else {
            break;
        }

        cursor.setDate(cursor.getDate() - 1);
    }

    return {
        verificationStreakDays,
        trustedDaysThisMonth,
        monthLength
    };
};

export const formatCurrencyINR = (amount: number): string => {
    return amount.toLocaleString('en-IN', {
        maximumFractionDigits: 0
    });
};
