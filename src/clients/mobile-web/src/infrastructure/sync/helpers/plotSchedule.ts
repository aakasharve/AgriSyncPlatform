/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Plot + crop ensure/upsert helpers used during sync pull reconciliation.
 * They mutate the in-memory `cropsById` map / crop.plots array; the
 * reconciler then persists the merged result via writeCrops().
 */

import { systemClock } from '../../../core/domain/services/Clock';
import { normalizeMojibakeText } from '../../../shared/utils/textEncoding';
import type { CropProfile, Plot } from '../../../types';
import type { CropCycleDto, PlotDto } from '../../api/AgriSyncClient';
import { pickIconName, toCropId } from './cropIdentity';

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
        existingPlot.variety = normalizedCropName;
        if (existingPlot.schedule) {
            existingPlot.schedule.templateId = templateId ?? existingPlot.schedule.templateId;
        }
        existingPlot.baseline = {
            ...existingPlot.baseline,
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        };
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
