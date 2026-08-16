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
} from '../../features/scheduler/planning/ClientPlanEngine';
import { getDateKey } from '../../core/domain/services/DateKeyService';

// spec: dfes-companion-2026-07-11 (Task 3A) — exported minimally so
// dfesScheduleWindow.ts can reuse the SAME 4-bucket category union and
// execution-counting primitive computeDayState/getOverdueStageSignal already
// use, instead of re-implementing plan-vs-done arithmetic.
export type OperationCategory = 'IRRIGATION' | 'FERTIGATION' | 'FOLIAR_SPRAY' | 'ACTIVITY';

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
    /**
     * spec: dfes-companion-2026-07-11 (wave-2.4 follow-up) — has this day STARTED
     * at all? False only when nothing is planned for it AND nothing has been
     * recorded on it. Published as its own fact (rather than left for each
     * surface to infer from `closurePercent === 0`) because EVERY surface that
     * shows a closure number or a closure label has to answer the same question
     * first: a day with nothing in it is not 0%-and-failing and not
     * 100%-and-complete — it has not begun, and the honest render is no number
     * at all. Inferring it from the score would tie each caller to the 70/30
     * formula; this ties them to the fact.
     */
    hasStarted: boolean;
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

/**
 * Statuses in which a confirmation is CONTESTED — the owner looked and said
 * "this does not match", or a correction is mid-flight after he did. These are
 * the one case where a `verifiedAtISO` stamp must NOT be read as standing
 * credit (see `hasConfirmationOnRecord`): the sync path stamps the log on any
 * verification event, dispute included, and crediting a disputed log would let
 * the ring claim a day was confirmed when the owner explicitly said otherwise.
 */
const CONTESTED_STATUSES = new Set<LogVerificationStatus>([
    LogVerificationStatus.DISPUTED,
    LogVerificationStatus.REJECTED,
    LogVerificationStatus.CORRECTION_PENDING
]);

/**
 * FOUNDER RULING 21 (2026-08-16) — "AI has no role in it. AI is only being used
 * for parsing and sorting."
 *
 * These are the task provenances the AI authors: `ai_extracted` is Sathi
 * turning the farmer's speech into a task (LogFactory.ts:619, 758) and
 * `observation_derived` is the same act one hop later — tasks lifted out of an
 * AI-parsed observation note, carrying an `aiConfidence` (LogFactory.ts:126,
 * 272, 414). Neither is something the FARMER undertook; both are the AI
 * describing what it heard. The two provenances that survive are `manual` (he
 * created the task himself) and `schedule` (the agronomic plan he adopted).
 *
 * NOTE the widening: the ruling names `ai_extracted`. `observation_derived` is
 * included because it is the same act by the same author and would reopen the
 * identical hole in a rule the founder has now made absolute. Narrowing this
 * back to `ai_extracted` alone is a one-line change to this set.
 */
const AI_AUTHORED_TASK_SOURCES = new Set<PlannedTask['sourceType']>([
    'ai_extracted',
    'observation_derived'
]);

/**
 * Is this task an obligation the FARMER is measured against? Only tasks he
 * took on — himself, or by adopting a schedule — can move the number that
 * judges his day. An unknown/missing provenance counts as his (the field is
 * required by the type; treating legacy rows as farmer-owned preserves the
 * pre-ruling behaviour rather than silently forgiving work).
 */
const isScoredObligation = (task: PlannedTask): boolean =>
    !AI_AUTHORED_TASK_SOURCES.has(task.sourceType);

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

