import React from 'react';
import { DailyLog, PlannedItem, ExecutedItem, Plot, PlotComparisonSummary } from '../../types';
import { BlockStatus } from '../scheduler/components/DayCard';
import { parseDateKey } from '../../core/domain/services/DateKeyService';
import { Droplets, Sprout, SprayCan, Hammer } from 'lucide-react';

export type CompareCategory = 'ACTIVITY' | 'NUTRITION' | 'SPRAY' | 'IRRIGATION';
export type FarmerStatus = 'ON_TRACK' | 'SLIGHT_LAG' | 'BEHIND' | 'EXTRA';
export type CategoryHealth = 'ON_TRACK' | 'BEHIND' | 'EXTRA';

export interface MustDoItem {
    id: string;
    category: CompareCategory;
    name: string;
    plannedText: string;
    actualText: string;
    isDone: boolean;
    delayDays: number;
}

export interface ExtraItem {
    id: string;
    category: CompareCategory;
    name: string;
    doneText: string;
    reasonText: string;
    executedDay: number;
}

export interface CategoryCard {
    category: CompareCategory;
    label: string;
    doneCount: number;
    missedCount: number;
    extraCount: number;
    health: CategoryHealth;
    biggestMisses: string[];
}

export interface ScheduleReplicaDay {
    key: string;
    dayNumber: number;
    dateLabel: string;
    isToday: boolean;
    isPast: boolean;
    status: {
        irrigation: BlockStatus;
        nutrition: BlockStatus;
        spray: BlockStatus;
        activity: BlockStatus;
    };
    notes: {
        irrigation?: string;
        nutrition?: string;
        spray?: string;
        activity?: string;
        general?: string;
    };
    missedEntries: string[];
    extraEntries: string[];
}

export const CATEGORY_ORDER: CompareCategory[] = ['ACTIVITY', 'NUTRITION', 'SPRAY', 'IRRIGATION'];

export const CATEGORY_META: Record<CompareCategory, { label: string; shortLabel: string }> = {
    ACTIVITY: { label: 'Activities', shortLabel: 'Work' },
    NUTRITION: { label: 'Nutrition', shortLabel: 'Nutri' },
    SPRAY: { label: 'Sprays', shortLabel: 'Spray' },
    IRRIGATION: { label: 'Water', shortLabel: 'Water' }
};

export const round1 = (value: number): number => Math.round(value * 10) / 10;

export const getStatusText = (status: FarmerStatus): string => {
    if (status === 'ON_TRACK') return 'You are ON TRACK';
    if (status === 'SLIGHT_LAG') return 'You are SLIGHTLY BEHIND';
    if (status === 'EXTRA') return 'You are doing EXTRA work';
    return 'You are BEHIND';
};

export const getStatusStyles = (status: FarmerStatus) => {
    if (status === 'ON_TRACK') {
        return {
            card: 'bg-emerald-50 border-emerald-200',
            chip: 'bg-emerald-600 text-white'
        };
    }
    if (status === 'SLIGHT_LAG') {
        return {
            card: 'bg-amber-50 border-amber-200',
            chip: 'bg-amber-600 text-white'
        };
    }
    if (status === 'EXTRA') {
        return {
            card: 'bg-blue-50 border-blue-200',
            chip: 'bg-blue-600 text-white'
        };
    }
    return {
        card: 'bg-red-50 border-red-200',
        chip: 'bg-red-600 text-white'
    };
};

export const getFarmerStatus = (doneCount: number, missedCount: number, extraCount: number): FarmerStatus => {
    if (missedCount === 0) {
        return extraCount > 0 ? 'EXTRA' : 'ON_TRACK';
    }

    const totalMustDo = doneCount + missedCount;
    const completionRatio = totalMustDo > 0 ? doneCount / totalMustDo : 0;
    if (completionRatio >= 0.75) {
        return 'SLIGHT_LAG';
    }

    return 'BEHIND';
};

export const getCategoryHealth = (missedCount: number, extraCount: number): CategoryHealth => {
    if (missedCount > 0) return 'BEHIND';
    if (extraCount > 0) return 'EXTRA';
    return 'ON_TRACK';
};

