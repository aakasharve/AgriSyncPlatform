/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15) — शेड्यूल, behind the raised bottom-bar button, in
 * plain Marathi and the PLR-D8 preview's look, on the plot's REAL schedule and EVERY real log of that plot.
 * One page bar with one big "← मागे" (goBackOr).
 *
 * Every feature of the old English page is kept and reachable from here:
 *   crop / plot pick ............ the chips under the page bar (shown when there is a choice)
 *   where you are ............... PlotScheduleHome (day N of total, stage line, filled bar, every stage)
 *   owner badge + lineage ....... on the dark card ("कोणी बनवलं")
 *   'N days behind' banner ...... under the card
 *   today's tasks ............... the आज list (plus आधी राहिलेलं काम and tomorrow)
 *   last spray / irrigation, the risk card, today's spend → MoneyLens, Close Day ... "आजचं आणि बाकीचं"
 *   library + adopt ............. "शेड्यूल लायब्ररी" (its own page bar, ← मागे returns here)
 *   schedule editor ............. "शेड्यूल बदला" (ScheduleMaker: plot, schedule, day-0 date — what takes effect)
 *   the day grid ................ "दिवसवार तक्ता" (SchedulerTimeline)
 * Tapping a day anywhere (strip, past day, owed line, grid) opens that day's sheet (it used to console.log).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CropProfile, DailyLog, PlannedTask, ResourceItem } from '../types';
import { getDateKey } from '../core/domain/services/DateKeyService';
import { useBackDismiss } from '../core/navigation/useBackDismiss';
import { computeDayState, getTaskCompletion } from '../shared/utils/dayState';
import { financeSelectors } from '../features/finance/financeSelectors';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { ChoiceChips, GlassCard, PageBar, SANS } from '../shared/components/ui/placeUi';
import SchedulerTimeline from '../features/scheduler/components/SchedulerTimeline';
import ScheduleMaker from '../features/scheduler/components/ScheduleMaker';
import ScheduleLibraryView, { libraryTemplates } from '../features/scheduler/components/ScheduleLibraryView';
import { followedCheckNote } from '../features/scheduler/schedulePage/followedCheck';
import { scheduleCropCode } from '../infrastructure/reference/TemplateCatalog';
import { PlotScheduleHome } from '../features/scheduler/schedulePage/PlotScheduleHome';
import { ScheduleDaySheet } from '../features/scheduler/schedulePage/ScheduleDaySheet';
import { ScheduleTools } from '../features/scheduler/schedulePage/ScheduleTools';
import type { ScheduleTab } from '../features/scheduler/schedulePage/ScheduleTabs';
import { SC } from '../features/scheduler/schedulePage/scheduleCopy';
import { buildScheduleModel, dueTodayCount } from '../features/scheduler/schedulePage/scheduleModel';
import { adoptForCrop, applyEditorChoice, resolvePlotSchedule, type EditorChoice } from '../features/scheduler/schedulePage/resolveSchedule';
import { usePlotClips } from '../features/scheduler/schedulePage/usePlotClips';
import { usePlotScheduleChoices } from '../features/scheduler/schedulePage/usePlotScheduleChoices';
import { saveScheduleChoice, type ScheduleChoiceTarget } from '../features/scheduler/schedulePage/saveScheduleChoice';
import { useOptionalLanguage } from '../i18n/LanguageContext';
import { cropNameIn } from '../shared/names/namesIn';

interface SchedulerPageProps {
    crops: CropProfile[];
    logs: DailyLog[];
    tasks?: PlannedTask[];
    onUpdateCrops: (crops: CropProfile[]) => void;
    /**
     * Kept on the props contract (the route passes them). Only the old editor's growth-stages builder used
     * them, to remember custom items for this session; that builder is gone (it saved nothing the app reads).
     */
    userResources?: ResourceItem[];
    onAddResource?: (r: ResourceItem) => void;
    /** Kept on the props contract; the page has no "add task" door (it never drew one). */
    onOpenTaskCreator?: () => void;
    onCloseDay?: () => void;
    /** The page bar's "← मागे" (route: goBackOr). */
    onBack?: () => void;
}

