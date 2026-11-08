/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Plot + crop ensure/upsert helpers used during sync pull reconciliation.
 * They mutate the in-memory `cropsById` map / crop.plots array; the
 * reconciler then persists the merged result via the crops repository.
 */

import { systemClock } from '../../../../core/domain/services/Clock';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';
import type { CropProfile, Plot } from '../../../../types';
import type { CropCycleDto, PlotDto } from '../../../../infrastructure/api/AgriSyncClient';
import { pickIconName, toCropId } from './cropIdentity';
import { areaInAcres } from '../../plots/plotArea';

export const CROP_COLORS = [
    'bg-emerald-500',
    'bg-rose-500',
    'bg-indigo-500',
    'bg-amber-500',
    'bg-cyan-500',
    'bg-lime-500',
    'bg-orange-500',
];

export function defaultPlotSchedule(plotId: string, referenceDate: string, templateId: string | null) {
    return {
        id: `sch_${plotId}`,
        plotId,
        templateId: templateId ?? 'fallback_template',
        referenceType: 'PLANTING' as const,
        referenceDate,
        stageOverrides: [],
        expectationOverrides: [],
    };
}

export function ensureCrop(cropsById: Map<string, CropProfile>, cropName: string): CropProfile {
    const normalizedCropName = normalizeMojibakeText(cropName);
    const cropId = toCropId(normalizedCropName);
    const existing = cropsById.get(cropId);
    if (existing) {
        existing.name = normalizeMojibakeText(existing.name);
        return existing;
    }

    const color = CROP_COLORS[cropsById.size % CROP_COLORS.length];
    const created: CropProfile = {
        id: cropId,
        name: normalizedCropName,
        iconName: pickIconName(normalizedCropName),
        color,
        plots: [],
        activeScheduleId: null,
        supportedTasks: [],
        workflow: [],
        createdAt: systemClock.nowISO(),
    };

    cropsById.set(cropId, created);
    return created;
}

export function upsertPlot(crop: CropProfile, plotDto: PlotDto, cycle: CropCycleDto, templateId: string | null): void {
    const normalizedPlotName = normalizeMojibakeText(plotDto.name);
    const normalizedCropName = normalizeMojibakeText(cycle.cropName);

    const existingPlot = crop.plots.find(p => p.id === plotDto.id);
    if (existingPlot) {
        existingPlot.name = normalizedPlotName;
        existingPlot.startDate = cycle.startDate;
        // spec: plr-d10-redesign-real-integration (I9). A plot made on this phone carries
        // the farmer's own variety and his own area in his own unit ("20 गुंठे"). The
        // server keeps acres to 2 places and has no variety, so overwriting would replace
        // his statement with a rounded conversion and the crop's name. The variety is only
        // filled when missing; the area is kept while it still says what the server says
        // (same acres to 2 places) and replaced when the server's area really differs.
        existingPlot.variety = existingPlot.variety || normalizedCropName;
        if (existingPlot.schedule) {
            existingPlot.schedule.templateId = templateId ?? existingPlot.schedule.templateId;
        }
        const localAcres = areaInAcres(existingPlot.baseline?.totalArea, existingPlot.baseline?.unit);
        const sameArea = localAcres > 0 && Math.abs(Math.round(localAcres * 100) / 100 - plotDto.areaInAcres) < 0.005;
        if (!sameArea) {
            existingPlot.baseline = {
                ...existingPlot.baseline,
                totalArea: plotDto.areaInAcres,
                unit: 'Acre',
            };
        }
        return;
    }

    const plot: Plot = {
        id: plotDto.id,
        name: normalizedPlotName,
        variety: normalizedCropName,
        startDate: cycle.startDate,
        createdAt: plotDto.createdAtUtc,
        baseline: {
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        },
        schedule: defaultPlotSchedule(plotDto.id, cycle.startDate, templateId),
    };

    crop.plots.push(plot);
}

/** What a plot's schedule subscription says (a row of `scheduleSubscriptions`, read for the plots a pull touches). */
export interface PlotScheduleChoice { templateId: string; referenceDate: string | null }

const dayOf = (value: string | undefined): string | null =>
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/**
 * spec: plr-d10 lane L8b-2 (founder D-32) - write each plot's CHOSEN schedule onto the plot (its template, and its day 0:
 * null = the crop season's own start), keeping the plot's stage changes only when the schedule is the same one. When every
 * plot of a crop follows the same schedule, the crop's own schedule field says so too, for the readers that look only at the
 * crop. A crop whose plots follow different schedules keeps its field as it is. Mutates, like the other helpers here.
 */
export function applyScheduleChoices(crops: CropProfile[], choices: ReadonlyMap<string, PlotScheduleChoice>): void {
    if (choices.size === 0) return;
    for (const crop of crops) {
        for (const plot of crop.plots) {
            const choice = choices.get(plot.id);
            if (!choice) continue;
            const base = plot.schedule ?? defaultPlotSchedule(plot.id, plot.startDate ?? '', choice.templateId);
            const same = base.templateId === choice.templateId;
            plot.schedule = {
                ...base,
                templateId: choice.templateId,
                referenceDate: choice.referenceDate ?? dayOf(plot.startDate) ?? base.referenceDate,
                stageOverrides: same ? base.stageOverrides : [],
                expectationOverrides: same ? base.expectationOverrides : [],
            };
        }
        const followed = new Set(crop.plots.map(p => choices.get(p.id)?.templateId ?? null));
        if (crop.plots.length > 0 && followed.size === 1 && !followed.has(null)) {
            crop.activeScheduleId = [...followed][0];
        }
        // A plot whose choice differs from the crop's own schedule is marked as chosen for that plot alone (the mark
        // `resolvePlotSchedule` reads), so a reader that looks only at the crop list still shows it; one that agrees is not.
        for (const plot of crop.plots) {
            const choice = choices.get(plot.id);
            if (!choice || !plot.schedule) continue;
            const mark = choice.templateId !== crop.activeScheduleId;
            const schedule = plot.schedule as unknown as Record<string, unknown>;
            if (mark) schedule.plotChoice = true; else delete schedule.plotChoice;
        }
    }
}