export const getCategoryCardStyles = (health: CategoryHealth): string => {
    if (health === 'BEHIND') return 'border-red-200 bg-red-50/70';
    if (health === 'EXTRA') return 'border-blue-200 bg-blue-50/70';
    return 'border-emerald-200 bg-emerald-50/70';
};

export const getCategoryIcon = (category: CompareCategory, size = 16, className = '') => {
    if (category === 'ACTIVITY') return <Hammer size={size} className={className} />;
    if (category === 'NUTRITION') return <Sprout size={size} className={className} />;
    if (category === 'SPRAY') return <SprayCan size={size} className={className} />;
    return <Droplets size={size} className={className} />;
};

export const trimReason = (reasonText: string): string => reasonText.replace(/^Reason:\s*/i, '');

export const compactList = (items: string[], prefix: string, max = 2): string | undefined => {
    if (items.length === 0) return undefined;
    const head = items.slice(0, max);
    const more = items.length - head.length;
    return `${prefix}${head.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
};

export const firstEventIssueReason = (log: DailyLog): string | null => {
    const cropIssue = log.cropActivities.find(e => e.issue)?.issue;
    if (cropIssue) return `${cropIssue.issueType}: ${cropIssue.reason}`;

    const irrIssue = log.irrigation.find(e => e.issue)?.issue;
    if (irrIssue) return `${irrIssue.issueType}: ${irrIssue.reason}`;

    const inputIssue = log.inputs.find(e => e.issue)?.issue;
    if (inputIssue) return `${inputIssue.issueType}: ${inputIssue.reason}`;

    const labourIssue = log.labour.find(e => e.issue)?.issue;
    if (labourIssue) return `${labourIssue.issueType}: ${labourIssue.reason}`;

    const machineIssue = log.machinery.find(e => e.issue)?.issue;
    if (machineIssue) return `${machineIssue.issueType}: ${machineIssue.reason}`;

    return null;
};

export const getExtraReasonFromLog = (log?: DailyLog): string => {
    if (!log) return 'Reason: Farmer decision';

    if (log.disturbance) {
        return `Reason: ${log.disturbance.group} - ${log.disturbance.reason}`;
    }

    const eventIssue = firstEventIssueReason(log);
    if (eventIssue) return `Reason: ${eventIssue}`;

    const observationIssue = log.observations?.find(o => o.noteType === 'issue' || o.noteType === 'reminder');
    if (observationIssue) return `Reason: ${observationIssue.textRaw}`;

    const rain = log.weatherStamp?.precipMm || 0;
    if (rain >= 8) return 'Reason: Weather condition adjustment';

    return 'Reason: Farmer preventive decision';
};

export const mapBucketToCategory = (bucketType: string): CompareCategory => {
    if (bucketType === 'IRRIGATION') return 'IRRIGATION';
    if (bucketType === 'FERTIGATION') return 'NUTRITION';
    if (bucketType === 'SPRAY') return 'SPRAY';
    return 'ACTIVITY';
};

export const matchesPlannedDay = (planned: PlannedItem, day: number): boolean => {
    if (typeof planned.expectedDay === 'number') return planned.expectedDay === day;
    if (planned.expectedWindow) {
        return day >= planned.expectedWindow.start && day <= planned.expectedWindow.end;
    }
    return false;
};

export const getDateForDay = (referenceDate: string, dayOffset: number): Date => {
    const base = parseDateKey(referenceDate);
    const date = new Date(base);
    date.setDate(base.getDate() + dayOffset);
    date.setHours(0, 0, 0, 0);
    return date;
};

export const getDateLabelForDay = (referenceDate: string, dayOffset: number): string => {
    const date = getDateForDay(referenceDate, dayOffset);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const getRelativeDayFromToday = (targetDate: Date): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const formatRelativeDay = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

export interface CompareReport {
    stageName: string;
    stageStartDay: number;
    stageEndDay: number;
    seasonDay: number;
    stageDay: number;
    plannedCount: number;
    doneCount: number;
    missedCount: number;
    extraCount: number;
    status: FarmerStatus;
    mustDoItems: MustDoItem[];
    extraItems: ExtraItem[];
    categoryCards: CategoryCard[];
    scheduleDays: ScheduleReplicaDay[];
    compactScheduleDays: ScheduleReplicaDay[];
    expectedWaterHours: number;
    actualWaterHours: number;
    waterGapHours: number;
}

export const buildCompareReport = (
    comparisonData: PlotComparisonSummary,
    activePlot: Plot,
    plotLogs: DailyLog[]
): CompareReport | null => {
    const stage = comparisonData.currentStage || comparisonData.stages[0];
    if (!stage) return null;

    const stagesForAnalysis = comparisonData.stages.filter(stageItem => stageItem.plannedStartDay <= comparisonData.currentDay);
    const analysisBucketEntries = (stagesForAnalysis.length > 0 ? stagesForAnalysis : [stage])
        .flatMap(stageItem => stageItem.buckets.map(bucket => ({
            bucket,
            stageEndDay: stageItem.plannedEndDay
        })));

    const plannedCount = analysisBucketEntries.reduce((sum, entry) => sum + entry.bucket.plannedCount, 0);
    const doneCount = analysisBucketEntries.reduce((sum, entry) => sum + entry.bucket.matchedCount, 0);
    const missedCount = analysisBucketEntries.reduce((sum, entry) => sum + entry.bucket.missedCount, 0);
    const extraCount = analysisBucketEntries.reduce((sum, entry) => sum + entry.bucket.extraCount, 0);

    const status: FarmerStatus = getFarmerStatus(doneCount, missedCount, extraCount);

    const irrigationBucket = stage.buckets.find(bucket => bucket.bucketType === 'IRRIGATION');
    const irrigationDuration = Math.max(0.5, (activePlot.irrigationPlan?.durationMinutes || 60) / 60);
    const expectedWaterHours = round1((irrigationBucket?.plannedCount || 0) * irrigationDuration);
    const actualWaterHours = round1((irrigationBucket?.executed || []).reduce((sum, event) => {
        return sum + (typeof event.quantity === 'number' ? event.quantity : 0);
    }, 0));
    const waterGapHours = round1(Math.max(0, expectedWaterHours - actualWaterHours));

    const mustDoItems: MustDoItem[] = [];
    const extraItems: ExtraItem[] = [];

    const categoryCounts: Record<CompareCategory, {
        doneCount: number;
        missedCount: number;
        extraCount: number;
        missedNames: string[];
    }> = {
        ACTIVITY: { doneCount: 0, missedCount: 0, extraCount: 0, missedNames: [] },
        NUTRITION: { doneCount: 0, missedCount: 0, extraCount: 0, missedNames: [] },
        SPRAY: { doneCount: 0, missedCount: 0, extraCount: 0, missedNames: [] },
        IRRIGATION: { doneCount: 0, missedCount: 0, extraCount: 0, missedNames: [] }
    };

    const plannedByCategory: Record<CompareCategory, PlannedItem[]> = {
        ACTIVITY: [],
        NUTRITION: [],
        SPRAY: [],
        IRRIGATION: []
    };

    const executedByCategory: Record<CompareCategory, ExecutedItem[]> = {
        ACTIVITY: [],
        NUTRITION: [],
        SPRAY: [],
        IRRIGATION: []
    };

    const executedByCategoryId: Record<CompareCategory, Map<string, ExecutedItem>> = {
        ACTIVITY: new Map<string, ExecutedItem>(),
        NUTRITION: new Map<string, ExecutedItem>(),
        SPRAY: new Map<string, ExecutedItem>(),
        IRRIGATION: new Map<string, ExecutedItem>()
    };

    const logsById = new Map(plotLogs.map(log => [log.id, log]));

    analysisBucketEntries.forEach(({ bucket, stageEndDay }) => {
        const category = mapBucketToCategory(bucket.bucketType);
        const executedById = new Map(bucket.executed.map(executed => [executed.id, executed]));

        categoryCounts[category].doneCount += bucket.matchedCount;
        categoryCounts[category].missedCount += bucket.missedCount;
        categoryCounts[category].extraCount += bucket.extraCount;

        bucket.planned.forEach(planned => {
            const executed = (planned.matchedExecutionId ? executedById.get(planned.matchedExecutionId) : undefined) as ExecutedItem | undefined;
            const plannedText = typeof planned.expectedDay === 'number'
                ? `Plan: Day ${planned.expectedDay}`
                : 'Plan: Current phase';

            if (planned.isMatched) {
                mustDoItems.push({
                    id: `${category}_${planned.id}`,
                    category,
                    name: planned.name,
                    plannedText,
                    actualText: executed ? `Done: Day ${executed.executedDay}` : 'Done',
                    isDone: true,
                    delayDays: 0
                });
            } else {
                const delayDays = typeof planned.expectedDay === 'number'
                    ? Math.max(0, comparisonData.currentDay - planned.expectedDay)
                    : Math.max(0, comparisonData.currentDay - stageEndDay);

                categoryCounts[category].missedNames.push(planned.name);

                mustDoItems.push({
                    id: `${category}_${planned.id}`,
                    category,
                    name: planned.name,
                    plannedText,
                    actualText: delayDays > 0
                        ? `Missed: ${delayDays} day${delayDays > 1 ? 's' : ''} late`
                        : 'Missed: Not done yet',
                    isDone: false,
                    delayDays
                });
            }
        });

        bucket.executed
            .filter(executed => executed.isExtra)
            .forEach(executed => {
                const relativeDay = formatRelativeDay(
                    getRelativeDayFromToday(getDateForDay(comparisonData.referenceDate, executed.executedDay))
                );
                extraItems.push({
                    id: `${category}_${executed.id}`,
                    category,
                    name: executed.name,
                    doneText: `Done: Phase Day ${executed.executedDay} (day ${relativeDay})`,
                    reasonText: getExtraReasonFromLog(logsById.get(executed.sourceLogId)),
                    executedDay: executed.executedDay
                });
            });
    });

    stage.buckets.forEach(bucket => {
        const category = mapBucketToCategory(bucket.bucketType);
        plannedByCategory[category].push(...bucket.planned);
        executedByCategory[category].push(...bucket.executed);
        bucket.executed.forEach(executed => {
            executedByCategoryId[category].set(executed.id, executed);
        });
    });

    mustDoItems.sort((a, b) => {
        if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
        return b.delayDays - a.delayDays;
    });

    const categoryCards: CategoryCard[] = CATEGORY_ORDER.map(category => {
        const counts = categoryCounts[category];
        return {
            category,
            label: CATEGORY_META[category].label,
            doneCount: counts.doneCount,
            missedCount: counts.missedCount,
            extraCount: counts.extraCount,
            health: getCategoryHealth(counts.missedCount, counts.extraCount),
            biggestMisses: counts.missedNames.slice(0, 2)
        };
    });

    const extraByDay = new Map<number, ExtraItem[]>();
    extraItems.forEach(item => {
        const existing = extraByDay.get(item.executedDay) || [];
        existing.push(item);
        extraByDay.set(item.executedDay, existing);
    });

    const scheduleDays: ScheduleReplicaDay[] = [];
    for (let day = stage.plannedStartDay; day <= stage.plannedEndDay; day++) {
        const statusByCategory: Record<CompareCategory, BlockStatus> = {
            ACTIVITY: 'NOT_REQUIRED',
            NUTRITION: 'NOT_REQUIRED',
            SPRAY: 'NOT_REQUIRED',
            IRRIGATION: 'NOT_REQUIRED'
        };

        const noteByCategory: Record<CompareCategory, string | undefined> = {
            ACTIVITY: undefined,
            NUTRITION: undefined,
            SPRAY: undefined,
            IRRIGATION: undefined
        };
        const missedEntries: string[] = [];

        CATEGORY_ORDER.forEach(category => {
            const plannedForDay = plannedByCategory[category].filter(planned => matchesPlannedDay(planned, day));
            const executedForDay = executedByCategory[category].filter(executed => executed.executedDay === day);
            const extraForDay = executedForDay.filter(executed => executed.isExtra);

            const doneNames: string[] = [];
            const missedNames: string[] = [];
            const plannedNames: string[] = [];

            plannedForDay.forEach(planned => {
                const matchedExecutionId = planned.matchedExecutionId;
                const matchedExecution = matchedExecutionId
                    ? executedByCategoryId[category].get(matchedExecutionId)
                    : undefined;

                if (matchedExecution && matchedExecution.executedDay === day) {
                    doneNames.push(planned.name);
                    return;
                }

                if (day > comparisonData.currentDay) {
                    plannedNames.push(planned.name);
                    return;
                }

                if (!matchedExecution) {
                    missedNames.push(planned.name);
                    return;
                }

                if (matchedExecution && matchedExecution.executedDay > day) {
                    missedNames.push(`${planned.name} (done Day ${matchedExecution.executedDay})`);
                    return;
                }

                doneNames.push(planned.name);
            });

            if (missedNames.length > 0) {
                statusByCategory[category] = 'MISSED';
                noteByCategory[category] = `X Missed ${missedNames.length}`;
                missedEntries.push(
                    compactList(
                        missedNames.map(name => `${CATEGORY_META[category].shortLabel}: ${name}`),
                        '',
                        2
                    ) || `${CATEGORY_META[category].shortLabel}: missed`
                );
                return;
            }

            if (doneNames.length > 0) {
                statusByCategory[category] = 'DONE';
                noteByCategory[category] = `Done ${doneNames.length}`;
                return;
            }

            if (plannedNames.length > 0) {
                statusByCategory[category] = 'PLANNED';
                noteByCategory[category] = `Plan ${plannedNames.length}`;
                return;
            }

            if (extraForDay.length > 0) {
                statusByCategory[category] = 'DONE';
                noteByCategory[category] = `Extra ${extraForDay.length}`;
            }
        });

        const dayExtras = extraByDay.get(day) || [];
        const extraEntries = dayExtras.map(item => {
            const reason = trimReason(item.reasonText);
            const relativeDay = formatRelativeDay(
                getRelativeDayFromToday(getDateForDay(comparisonData.referenceDate, item.executedDay))
            );
            return `${CATEGORY_META[item.category].shortLabel}: ${item.name} (day ${relativeDay}, ${reason})`;
        });

        scheduleDays.push({
            key: `day_${day}`,
            dayNumber: day + 1,
            dateLabel: getDateLabelForDay(comparisonData.referenceDate, day),
            isToday: day === comparisonData.currentDay,
            isPast: day < comparisonData.currentDay,
            status: {
                irrigation: statusByCategory.IRRIGATION,
                nutrition: statusByCategory.NUTRITION,
                spray: statusByCategory.SPRAY,
                activity: statusByCategory.ACTIVITY
            },
            notes: {
                irrigation: noteByCategory.IRRIGATION,
                nutrition: noteByCategory.NUTRITION,
                spray: noteByCategory.SPRAY,
                activity: noteByCategory.ACTIVITY
            },
            missedEntries,
            extraEntries
        });
    }

    const compactScheduleDays = scheduleDays.filter(day => {
        if (day.isToday) return true;
        if (day.missedEntries.length > 0) return true;
        if (day.extraEntries.length > 0) return true;
        return Math.abs(day.dayNumber - (comparisonData.currentDay + 1)) <= 3;
    });

    const stageDay = Math.max(1, comparisonData.currentDay - stage.plannedStartDay + 1);

    return {
        stageName: stage.stageName,
        stageStartDay: stage.plannedStartDay,
        stageEndDay: stage.plannedEndDay,
        seasonDay: comparisonData.currentDay,
        stageDay,
        plannedCount,
        doneCount,
        missedCount,
        extraCount,
        status,
        mustDoItems,
        extraItems,
        categoryCards,
        scheduleDays,
        compactScheduleDays,
        expectedWaterHours,
        actualWaterHours,
        waterGapHours
    };
};
