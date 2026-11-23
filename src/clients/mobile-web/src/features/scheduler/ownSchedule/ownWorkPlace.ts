/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; P10) - what the one-work maker and the plot's own-schedule list read:
 *   - the PLACE: a farm's plot and its current crop season on this phone (`currentCycleByPlot`); none = the maker is not offered, and the page says why;
 *   - the plot's own works as this phone knows them (`getLocalOwnSchedule`: the server's copy with this phone's unanswered changes laid over it, labelled);
 *   - the stages to OFFER: only the stages of the schedule the plot follows this season (its main row), in day order, so a work's `stageIndex` names a stage
 *     by its place in that order. No schedule followed = no stage offered (the stage stays open and the maker says so).
 * Everything is read live and fails soft (a blocked store reads as "nothing"), never throws into a screen.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { CropProfile } from '../../../types';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import type { OwnSchedulePlace } from '../../../application/usecases/sync/OwnScheduleCommands';
import { currentCycleByPlot, mainRow } from '../schedulePage/scheduleSubscriptions';
import { getLocalOwnSchedule, type LocalOwnScheduleWork } from './ownScheduleLocal';
import { parseScheduleBody, type OwnStage } from './ownScheduleModel';
import type { StartWord } from './form/workMakerWords';

export interface OwnWorkPlace extends OwnSchedulePlace {
    plotName: string;
    /** The crop's stored name ("Grapes"); shown through `cropNameIn`. */
    cropName: string;
    cropMasterId?: string;
}

/** Pruning for the crops that count from pruning (grapes, pomegranate), planting for the rest. */
export function startWordFor(cropName: string): StartWord {
    const code = scheduleCropCode(cropName);
    return code === 'grape' || code === 'pomegranate' ? 'pruning' : 'planting';
}

export type OwnWorkPlaceState = { place: OwnWorkPlace; reason: null } | { place: null; reason: 'noPlot' | 'noSeason' } | { place: null; reason: 'loading' };

/** The plot the maker works on (one plot, chosen or the farm's only one) and its current season on this phone. */
export function useOwnWorkPlace(farmId: string | null, plotId: string | null, crops: readonly CropProfile[]): OwnWorkPlaceState {
    const [cycles, setCycles] = useState<Map<string, string> | null>(null);
    useEffect(() => {
        const sub = liveQuery(() => currentCycleByPlot(getDatabase())).subscribe({ next: setCycles, error: () => setCycles(new Map()) });
        return () => sub.unsubscribe();
    }, []);
    const crop = plotId ? crops.find(c => c.plots.some(p => p.id === plotId)) : undefined;
    const plot = crop?.plots.find(p => p.id === plotId);
    if (!farmId || !crop || !plot) return { place: null, reason: 'noPlot' };
    if (cycles === null) return { place: null, reason: 'loading' };
    const cropCycleId = cycles.get(plot.id);
    if (!cropCycleId) return { place: null, reason: 'noSeason' };
    return { place: { farmId, plotId: plot.id, cropCycleId, plotName: plot.name, cropName: crop.name, ...(crop.masterId ? { cropMasterId: crop.masterId } : {}) }, reason: null };
}

/** The plot-season's own works (removed ones left out), live; null until first read. */
export function useOwnWorks(place: OwnWorkPlace | null): LocalOwnScheduleWork[] | null {
    const [works, setWorks] = useState<LocalOwnScheduleWork[] | null>(null);
    const cycle = place?.cropCycleId ?? null;
    useEffect(() => {
        if (!cycle) { setWorks([]); return undefined; }
        const sub = liveQuery(async () => (await getLocalOwnSchedule(getDatabase(), cycle)).filter(w => w.state === 'active'))
            .subscribe({ next: setWorks, error: () => setWorks([]) });
        return () => sub.unsubscribe();
    }, [cycle]);
    return works;
}

/** The stages of the schedule the plot follows this season, in day order; [] when it follows none (or its rows are not on the phone). */
export async function readOfferedStages(plotId: string, cropCycleId: string): Promise<OwnStage[]> {
    try {
        const db = getDatabase();
        const main = mainRow(await db.scheduleSubscriptions.where('plotId').equals(plotId).toArray(), cropCycleId);
        if (!main) return [];
        const raw = (await db.referenceData.get('scheduleTemplates'))?.data;
        const row = Array.isArray(raw) ? raw.find(r => !!r && typeof r === 'object' && (r as { id?: unknown }).id === main.templateId) : undefined;
        const body = row ? parseScheduleBody(row) : null;
        return body ? body.stages.slice().sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay) : [];
    } catch {
        return [];
    }
}

export function useOfferedStages(place: OwnWorkPlace | null): OwnStage[] {
    const [stages, setStages] = useState<OwnStage[]>([]);
    const plotId = place?.plotId ?? null;
    const cycle = place?.cropCycleId ?? null;
    useEffect(() => {
        if (!plotId || !cycle) { setStages([]); return undefined; }
        const sub = liveQuery(() => readOfferedStages(plotId, cycle)).subscribe({ next: setStages, error: () => setStages([]) });
        return () => sub.unsubscribe();
    }, [plotId, cycle]);
    return stages;
}
