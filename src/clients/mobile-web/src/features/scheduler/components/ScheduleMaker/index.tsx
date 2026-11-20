/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * शेड्यूल बदला — the schedule editor, in Marathi and the new look, reached from the शेड्यूल page.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2 "keep the editor, in Marathi").
 * It offers ONLY what the app can keep and the schedule page then really follows:
 *   1. which plot (crop and plot);
 *   2. which schedule — from the crop's schedules (the library's list); saving adopts it for the crop
 *      exactly as the library does, so the page shows it (the page reads the crop's adopted schedule first);
 *   3. the day-0 date (pruning / planting / transplanting / sowing date) of that plot.
 *
 * Removed, because nothing ever used what they produced (doctrine P5 — a control that does nothing):
 * the old English wizard's land-preparation step (duration + prep activities), the growth-stages builder
 * (a hard-coded grape stage list with drag-in activities, quantities and per-day tasks), the schedule-name
 * box and the review step. The old page stored that wizard object AS the plot's schedule, which no screen
 * could read (the page and the DFES window broke on it); no reader of those fields exists anywhere
 * (`prepActivities`, `landPrepDuration`, `stages`, `name`). The custom items it let him "add to his resources"
 * lived only in this session's memory (`useAppData` userResources, never saved).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import type { CropProfile } from '../../../../types';
import type { CropScheduleTemplate } from '../../scheduler.types';
import { BigButton, GlassCard, SANS, SectionHead, Tap } from '../../../../shared/components/ui/placeUi';
import CropPlotPicker from '../../../context/components/CropPlotPicker';
import { SinglePlotSection } from '../../../context/components/PlotSelector';
import { photoOnceFor, sortedNaturally } from '../../../context/components/plotSelectorRules';
import { getScheduleById } from '../../planning/ClientPlanEngine';
import { libraryTemplates } from '../ScheduleLibraryView';
import { DAY_ZERO_LABEL, OWNER_LABEL, SC } from '../../schedulePage/scheduleCopy';
import { scheduleNameMr } from '../../schedulePage/scheduleNames';
import { daysBetween, toDayKey } from '../../schedulePage/scheduleDates';
import { resolvePlotSchedule, type EditorChoice } from '../../schedulePage/resolveSchedule';
import type { ScheduleChoice } from '../../schedulePage/scheduleSubscriptions';
import { shiftDaysUpTo } from '../../schedulePage/scheduleModel';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { cropNameIn } from '../../../../shared/names/namesIn';

interface ScheduleMakerProps {
    crops: CropProfile[];
    /** The crop and plot the शेड्यूल page is on; the editor opens on them. */
    initialCropId?: string;
    initialPlotId?: string;
    todayKey: string;
    onSave: (choice: EditorChoice) => void;
    /** spec: plr-d10 lane L8b-2 - what each plot's schedule subscription says (the server's choice, or this phone's own). */
    choices?: ReadonlyMap<string, ScheduleChoice>;
}

/** The crop's schedules as the library lists them, plus the one the plot follows now if it is not among them. */
function schedulesFor(crop: CropProfile, currentId: string | null): CropScheduleTemplate[] {
    const list = libraryTemplates([crop]);
    const current = currentId ? getScheduleById(currentId) : undefined;
    return current && !list.some(t => t.id === current.id) ? [current, ...list] : list;
}

/** What the plot follows now: its schedule and day 0 (or the crop's first schedule and the plot's start). */
function startingPoint(crop: CropProfile | undefined, plotId: string, todayKey: string, options: CropScheduleTemplate[], choice?: ScheduleChoice) {
    const plot = crop?.plots.find(p => p.id === plotId);
    const resolved = crop && plot ? resolvePlotSchedule(crop, plot, todayKey, choice) : null;
    return {
        templateId: resolved?.template.id ?? options[0]?.id ?? '',
        startDate: resolved?.instance.referenceDate ?? toDayKey(plot?.startDate) ?? todayKey,
    };
}

const ScheduleMaker: React.FC<ScheduleMakerProps> = ({ crops, initialCropId, initialPlotId, todayKey, onSave, choices }) => {
    const language = useOptionalLanguage()?.language ?? 'mr'; // spec I18 — the crop in his language, never "Grapes" in Marathi mode
    const [cropId, setCropId] = useState(() => (crops.some(c => c.id === initialCropId) ? initialCropId! : crops[0]?.id ?? ''));
    const crop = crops.find(c => c.id === cropId);
    const [plotId, setPlotId] = useState(() => (crop?.plots.some(p => p.id === initialPlotId) ? initialPlotId! : crop?.plots[0]?.id ?? ''));
    const plot = crop?.plots.find(p => p.id === plotId);

    const current = useMemo(() => (crop && plot ? resolvePlotSchedule(crop, plot, todayKey, choices?.get(plot.id))?.template.id ?? null : null), [crop, plot, todayKey, choices]);
    const options = useMemo(() => (crop ? schedulesFor(crop, current) : []), [crop, current]);
    const [templateId, setTemplateId] = useState(() => startingPoint(crop, plotId, todayKey, options, choices?.get(plotId)).templateId);
    const [startDate, setStartDate] = useState(() => startingPoint(crop, plotId, todayKey, options, choices?.get(plotId)).startDate);

    // Another plot (or crop) picked: start from what THAT plot follows now.
    useEffect(() => {
        const s = startingPoint(crop, plotId, todayKey, options, choices?.get(plotId));
        setTemplateId(s.templateId);
        setStartDate(s.startDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropId, plotId]);

    // A tap on a crop picks that crop's first plot in number order (G1 before G10, as the plot row lists them); a tap on the crop that is already
    // chosen keeps its plot (redesign item 4).
    const pickCrop = (id: string) => {
        if (id === cropId) return;
        setCropId(id);
        const first = sortedNaturally(crops.find(c => c.id === id)?.plots ?? [], p => p.name)[0];
        setPlotId(first?.id ?? '');
    };

    const chosen = options.find(t => t.id === templateId);
    const dayKey = toDayKey(startDate);
    // The same day number the शेड्यूल page will then show: from day 0, less this plot's recorded shifts (V2-06).
    const todayDay = dayKey ? daysBetween(dayKey, todayKey) - shiftDaysUpTo(plot?.scheduleShifts, todayKey) : null;
    // B013: the editor's pick is for THIS plot only; the line is shown only when the pick would change this plot.
    const onlyThisPlot = !!crop && crop.plots.length > 1 && !!templateId && templateId !== current;
    const canSave = !!crop && !!plot && !!chosen && !!dayKey;

    return (
        <div className="space-y-4" style={{ fontFamily: SANS }} data-testid="schedule-editor">
            <GlassCard testId="editor-plot-card">
                <SectionHead title={SC.edPlot} />
                {/* Lane UI-7 (founder D-150) + redesign item 4 — the shared crop row (each crop's photo once), then the chosen crop's plots in the
                    shared plot selector (chips for 1 to 6, a number grid from 7, each number the plot's place among ALL the crop's plots). Same model as
                    before: one crop, one plot (the crop's first on a crop change), a row drawn only when there is something to choose. With one crop
                    there is no crop row; from 4 plots its photo stands once in a header. */}
                {(crops.length > 1 || (crop?.plots.length ?? 0) > 1) && (
                    <div className="mt-2 space-y-2.5">
                        {crops.length > 1 && (
                            <CropPlotPicker crops={crops} chosen={cropId} pickedPlotIds={plotId ? [plotId] : []} hidePlots language={language}
                                onPickCrop={pickCrop} onTogglePlot={() => undefined}
                                testIds={{ crop: key => `editor-crop-${key}`, plot: id => `editor-plot-${id}` }} />
                        )}
                        {crop && crop.plots.length > 1 && (
                            <SinglePlotSection crop={crop} plotId={plotId || null} header={crops.length === 1 && photoOnceFor(crop.plots.length)} language={language}
                                onPickPlot={setPlotId} sectionTestId="editor-plot-section" headerTestId="editor-crop-header"
                                testIds={{ plot: id => `editor-plot-${id}`, grid: 'editor-plot-grid' }} />
                        )}
                    </div>
                )}
                <p className="m-0 mt-2 px-1 text-[17px] font-black text-stone-900" data-testid="editor-plot-name">{crop ? cropNameIn(crop.name, language, crop.masterId) : '—'} · {plot?.name ?? SC.noPlots}</p>
            </GlassCard>

            {plot && (
                <GlassCard testId="editor-schedules">
                    <SectionHead title={SC.edSchedule} />
                    {options.length === 0 && <p className="m-0 mt-2 px-1 text-[15px] font-bold text-stone-600" data-testid="editor-no-schedules">{SC.edNone}</p>}
                    <div className="mt-2 space-y-2">
                        {options.map(t => {
                            const on = t.id === templateId;
                            // Redesign item 4: the chosen schedule is THE one chosen look - dark green, white letters (the small lines too), a white tick - in
                            // place of the green ring and the green "निवडलं" chip. Not chosen: white with the grey ring.
                            return (
                                <Tap key={t.id} onClick={() => setTemplateId(t.id)} aria-pressed={on} data-testid={`editor-schedule-${t.id}`}
                                    className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left ${on ? 'bg-emerald-800 text-white ring-2 ring-emerald-800' : 'bg-white ring-1 ring-stone-300'}`}>
                                    <span className="min-w-0 flex-1">
                                        <span className={`block text-[17px] font-extrabold leading-snug ${on ? 'text-white' : 'text-stone-900'}`}>{scheduleNameMr(t.name)}</span>
                                        <span className={`mt-0.5 block text-[14px] font-bold ${on ? 'text-white' : 'text-stone-600'}`}>{SC.edMeta(t.totalDurationDays ?? null, t.stages.length)}</span>
                                        <span className={`block text-[14px] font-bold ${on ? 'text-white' : 'text-stone-600'}`}>{SC.madeBy}: {OWNER_LABEL[t.ownerType] ?? OWNER_LABEL.SYSTEM_DEFAULT}</span>
                                    </span>
                                    {on && (
                                        <span data-part="tick" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-white text-white">
                                            <Check size={16} strokeWidth={4} className="text-white" aria-hidden="true" />
                                            <span className="sr-only">{SC.edPicked}</span>
                                        </span>
                                    )}
                                </Tap>
                            );
                        })}
                    </div>
                    {onlyThisPlot && <p className="m-0 mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[14.5px] font-bold text-amber-900 ring-1 ring-amber-200" data-testid="editor-this-plot-only">{SC.edThisPlotOnly}</p>}
                </GlassCard>
            )}

            {plot && chosen && (
                <GlassCard testId="editor-day-zero">
                    <SectionHead title={`${DAY_ZERO_LABEL[chosen.referenceType] ?? DAY_ZERO_LABEL.PLANTING} (${SC.edDayZero})`} />
                    <label className="mt-2 flex min-h-[52px] items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-stone-300">
                        <CalendarDays size={20} className="shrink-0 text-stone-500" aria-hidden="true" />
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="editor-date"
                            aria-label={DAY_ZERO_LABEL[chosen.referenceType] ?? DAY_ZERO_LABEL.PLANTING}
                            className="min-w-0 flex-1 bg-transparent text-[17px] font-bold text-stone-900 outline-none" />
                    </label>
                    {todayDay !== null && (
                        <p className="m-0 mt-2 px-1 text-[15px] font-bold text-stone-700" data-testid="editor-today-day">
                            {todayDay >= 0 ? SC.edTodayIs(todayDay) : SC.notStarted(-todayDay)}
                        </p>
                    )}
                </GlassCard>
            )}

            <BigButton onClick={() => canSave && onSave({ cropId, plotId, templateId, startDate: dayKey! })} disabled={!canSave} testId="editor-save">{SC.edSave}</BigButton>
        </div>
    );
};

export default ScheduleMaker;
