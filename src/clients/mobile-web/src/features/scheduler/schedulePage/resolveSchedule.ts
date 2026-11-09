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
 *   - `applyEditorChoice` — the editor ("शेड्यूल बदला"): one plot's schedule and day-0 date (lane L8b-2, founder C2:
 *     that plot only, as the server keeps it; the page reads the plot's subscription first, so the choice takes effect).
 * A stored schedule keeps any extra fields an old phone saved in it (the old editor's wizard object: its
 * name, prep activities, stage list); nothing ever read them, but they are the farmer's and are not thrown
 * away (P11, additive).
 */
import type { CropProfile, Plot } from '../../../types';
import type { CropScheduleTemplate, PlotScheduleInstance } from '../scheduler.types';
import { createInitialScheduleInstance, getScheduleById, isPlotChoice } from '../planning/ClientPlanEngine';
import { defaultScheduleForCrop, type DefaultKind } from '../planning/followableDefault';
import { isFallbackTemplate } from '../../../infrastructure/reference/TemplateCatalog';
import { toDayKey } from './scheduleDates';
import { normalizeInstance } from './scheduleModel';
import type { ScheduleChoice } from './scheduleSubscriptions';

/** adopted = the crop's chosen schedule; plot = the plot's own; default = the app's first schedule for the crop (nobody chose it). */
export type ScheduleSource = 'adopted' | 'plot' | 'default';

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - one schedule a plot follows, in the place it holds: 0 = his own, 1..3 = outside
 * (`slot` null = the server sent none). `isMain` is the SERVER'S pick (R6), never worked out here. `template` is null while the phone's
 * catalog does not hold it yet; `pending` = this phone's unanswered addition.
 */
export interface FollowedPlace {
    subscriptionId: string;
    templateId: string;
    template: CropScheduleTemplate | null;
    slot: number | null;
    origin: 'Outside' | 'Own';
    checkState: 'Checked' | 'NotChecked' | 'Returned' | 'Withdrawn';
    isMain: boolean;
    pending: boolean;
    /** spec: lane L8b-3 fix 1 (L004) - this phone's unanswered choice was REFUSED or given up: it is no longer "on its way". */
    refused: boolean;
}

/**
 * `template` / `instance` / `source` are the plot's मुख्य schedule (R6) - the header, the stage line and the tabs follow it; `followed` is
 * every schedule the plot follows, in place order (empty when nobody chose: the app's default is not a followed schedule).
 */
export interface ResolvedSchedule {
    template: CropScheduleTemplate;
    instance: PlotScheduleInstance;
    source: ScheduleSource;
    followed: FollowedPlace[];
    /**
     * spec: plr-d10 lane SCH-GATE-b - set ONLY when `source` is 'default': the default is a schedule ShramSafal checked, or the unchecked
     * SAMPLE of a crop that has no checked one (marked as a sample, D-91 = 1). Never set on a schedule somebody chose.
     */
    defaultKind?: DefaultKind;
}

/** The plot's own mark: its schedule was chosen for THIS plot in the editor (an extra field the stored schedule carries). */
const PLOT_CHOICE_FIELD = 'plotChoice';
export { isPlotChoice };

/** A schedule someone really made (not the app's stand-in, not empty), else undefined. */
const real = (t: CropScheduleTemplate | undefined): CropScheduleTemplate | undefined =>
    t && !isFallbackTemplate(t) && t.stages.length > 0 ? t : undefined;

const followedPlaces = (choice: ScheduleChoice | null | undefined): FollowedPlace[] =>
    (choice?.followed ?? (choice ? [choice] : [])).map(c => {
        const template = real(getScheduleById(c.templateId)) ?? null;
        return {
            subscriptionId: c.subscriptionId ?? '',
            templateId: c.templateId,
            template,
            slot: typeof c.slot === 'number' ? c.slot : null,
            origin: c.origin === 'Own' ? 'Own' : 'Outside',
            checkState: template?.check?.state ?? c.checkState ?? 'NotChecked',
            isMain: c.isMain === true,
            pending: c.pending,
            refused: c.refused === true,
        };
    });