// spec: dfes-companion-2026-07-11 (Task 3A) — exported minimally (was
// module-private) so dfesScheduleWindow.ts can reuse the exact same
// executed-count logic getOverdueStageSignal already relies on, rather than
// duplicating its body.
export const getExecutionCountByCategory = (logs: DailyLog[], category: OperationCategory): number => {
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

// Shared crop/plot scope predicate for tasks. Extracted so getTaskCompletion and
// getCarriedTasks filter by IDENTICAL rules — the carried subset MUST stay a
// strict subset of a day's pending, or the Daily Clarity Loop hero could show a
// carried count that exceeds today's number (the exact incoherence Fix 1 kills).
const taskInScope = (task: PlannedTask, scope?: ScopeOptions): boolean => {
    if (scope?.selectedCropIds?.length && task.cropId && !scope.selectedCropIds.includes(task.cropId)) {
        return false;
    }
    if (scope?.selectedPlotIds?.length && !scope.selectedPlotIds.includes(task.plotId)) {
        return false;
    }
    return true;
};

const getTaskCompletion = (tasks: PlannedTask[], dateKey: string, scope?: ScopeOptions) => {
    const scopedTasks = tasks.filter(task => {
        if (!taskInScope(task, scope)) return false;
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

/**
 * The genuinely-CARRIED subset of a date's open tasks: tasks whose `dueDate` is
 * STRICTLY BEFORE `date` and are still open (not done, not cancelled), within the
 * same crop/plot scope. Because getTaskCompletion counts `dueDate <= date` for
 * pending, this set is always a strict subset of that day's pending tasks — so
 * `getCarriedTasks(...).length <= computeDayState(...).pendingCount` ALWAYS. The
 * Daily Clarity Loop hero uses it to name the carried work as a soft qualifier of
 * TODAY's number, never as a second standalone count that could diverge above it.
 */
export const getCarriedTasks = ({
    tasks,
    date = getDateKey(),
    selectedCropIds,
    selectedPlotIds
}: {
    tasks: PlannedTask[];
    date?: string;
    selectedCropIds?: string[];
    selectedPlotIds?: string[];
}): PlannedTask[] => {
    const dateKey = normalizeDateKey(date);
    const scope: ScopeOptions = { selectedCropIds, selectedPlotIds };
    return tasks.filter(task => {
        if (!taskInScope(task, scope)) return false;
        if (task.status === 'done' || task.status === 'cancelled') return false;
        if (!task.dueDate) return false;
        return task.dueDate < dateKey;
    });
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

/**
 * FOUNDER RULING 22 (2026-08-16) — "it must preserve or improve, nothing to
 * take back... only the re-talk on same log treat that append."
 *
 * Has a confirmation been EARNED on this log — as distinct from `isLogVerified`,
 * which asks whether one is CURRENTLY standing. The difference is a re-open:
 * a human re-opening a log he had confirmed walks the status back to DRAFT (the
 * same act `DailyLog.Edit` performs server-side), and until this ruling that
 * withdrew the 30 the confirmation had already earned. It no longer does. The
 * re-talk is an append to the same log, not a retraction of it.
 *
 * The evidence is `verifiedAtISO`, the stamp a confirmation leaves:
 *   • `LogFactory` writes it ONLY for the owner's own auto-confirmed log
 *     (`verifiedAtISO: isOwner ? nowISO : undefined`) — a mukadam's unreviewed
 *     log has no stamp, so it earns nothing, and a day where nothing was ever
 *     confirmed still scores 0 for this half. The ring cannot claim a day is
 *     verified when nothing ever was.
 *   • the sync path rebuilds it from the log's append-only `verificationEvents`
 *     (logsReconciler.ts:153-157, 261-267), which a re-open does not erase.
 * That path stamps on ANY verification event, dispute included, which is why a
 * contested status is excluded rather than trusted.
 *
 * A log still genuinely awaiting review is untouched by this: no stamp, no
 * credit, and the waiting is reported by `unverifiedCount` / `isClosed` / the
 * review queue exactly as before.
 */
const hasConfirmationOnRecord = (log: DailyLog): boolean => {
    if (isLogVerified(log)) return true;
    const status = log.verification?.status;
    if (status && CONTESTED_STATUSES.has(status)) return false;
    return Boolean(log.verification?.verifiedAtISO);
};

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

    // The PUBLISHED counts keep every task, AI-authored included. Ruling 21 is
    // about the score, not about hiding work from the farmer: his task list,
    // `pendingCount`, the carried-task hero and `isClosed` all still see it.
    const taskCompletion = getTaskCompletion(tasks, dateKey, scope);
    const plannedCount = plannedFromSchedule + taskCompletion.planned;
    const completedCount = doneFromSchedule + taskCompletion.completed;
    const pendingCount = Math.max(0, plannedCount - completedCount);

    // The SCORED plan (ruling 21) — only obligations the farmer actually took
    // on. Excluded from BOTH halves of the ratio, never just the denominator:
    // credit for finishing something he was never measured on would be as
    // invented as the penalty was.
    const scoredTaskCompletion = getTaskCompletion(tasks.filter(isScoredObligation), dateKey, scope);
    const scoredPlannedCount = plannedFromSchedule + scoredTaskCompletion.planned;
    const scoredCompletedCount = doneFromSchedule + scoredTaskCompletion.completed;

    const verifiedCount = dayLogs.filter(log => isLogVerified(log)).length;
    const unverifiedCount = Math.max(0, dayLogs.length - verifiedCount);

    // spec: dfes-companion-2026-07-11 (wave-2.4) — an empty day stops claiming
    // completeness.
    //
    // Both halves of this score used to answer "how much of X is done?" with a
    // FREE 1 when there was no X (`plannedCount === 0 ? 1`, `dayLogs.length ===
    // 0 ? 1`). Absence was scored as perfection, which told two lies at once:
    //
    //   (a) an untouched day scored 1*70 + 1*30 = 100 (and `isClosed` was
    //       vacuously true), so a farmer who had told the app NOTHING saw a
    //       full ring beside "आज काहीच सांगितलं नाही" — "you told me nothing
    //       today". Two opposite claims from the same empty state.
    //   (b) the free 1 was never a floor, only a placeholder that got REPLACED
    //       by a real ratio the moment the first item appeared. A mukadam's
    //       first still-unconfirmed log swapped `1` for `0/1` and the OWNER's
    //       ring fell 100 -> 70 (and 100 -> 85 mixed). Someone recording work
    //       made the number go backwards — exactly what founder decision 6
    //       forbids, proved by dayState.monotonicity.test.ts (wave-1.6).
    //
    // The rule that fixes both: BUILD BOTH HALVES OUT OF WHAT HAS HAPPENED,
    // NEVER OUT OF WHAT IS ABSENT. The 70/30 weighting and clampPercent are
    // unchanged — the weighting was never the defect, the vacuous baselines were.
    const dayHasRecord = dayLogs.length > 0;

    // 70 — "the day's work is accounted for": the planned work that is done,
    // or, when nothing was planned, the day having a record at all. Nothing
    // planned AND nothing recorded earns 0, not a free 1 — an empty day has
    // not been completed, it has not started.
    //
    // Reads the SCORED plan (ruling 21): a day whose only "plan" is what the AI
    // extracted from the farmer's own words is, for scoring purposes, a day
    // with nothing planned — so it falls through to "did he record anything",
    // which is a question about him, not about the parser.
    const taskScore = scoredPlannedCount > 0
        ? scoredCompletedCount / scoredPlannedCount
        : (dayHasRecord ? 1 : 0);

    // 30 — "today's record is confirmed": credit is EARNED by a confirmation
    // and is never revoked when new, not-yet-reviewed work arrives. A log
    // waiting for the owner is work IN FLIGHT, not a failure, so it neither
    // adds nor subtracts here. (To stay non-decreasing when a pending log
    // lands, this term mathematically CANNOT depend on the pending count.)
    // The waiting is reported honestly by `unverifiedCount` / `isClosed` /
    // the review queue — the ring is a PROGRESS measure that only fills, and
    // it is not the place to charge the owner for a mukadam having recorded
    // something.
    //
    // Ruling 22 extends that same "earned, never revoked" shape to a RE-OPEN:
    // the test is whether a confirmation ever happened on the day, not whether
    // one is standing right now. `verifiedCount` (which is the standing count)
    // stays exactly as it was and keeps driving `unverifiedCount`/`isClosed`,
    // so a re-opened log truthfully returns to the review queue while the
    // credit it already earned stays earned.
    const verificationScore = dayLogs.some(hasConfirmationOnRecord) ? 1 : 0;

    const closurePercent = clampPercent((taskScore * 70) + (verificationScore * 30));

    // A day nobody planned and nobody recorded cannot be "closed" — there is
    // nothing to have closed. Without this precondition `pendingCount === 0 &&
    // unverifiedCount === 0` is vacuously true on an empty day, and fixing
    // closurePercent alone would render a 0% ring beside an emerald "Day
    // Closed" (mainView.tsx:249) — a fresh contradiction replacing the old one.
    //
    // The same fact is published as `hasStarted`, because "not started" is a
    // THIRD state that both the score and the closed/not-closed label have to
    // account for. Callers that only ask `isClosed` would render "Day Not
    // Closed" on a day that has not begun — a reproach for doing nothing wrong,
    // and day 1 of the pilot for a farmer with no schedule template.
    const dayHasSubstance = plannedCount > 0 || dayHasRecord;
    const isClosed = dayHasSubstance && pendingCount === 0 && unverifiedCount === 0;

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
        hasStarted: dayHasSubstance,
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