type View = 'HOME' | 'LIBRARY' | 'EDITOR' | 'GRID';

const SchedulerPage: React.FC<SchedulerPageProps> = ({ crops, logs, tasks = [], onUpdateCrops, onCloseDay, onBack }) => {
    // spec I18 — a crop's name in his language (the server's "Grapes" is "द्राक्ष" in Marathi mode).
    const language = useOptionalLanguage()?.language ?? 'mr';
    const nameOf = (c: { name: string; masterId?: string }): string => cropNameIn(c.name, language, c.masterId);
    const [cropId, setCropId] = useState('');
    const [plotId, setPlotId] = useState('');
    const [view, setView] = useState<View>('HOME');
    const [tab, setTab] = useState<ScheduleTab>('today');
    const [openDayKey, setOpenDayKey] = useState<string | null>(null);
    const [moneyOpen, setMoneyOpen] = useState(false);
    const [choiceNote, setChoiceNote] = useState<string | null>(null);
    // spec: plr-d10 lane L8b-2 (founder D-32) - the schedule each plot follows on the SERVER (or this phone's own, not yet answered).
    const choices = usePlotScheduleChoices();
    const todayKey = getDateKey();

    const pick = (id: string) => {
        setCropId(id);
        setPlotId(crops.find(c => c.id === id)?.plots[0]?.id ?? '');
    };

    useEffect(() => {
        // First crop and its first plot, as before — and again if the chosen crop is no longer there.
        if (crops.length > 0 && !crops.some(c => c.id === cropId)) pick(crops[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropId, crops]);

    // Another screen can ask to open the library for a crop (sessionStorage hand-off, kept as before).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        let target: string | null = null;
        try { target = window.sessionStorage.getItem('schedule_library_crop_id'); } catch { target = null; }
        if (!target) return;
        if (crops.some(c => c.id === target)) { pick(target); setView('LIBRARY'); }
        try { window.sessionStorage.removeItem('schedule_library_crop_id'); } catch { /* storage blocked */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [crops]);

    useBackDismiss(view !== 'HOME', () => setView('HOME'));

    const crop = crops.find(c => c.id === cropId);
    const plot = crop?.plots.find(p => p.id === plotId) ?? null;
    useEffect(() => {
        if (crop && crop.plots.length > 0 && !plot) setPlotId(crop.plots[0].id);
    }, [crop, plot]);
    const resolved = useMemo(() => (crop && plot ? resolvePlotSchedule(crop, plot, todayKey, plot ? choices.get(plot.id) : undefined) : null), [crop, plot, todayKey, choices]);
    const model = useMemo(() => (resolved && plot
        ? buildScheduleModel({ template: resolved.template, instance: resolved.instance, plotId: plot.id, logs, todayKey, shifts: plot.scheduleShifts })
        : null), [resolved, plot, logs, todayKey]);
    const clips = usePlotClips(plot?.id ?? null);

    // The risk card and last-action tiles (V2-01). Today's open schedule tasks come from the page's OWN model —
    // the आज card's lines — never from `computeDayState().pendingCount`, whose schedule half still reads the
    // app's built-in stand-in schedule. So no crops are handed to it here: only the last spray / water (which
    // read this plot's logs) and the farmer's own to-do tasks (same rule as before) are taken from the day state.
    const facts = useMemo(() => {
        const scope = { selectedCropIds: cropId ? [cropId] : undefined, selectedPlotIds: plotId ? [plotId] : undefined };
        const { lastActions } = computeDayState({ logs, crops: [], tasks: [], date: todayKey, ...scope });
        return { dueToday: model ? dueTodayCount(model) : 0, tasksOpen: getTaskCompletion(tasks, todayKey, scope).pending, lastActions };
    }, [logs, tasks, todayKey, cropId, plotId, model]);
    const moneyFilters = useMemo(() => ({ fromDate: todayKey, toDate: todayKey, cropId: cropId || undefined, plotId: plotId || undefined }), [todayKey, cropId, plotId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const todaySpend = useMemo(() => financeSelectors.getTotalCost(moneyFilters), [moneyFilters, logs.length]);
    const libraryCount = useMemo(() => libraryTemplates(crops).length, [crops]);
    // spec: plr-d10 lane L8b-1F - what to say under a followed schedule that is not checked / was withdrawn (R7, R8).
    const checkNote = useMemo(() => {
        if (!crop || !plot || !resolved || resolved.source === 'default') return null;
        const code = scheduleCropCode(crop.name);
        const hasChecked = libraryTemplates([crop]).some(t => scheduleCropCode(t.cropCode) === code && t.check?.state === 'Checked' && t.id !== resolved.template.id);
        return followedCheckNote(resolved.template, choices.get(plot.id)?.checkState, hasChecked);
    }, [crop, plot, resolved, choices]);

    const saveCrops = (next: CropProfile[]) => onUpdateCrops(next);

    const handleAdopt = (templateId: string) => {
        if (!crop) return;
        const ok = typeof window !== 'undefined' ? window.confirm(SC.adoptConfirm(cropNameIn(crop.name, 'mr', crop.masterId))) : true;
        if (!ok) return;
        saveCrops(adoptForCrop(crops, crop.id, templateId, todayKey));
        // The library's adopt = every plot of the crop (founder C2); saved on the server, nothing on the screen moves (D-32).
        sendChoice(crop.plots.map(p => ({ plotId: p.id, templateId })));
    };

    // spec: plr-d10 lane L8b-2 - the choice is queued for the server and kept here at once. A plot the server cannot be told
    // about yet (no crop season there) keeps it on this phone, and the page says so in one line.
    const sendChoice = (targets: ScheduleChoiceTarget[]) => {
        setChoiceNote(null);
        void saveScheduleChoice(targets).then(
            result => setChoiceNote(result.notSent.length > 0 ? SC.choiceNotSent : null),
            () => setChoiceNote(SC.choiceNotSent),
        );
    };

    // The editor's choice really takes effect: the schedule is adopted for the crop, the plot's day 0 is set,
    // and the page comes back on that crop and plot.
    const handleEditorSave = (choice: EditorChoice) => {
        saveCrops(applyEditorChoice(crops, choice, todayKey));
        // The editor's save = that plot only (founder C2), with its day 0.
        sendChoice([{ plotId: choice.plotId, templateId: choice.templateId, referenceDate: choice.startDate }]);
        setCropId(choice.cropId);
        setPlotId(choice.plotId);
        setView('HOME');
    };

    const cropChips = crops.length > 1 && (
        <div className="space-y-1" data-testid="crop-pick">
            <p className="m-0 px-1 text-[13.5px] font-extrabold text-stone-600">{SC.cropPick}</p>
            <ChoiceChips items={crops.map(c => [c.id, nameOf(c)] as const)} value={cropId} onPick={pick} testId="pick-crop" />
        </div>
    );

    const shell = (title: string, back: (() => void) | undefined, body: React.ReactNode) => (
        <div className="relative mx-auto max-w-4xl animate-in fade-in px-4 pb-28 sm:px-6" style={{ fontFamily: SANS }} data-testid="schedule-page" data-view={view}>
            <PageBar title={title} onBack={back} />
            <div className="space-y-4">{body}</div>
            <MoneyLensDrawer isOpen={moneyOpen} onClose={() => setMoneyOpen(false)} filters={moneyFilters} />
        </div>
    );

    if (crops.length === 0) {
        return shell(SC.title, onBack, (
            <GlassCard testId="sched-no-crops">
                <p className="m-0 text-[18px] font-black text-stone-900">{SC.noCrops}</p>
                <p className="m-0 mt-1 text-[15px] font-bold text-stone-600">{SC.noCropsHint}</p>
            </GlassCard>
        ));
    }

    if (view === 'LIBRARY') {
        return shell(SC.library, () => setView('HOME'), (
            <>
                {cropChips}
                {choiceNote && <p className="m-0 px-1 text-[14px] font-bold text-stone-600" data-testid="sched-choice-note">{choiceNote}</p>}
                <ScheduleLibraryView crop={crop} allCrops={crops} adoptedScheduleId={(plot && choices.get(plot.id)?.templateId) || crop?.activeScheduleId || null} onAdopt={handleAdopt} />
            </>
        ));
    }

    if (view === 'EDITOR') {
        return shell(SC.editor, () => setView('HOME'), (
            <ScheduleMaker crops={crops} initialCropId={cropId} initialPlotId={plotId} todayKey={todayKey} onSave={handleEditorSave} choices={choices} />
        ));
    }

    const daySheet = openDayKey && model?.byKey.get(openDayKey);
    const sheet = daySheet ? (
        <ScheduleDaySheet day={daySheet} stageName={model?.stages.find(s => s.id === daySheet.stageId)?.name ?? null}
            clips={clips.get(daySheet.key) ?? []} onClose={() => setOpenDayKey(null)} />
    ) : null;

    if (view === 'GRID' && model && plot) {
        return shell(SC.grid, () => setView('HOME'), (
            <>
                <p className="m-0 px-1 text-[16px] font-extrabold text-stone-800" data-testid="grid-plot">{crop ? nameOf(crop) : ''} · {plot.name}</p>
                <SchedulerTimeline model={model} onOpenDay={setOpenDayKey} />
                {sheet}
            </>
        ));
    }

    return shell(SC.title, onBack, (
        <>
            {choiceNote && <p className="m-0 px-1 text-[14px] font-bold text-stone-600" data-testid="sched-choice-note">{choiceNote}</p>}
            {cropChips}
            {crop && crop.plots.length > 1 && (
                <div className="space-y-1" data-testid="plot-pick">
                    <p className="m-0 px-1 text-[13.5px] font-extrabold text-stone-600">{SC.plotPick}</p>
                    <ChoiceChips items={crop.plots.map(p => [p.id, p.name] as const)} value={plotId} onPick={setPlotId} testId="pick-plot" />
                </div>
            )}
            {crop && !plot && <GlassCard testId="sched-no-plot"><p className="m-0 text-[17px] font-black text-stone-900">{SC.noPlots}</p></GlassCard>}
            {crop && plot && !resolved && (
                <GlassCard testId="sched-no-schedule">
                    <p className="m-0 text-[18px] font-black text-stone-900">{nameOf(crop)} · {plot.name}</p>
                    <p className="m-0 mt-1 text-[17px] font-extrabold text-stone-900">{SC.noSchedule}</p>
                    <p className="m-0 mt-1 text-[15px] font-bold text-stone-600">{SC.noScheduleHint}</p>
                </GlassCard>
            )}
            {crop && plot && resolved && model && (
                <PlotScheduleHome cropName={nameOf(crop)} plotName={plot.name} template={resolved.template} source={resolved.source} model={model} clips={clips} checkNote={checkNote}
                    tab={tab} onTab={setTab} onOpenDay={setOpenDayKey} onLibrary={() => setView('LIBRARY')} />
            )}
            <ScheduleTools
                facts={facts}
                todaySpend={todaySpend}
                onOpenMoney={() => setMoneyOpen(true)}
                onCloseDay={onCloseDay}
                libraryCount={libraryCount}
                onLibrary={() => setView('LIBRARY')}
                onEditor={() => setView('EDITOR')}
                onGrid={model ? () => setView('GRID') : undefined}
            />
            {sheet}
        </>
    ));
};

export default SchedulerPage;
