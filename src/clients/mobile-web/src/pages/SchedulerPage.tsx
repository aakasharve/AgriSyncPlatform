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
import { ChoiceChips, GlassCard, PageBar, SANS, Tap } from '../shared/components/ui/placeUi';
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
import { saveScheduleAbandon, saveScheduleChoice, type ScheduleChoiceTarget } from '../features/scheduler/schedulePage/saveScheduleChoice';
import { THREE_PLUS_ONE_WORDS } from '../features/scheduler/schedulePage/threePlusOneCopy';
import { ScheduleAsk } from '../features/scheduler/schedulePage/ScheduleAsk';
import { defaultScheduleForCrop } from '../features/scheduler/planning/followableDefault';
import { SCHEDULE_GATE_WORDS } from '../features/scheduler/schedulePage/scheduleGateCopy';
import { useScheduleGate } from '../features/scheduler/schedulePage/useScheduleGate';
import { BOTTOM_BAR_CLEARANCE } from '../shared/utils/bottomBar';
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
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the library opened from "हे शेड्यूल पण पाळा" follows one more on THIS plot; and the
    // working screen's toast ("हे शेड्यूल पण पाळताय" / "हे शेड्यूल सोडलं") with its undo = the reverse act queued at once.
    const [libraryMode, setLibraryMode] = useState<'crop' | 'add'>('crop');
    const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
    // The working screen's toast hides itself after 4 s (setTimeout); the timer is cleared when the toast is replaced, closed or the page goes (fix 1, L003).
    useEffect(() => {
        if (!toast) return undefined;
        const timer = window.setTimeout(() => setToast(null), 4000);
        return () => window.clearTimeout(timer);
    }, [toast]);
    const words = THREE_PLUS_ONE_WORDS[language === 'en' ? 'en' : 'mr'];
    // spec: plr-d10 lane L8b-2 (founder D-32) - the schedule each plot follows on the SERVER (or this phone's own, not yet answered).
    const choices = usePlotScheduleChoices();
    // spec: plr-d10 lane SCH-GATE-b (D-83 = 1) - what the server says about each plot's planning gate; the page asks first where it says so.
    const gate = useScheduleGate();
    const gateWords = SCHEDULE_GATE_WORDS[language === 'en' ? 'en' : 'mr'];
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

    // spec: plr-d10 lane L8b-3 - does the crop have a Checked schedule in the library this phone holds? (decides which line a free place says)
    const cropHasChecked = useMemo(() => {
        if (!crop) return false;
        const code = scheduleCropCode(crop.name);
        return libraryTemplates([crop]).some(t => scheduleCropCode(t.cropCode) === code && t.check?.state === 'Checked');
    }, [crop]);
    const followedIds = useMemo(() => new Set((resolved?.followed ?? []).map(f => f.templateId)), [resolved]);
    const outsideFull = (resolved?.followed ?? []).filter(f => f.origin !== 'Own').length >= 3;

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

    // "हे शेड्यूल पण पाळा" - follow one more on THIS plot (an adopt for this plot only; never crop-wide, never a switch).
    const followToo = (templateId: string) => {
        if (!plot) return;
        const plotKey = plot.id;
        setView('HOME');
        setLibraryMode('crop');
        void saveScheduleChoice([{ plotId: plotKey, templateId, add: true }]).then(result => {
            setChoiceNote(result.notSent.length > 0 ? words.notSent : null);
            const made = result.subscriptionIds[plotKey];
            if (made) setToast({ text: words.toastFollowing, undo: () => { void saveScheduleAbandon(made); } });
        });
    };

    // "हे सोडा" - let ONE followed schedule go (the server acts on that row only).
    const leaveSchedule = (subscriptionId: string) => {
        if (!plot) return;
        const plotKey = plot.id;
        void saveScheduleAbandon(subscriptionId).then(result => {
            if (!result.done) return;
            const dropped = result.templateId;
            setToast({ text: words.toastLeft, undo: () => { if (dropped) void saveScheduleChoice([{ plotId: plotKey, templateId: dropped, add: true }]); } });
        });
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
            {toast && (
                // Above the bottom bar, never behind it (FOOT-1: the bar's room, BOTTOM_BAR_CLEARANCE, not a height of its own).
                <div className="fixed inset-x-4 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-white shadow-lg" style={{ bottom: BOTTOM_BAR_CLEARANCE }} role="status" data-testid="schedule-toast">
                    <span className="text-[16px] font-extrabold" data-testid="schedule-toast-text">{toast.text}</span>
                    <Tap onClick={() => { const undo = toast.undo; setToast(null); undo(); }} data-testid="schedule-toast-undo"
                        className="min-h-[48px] rounded-full px-3 text-[16px] font-extrabold text-emerald-300 underline underline-offset-2">{words.undo}</Tap>
                </div>
            )}
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
        const adding = libraryMode === 'add' && !!plot;
        return shell(adding ? words.libraryTitle : SC.library, () => { setView('HOME'); setLibraryMode('crop'); }, (
            <>
                {!adding && cropChips}
                {choiceNote && <p className="m-0 px-1 text-[14px] font-bold text-stone-600" data-testid="sched-choice-note">{choiceNote}</p>}
                <ScheduleLibraryView crop={crop} allCrops={crops} adoptedScheduleId={(plot && choices.get(plot.id)?.templateId) || crop?.activeScheduleId || null}
                    onAdopt={adding ? followToo : handleAdopt}
                    plotAdd={adding ? { followedTemplateIds: followedIds, full: outsideFull, words: { follow: (resolved?.followed.length ?? 0) === 0 ? words.firstChoice : words.follow, fullWhy: words.fullButtonWhy, alreadyFollowed: words.alreadyFollowed, title: words.libraryTitle } } : undefined} />
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
                    {/* spec: plr-d10 lane SCH-GATE-b - nothing the plot may follow: no default, no ask, and the honest line (P4). */}
                    <p className="m-0 mt-1 text-[15px] font-bold text-stone-600" data-testid="sched-no-followable">{gateWords.noCheckedForCrop}</p>
                </GlassCard>
            )}
            {crop && plot && resolved && model && (
                <PlotScheduleHome plotId={plot.id} cropName={nameOf(crop)} plotName={plot.name} template={resolved.template} source={resolved.source} model={model} clips={clips} checkNote={checkNote}
                    tab={tab} onTab={setTab} onOpenDay={setOpenDayKey} onLibrary={() => { setLibraryMode('crop'); setView('LIBRARY'); }}
                    followed={resolved.followed} cropHasChecked={cropHasChecked} defaultKind={resolved.defaultKind}
                    trial={gate.inTrial(plot.id) ? { named: gate.stateOf(plot.id)?.trialStage ?? null } : undefined}
                    ask={gate.needsSchedule(plot.id) && defaultScheduleForCrop(crop.name) ? (
                        <ScheduleAsk cropName={crop.name} plotId={plot.id} where="page"
                            onSaved={result => setChoiceNote(result.notSent.length > 0 ? words.notSent : null)} />
                    ) : undefined}
                    onAddSchedule={() => { setLibraryMode('add'); setView('LIBRARY'); }} onLeaveSchedule={leaveSchedule} />
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