export function resolvePlotSchedule(crop: CropProfile, plot: Plot, todayKey: string, choice?: ScheduleChoice | null): ResolvedSchedule | null {
    const stored = plot.schedule as Partial<PlotScheduleInstance> | undefined;
    // spec: plr-d10 lane L8b-2 (founder D-32) - what the plot's schedule SUBSCRIPTION says comes first: the choice the server
    // keeps for this plot (or this phone's own, not yet answered). A download or a crop-type default never outranks it. A choice
    // that names no real schedule on this phone (the catalog has not synced) is skipped, and the chain below answers as before.
    const chosen = choice ? real(getScheduleById(choice.templateId)) : undefined;
    if (choice && chosen) {
        // Stage and expectation changes made on this plot belong to the schedule they were made on.
        const sameSchedule = stored?.templateId === chosen.id;
        const instance = normalizeInstance(sameSchedule ? stored : { ...stored, stageOverrides: [], expectationOverrides: [] }, {
            plotId: plot.id,
            templateId: chosen.id,
            referenceType: chosen.referenceType,
            referenceDate: choice.referenceDate ?? toDayKey(plot.startDate) ?? todayKey,
        });
        return {
            template: chosen,
            // The subscription's day 0 is the plot's day 0 (null = the season's own start, never a stale edit).
            instance: { ...instance, templateId: chosen.id, referenceDate: choice.referenceDate ?? toDayKey(plot.startDate) ?? todayKey },
            source: 'adopted',
            followed: followedPlaces(choice),
        };
    }
    // Each step skips the app's stand-in: a plot added before the catalog synced stores the stand-in's id
    // ('tpl_fallback_grape'), and that must not hide the crop's real schedule once it is here (V2-04).
    const adopted = real(getScheduleById(crop.activeScheduleId || ''));
    const own = real(getScheduleById(typeof stored?.templateId === 'string' ? stored.templateId : ''));
    // spec: plr-d10 lane SCH-GATE-b (open point 9 (c)) - the default comes ONLY from a schedule the plot may follow (the one helper
    // `scheduleTemplateForPlot` also uses); with nothing followable there is no default and the page says so (P4).
    const followable = defaultScheduleForCrop(crop.name);
    const cropDefault = real(followable?.template);
    // spec: plr-d10 lane L8b-2 (founder C2) - a schedule chosen in "शेड्यूल बदला" is THAT PLOT's (marked on its stored schedule),
    // and outranks the crop's own schedule for that plot only; the library's adopt clears the mark (the crop-wide door).
    const plotChosen = isPlotChoice(stored) ? own : undefined;
    const template = plotChosen || adopted || own || cropDefault;
    if (!template) return null;
    // A plot schedule that is just the crop's default (made when the plot was added) is not a choice either.
    const source: ScheduleSource = plotChosen ? 'plot' : adopted ? 'adopted' : own && own.id !== cropDefault?.id ? 'plot' : 'default';
    const instance = normalizeInstance(stored, {
        plotId: plot.id,
        templateId: template.id,
        referenceType: template.referenceType,
        referenceDate: toDayKey(plot.startDate) ?? todayKey,
    });
    return { template, instance, source, followed: [], ...(source === 'default' && followable && template.id === followable.template.id ? { defaultKind: followable.kind } : {}) };
}

/** The plot's schedule as stored, made readable (old wizard objects included) — the base an edit starts from. */
export function storedInstance(crop: CropProfile, plot: Plot, todayKey: string): PlotScheduleInstance {
    const base = createInitialScheduleInstance(plot.id, crop.name, toDayKey(plot.startDate) ?? todayKey);
    return normalizeInstance(plot.schedule, { plotId: plot.id, templateId: base.templateId, referenceType: base.referenceType, referenceDate: base.referenceDate });
}

/** Write `next` over the plot's stored schedule, keeping whatever else an old phone saved in that object. */
const writeBack = (plot: Plot, next: PlotScheduleInstance, plotChoice = false): PlotScheduleInstance => {
    const legacy: Record<string, unknown> = plot.schedule && typeof plot.schedule === 'object' ? { ...(plot.schedule as unknown as Record<string, unknown>) } : {};
    // `plantationDate` was the old editor's day 0; `referenceDate` now holds it, so the stale copy is dropped.
    delete legacy.plantationDate;
    // The mark of a choice made for this plot alone (editor) is set by the editor and cleared by the crop-wide library.
    delete legacy[PLOT_CHOICE_FIELD];
    return { ...legacy, ...next, ...(plotChoice ? { [PLOT_CHOICE_FIELD]: true } : {}) } as PlotScheduleInstance;
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
 * The editor's save. spec: plr-d10 lane L8b-2 (founder C2) - a schedule chosen in "शेड्यूल बदला" applies to THAT PLOT only,
 * exactly as the server keeps it (one subscription for the plot); the crop's own schedule and its other plots are not
 * touched (the library's adopt is the crop-wide door). The chosen plot's schedule and its day 0 are set; the page reads the
 * plot's subscription first (`resolvePlotSchedule`), so the choice shows at once. Returns the crop list unchanged when the
 * choice names nothing real.
 */
export function applyEditorChoice(crops: readonly CropProfile[], choice: EditorChoice, todayKey: string): CropProfile[] {
    const crop = crops.find(c => c.id === choice.cropId);
    const plot = crop?.plots.find(p => p.id === choice.plotId);
    const startDate = toDayKey(choice.startDate);
    const template = getScheduleById(choice.templateId);
    if (!crop || !plot || !startDate || !template) return [...crops];
    return crops.map(c => c.id !== crop.id ? c : {
        ...c,
        plots: c.plots.map(p => {
            if (p.id !== plot.id) return p;
            const next = { ...switchTo(c, p, template, todayKey), referenceDate: startDate };
            return { ...p, schedule: writeBack(p, next, true) };
        }),
    });
}
