/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2, S16)
 *
 * Which schedule a plot follows — from its REAL crop: the crop's adopted schedule, else the plot's own, else
 * the crop's first catalog schedule (the same chain the old page and `dfesScheduleWindow` use). The old grid
 * instead guessed the crop from the template id's text, which never matches the server's GUID ids.
 * A built-in stand-in schedule (`isFallbackTemplate`) is not a schedule anyone made: `null` is returned and
 * the page says so (P4). `source` says where the schedule came from, so the page can say plainly when the
 * farmer has not chosen one and is looking at the app's default.
 *
 * And the two ways the page CHANGES a schedule, as pure functions over the crop list:
 *   - `adoptForCrop` — the library's "हे शेड्यूल वापरा": the crop's schedule, for every plot of the crop
 *     (one adopted schedule per crop is the only model the app has: `CropProfile.activeScheduleId`);
 *   - `applyEditorChoice` — the editor ("शेड्यूल बदला"): a schedule (adopted for the crop the same way, so the
 *     choice really takes effect — the page reads `activeScheduleId` first) and one plot's day-0 date.
 * A stored schedule keeps any extra fields an old phone saved in it (the old editor's wizard object: its
 * name, prep activities, stage list); nothing ever read them, but they are the farmer's and are not thrown
 * away (P11, additive).
 */
import type { CropProfile, Plot } from '../../../types';
import type { CropScheduleTemplate, PlotScheduleInstance } from '../scheduler.types';
import { createInitialScheduleInstance, getScheduleById, getTemplateForCrop } from '../planning/ClientPlanEngine';
import { isFallbackTemplate } from '../../../infrastructure/reference/TemplateCatalog';
import { toDayKey } from './scheduleDates';
import { normalizeInstance } from './scheduleModel';

/** adopted = the crop's chosen schedule; plot = the plot's own; default = the app's first schedule for the crop (nobody chose it). */
export type ScheduleSource = 'adopted' | 'plot' | 'default';

export interface ResolvedSchedule { template: CropScheduleTemplate; instance: PlotScheduleInstance; source: ScheduleSource }

export function resolvePlotSchedule(crop: CropProfile, plot: Plot, todayKey: string): ResolvedSchedule | null {
    const stored = plot.schedule as Partial<PlotScheduleInstance> | undefined;
    const adopted = getScheduleById(crop.activeScheduleId || '');
    const own = getScheduleById(typeof stored?.templateId === 'string' ? stored.templateId : '');
    const cropDefault = getTemplateForCrop(crop.name);
    const template = adopted || own || cropDefault;
    if (!template || isFallbackTemplate(template) || template.stages.length === 0) return null;
    // A plot schedule that is just the crop's default (made when the plot was added) is not a choice either.
    const source: ScheduleSource = adopted ? 'adopted' : own && own.id !== cropDefault?.id ? 'plot' : 'default';
    const instance = normalizeInstance(stored, {
        plotId: plot.id,
        templateId: template.id,
        referenceType: template.referenceType,
        referenceDate: toDayKey(plot.startDate) ?? todayKey,
    });
    return { template, instance, source };
}

/** The plot's schedule as stored, made readable (old wizard objects included) — the base an edit starts from. */
export function storedInstance(crop: CropProfile, plot: Plot, todayKey: string): PlotScheduleInstance {
    const base = createInitialScheduleInstance(plot.id, crop.name, toDayKey(plot.startDate) ?? todayKey);
    return normalizeInstance(plot.schedule, { plotId: plot.id, templateId: base.templateId, referenceType: base.referenceType, referenceDate: base.referenceDate });
}

/** Write `next` over the plot's stored schedule, keeping whatever else an old phone saved in that object. */
const writeBack = (plot: Plot, next: PlotScheduleInstance): PlotScheduleInstance => {
    const legacy: Record<string, unknown> = plot.schedule && typeof plot.schedule === 'object' ? { ...(plot.schedule as unknown as Record<string, unknown>) } : {};
    // `plantationDate` was the old editor's day 0; `referenceDate` now holds it, so the stale copy is dropped.
    delete legacy.plantationDate;
    return { ...legacy, ...next } as PlotScheduleInstance;
};

/** A plot's schedule switched to `template`. The same schedule keeps the plot's own stage changes; a new one starts clean. */
function switchTo(crop: CropProfile, plot: Plot, template: CropScheduleTemplate, todayKey: string): PlotScheduleInstance {
    const existing = storedInstance(crop, plot, todayKey);
    const same = existing.templateId === template.id;
    return {
        ...existing,
        templateId: template.id,
        referenceType: template.referenceType,
        stageOverrides: same ? existing.stageOverrides : [],
        expectationOverrides: same ? existing.expectationOverrides : [],
    };
}

/** The library's adopt: `templateId` becomes the crop's schedule, on every plot of the crop. Unknown id → no change. */
export function adoptForCrop(crops: readonly CropProfile[], cropId: string, templateId: string, todayKey: string): CropProfile[] {
    const template = getScheduleById(templateId);
    if (!template) return [...crops];
    return crops.map(c => c.id !== cropId ? c : {
        ...c,
        activeScheduleId: template.id,
        plots: c.plots.map(p => ({ ...p, schedule: writeBack(p, switchTo(c, p, template, todayKey)) })),
    });
}

/** What the editor hands back: one plot, the schedule it should follow, and that plot's day 0. */
export interface EditorChoice { cropId: string; plotId: string; templateId: string; startDate: string }

/**
 * The editor's save. The schedule is adopted for the crop exactly as the library does it (when it is not
 * already the crop's schedule), then the chosen plot's day 0 is set. Returns the crop list unchanged when
 * the choice names nothing real.
 */
export function applyEditorChoice(crops: readonly CropProfile[], choice: EditorChoice, todayKey: string): CropProfile[] {
    const crop = crops.find(c => c.id === choice.cropId);
    const plot = crop?.plots.find(p => p.id === choice.plotId);
    const startDate = toDayKey(choice.startDate);
    if (!crop || !plot || !startDate || !getScheduleById(choice.templateId)) return [...crops];
    const adopted = crop.activeScheduleId === choice.templateId ? [...crops] : adoptForCrop(crops, crop.id, choice.templateId, todayKey);
    return adopted.map(c => c.id !== crop.id ? c : {
        ...c,
        plots: c.plots.map(p => {
            if (p.id !== plot.id) return p;
            const next = { ...switchTo(c, p, getScheduleById(choice.templateId)!, todayKey), referenceDate: startDate };
            return { ...p, schedule: writeBack(p, next) };
        }),
    });
}
