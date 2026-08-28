/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { CloudRain, Zap, Ban } from 'lucide-react';
import { DailyLog } from '../logs/logs.types';
import { Plot } from '../../types';

// --- HELPERS ---

export const getDisturbanceIcon = (group: string, size: number = 14) => {
    switch (group) {
        case 'WEATHER': return <CloudRain size={size} />;
        case 'ELECTRICITY': return <Zap size={size} />;
        default: return <Ban size={size} />;
    }
};

export const isSameDate = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getFullYear() === d2.getFullYear();
};

export const getLogForDate = (
    history: DailyLog[],
    dateStr: string,
    cropId: string,
    selectedPlotsMap: Record<string, string[]>
) => {
    const specificPlots = selectedPlotsMap[cropId] || [];

    return history.find(log => {
        const isSameDate = log.date === dateStr;
        const context = log.context.selection[0];
        const isSameCrop = context.cropId === cropId;

        if (specificPlots.length === 0) return isSameDate && isSameCrop;

        const logPlotIds = context.selectedPlotIds || [];
        const matchesPlot = logPlotIds.some(pid => specificPlots.includes(pid));

        return isSameDate && isSameCrop && matchesPlot;
    });
};

export const getLogForSpecificPlot = (history: DailyLog[], dateStr: string, cropId: string, plotId: string) => {
    return history.find(log => {
        const isDate = log.date === dateStr;
        const context = log.context.selection[0];
        const isCrop = context.cropId === cropId;
        const hasPlot = context.selectedPlotIds?.includes(plotId);
        return isDate && isCrop && hasPlot;
    });
};

// NEW: Planned vs Executed Logic
export type IrrigationStatus = 'ON_TRACK' | 'MISSED' | 'EXTRA' | 'SKIPPED_OK' | 'NO_PLAN';

export const getIrrigationStatus = (date: Date, plot?: Plot, log?: DailyLog): IrrigationStatus => {
    if (!plot || !plot.irrigationPlan) return 'NO_PLAN';

    const { frequency, planStartDate } = plot.irrigationPlan;
    const executed = log && log.irrigation.length > 0;

    let isPlanned = false;

    // Logic: Is today a planned day?
    if (frequency === 'Daily') {
        isPlanned = true;
    } else if (frequency === 'Alternate') {
        const start = new Date(planStartDate).getTime();
        const target = date.getTime();
        const diffDays = Math.round((target - start) / (1000 * 60 * 60 * 24));
        isPlanned = diffDays % 2 === 0;
    } else if (frequency === 'Weekly') {
        // Assume execution on same weekday as start
        const startDay = new Date(planStartDate).getDay();
        isPlanned = date.getDay() === startDay;
    }

    if (isPlanned && executed) return 'ON_TRACK';
    if (isPlanned && !executed) return 'MISSED';
    if (!isPlanned && executed) return 'EXTRA';
    return 'SKIPPED_OK';
};

export const getDayStatus = (log?: DailyLog) => {
    if (!log) return 'empty';
    if (log.disturbance?.scope === 'FULL_DAY') return 'blocked';

    // task-0b fix-round-1 — an explicit declaration WINS first, mirroring the
    // precedence `DayClassifier.Classify` already gives the farmer's own
    // statement over derived signals (P4): NO_WORK_PLANNED is not worked,
    // WORK_RECORDED is worked, full stop, regardless of what buckets hold.
    if (log.dayOutcome === 'NO_WORK_PLANNED') return 'empty';
    if (log.dayOutcome === 'WORK_RECORDED') return 'worked';

    // `dayOutcome` is `null` (or DISTURBANCE_RECORDED/IRRELEVANT_INPUT,
    // neither of which asserts "no work" on its own) — the farmer DID NOT
    // SAY, which is not the same fact as "no work" (P4). This is the common
    // case for an ordinary cross-device pull: `logSyncMutationService.ts`
    // omits `dayOutcome` from the push whenever it would be WORK_RECORDED, so
    // the server stores NULL and `logsReconciler.toDailyLog` carries it back
    // as null. Fall back to the buckets actually recorded — the SAME five
    // checks `DfesLensExtractor.HasWork` uses server-side — instead of
    // rendering real logged work as an empty red-tinted card.
    const hasEvidenceOfWork =
        log.cropActivities.length > 0
        || log.irrigation.length > 0
        || log.inputs.length > 0
        || log.labour.length > 0
        || log.machinery.length > 0;

    return hasEvidenceOfWork ? 'worked' : 'empty';
};

export const getPrimaryActivityName = (log: DailyLog) => {
    if (log.cropActivities.length > 0) return log.cropActivities[0].title;
    if (log.irrigation.length > 0) return "Irrigation";
    if (log.inputs.length > 0) return log.inputs[0].type === 'fertilizer' ? 'Fertilizer' : 'Spraying';
    if (log.labour.length > 0) return "Labour";
    if (log.machinery.length > 0) return log.machinery[0].type;
    return "Activity";
};

export const getPrimaryLogNote = (log?: DailyLog): string | undefined => {
    if (!log) {
        return undefined;
    }

    const observation = log.observations?.[0];
    const observationText = (observation?.textCleaned || observation?.textRaw)?.trim();
    if (observationText) {
        return observationText;
    }

    const cropActivityNote = log.cropActivities.find(activity => activity.notes)?.notes?.trim();
    if (cropActivityNote) {
        return cropActivityNote;
    }

    return log.irrigation.find(event => event.notes)?.notes?.trim();
};
