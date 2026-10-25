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
