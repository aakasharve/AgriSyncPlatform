/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the आजची कामे tab, on REAL data:
 *
 *   work home ── "झालेले काम सांगा" ──> crop question ──> that crop's plots + the mic (same screen)
 *            └─ "आजची हजेरी" (owner / labour grant only) ──> the real हजेरी screen
 *
 * Built from the founder-approved preview (PLR-D5, PLR-D6 :13-16, PLR-D7 §2b, PLR-D9 §6) but wired to
 * the real stores: the selection IS the app's `logScope` (several crops and selected plots allowed,
 * as the real `CropSelector` contract allows), the mic IS the real recorder (passed in by the router).
 * Nothing here is sample data.
 *
 * Lane E1 (founder 2026-10-30: "I don't want this [old] UI anywhere in the app") — the hand-filled form step is gone:
 * the typing sheet's "किंवा फॉर्ममध्ये स्वतः भरा" no longer leads anywhere; typed entry stays through the recorder's
 * "बोलता येत नसेल तर इथे लिहा" sheet. Lane MIC-1 — the ONE mic (`core/speak`) opens this same crop → plot → mic flow
 * when it does not know the place yet (`startAt="entry"`, `onExit`: back from the crop question leaves it).
 *
 * Back is ONE step on a big labelled "मागे" and never leaves the app: mic/plots -> crop -> home
 * (the हजेरी arrival goes back to हजेरी, where it came from). Android hardware Back follows the same
 * steps (`useBackDismiss`). Tapping the आजची कामे tab again (`homeRequested`) returns here, fresh.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A1; the founder's final design, 28 Nov) — on the log tab's full-screen
 * flow (flag on, not the हजेरी door) the plot page and the mic page are TWO pages (`MicPage.tsx`): he chooses the plot(s), then one
 * swipe up or a tap on the green bar opens the mic page, which arms the 3 s countdown (`armSeq` bumps on each opening, never on a plot
 * tap). A farm with ONE plot has nothing to choose on the plot page: the crop tap that picks it (`cropSelection.toggleCrop`) opens
 * the mic page straight away. Arriving with a place already chosen (back from the result, an error, the whole farm chosen for him)
 * opens the mic page unarmed (spec V2-5). "प्लॉट बदला" and Back go from the mic page to the plot page. Elsewhere (the ONE mic's
 * in-page flow, the flag off) the mic stays under the plots, as before.
 */
import React, { useEffect, useRef, useState } from 'react';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import type { CropProfile, DailyLog } from '../../../../types';
import type { LogScope, LogSegment } from '../../../../domain/types/log.types';
import CropSelector from '../../../context/components/CropSelector';
import type { StepperStep } from '../../../context/components/CropPlotStepper';
import FlowBackButton from '../../../context/components/FlowBackButton';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { SathiAskBand } from './SathiAskBand';
import { WorkHome } from './WorkHome';
import type { PlanDoorProps } from '../../../plannedWork/components/PlanDoor';
import type { RunningCost } from './RunningCostCard';
import type { TodayAttendance } from './todayAttendance';
import { SegmentBanner, SegmentCancel } from './SegmentBanner';
import { STEPPER_LABELS } from './entryWords';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import { FEATURE_FLAGS } from '../../../../app/featureFlags';
import { placeLabelOf } from '../../../../core/navigation/placeLabel';
import { resultStr } from '../voiceResult/resultStrings';
import { VoiceLayer } from '../voiceFlowV2/VoiceLayer';
import { clearEntryOpening, peekEntryOpening } from './entryOpening';
import { MicPage, MicPageBar, useSwipeUp } from './MicPage';

const SANS = "'Noto Sans Devanagari', sans-serif";
const EMPTY_SCOPE: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

export type FlowStep = 'home' | 'entry';

export interface RecorderHooks {
    /** The recorder says when it starts and stops listening (the choices hide while it listens). */
    onRecordingChange: (recording: boolean) => void;
    /** spec voice-flow-v2-2026-11-23 — bumps on each plot tap made on this screen (the mic card's 7 s ring); 0 = arrived
     *  with a plot already chosen (card, no ring). Absent = flag off, the हजेरी door, or one part said again. */
    armSeq?: number;
}

export interface LogEntryFlowProps {
    crops: CropProfile[];
    logScope: LogScope;
    setLogScope: (scope: LogScope) => void;
    /** Make sure the mic (voice mode) is what a fresh choice leads to. */
    onChooseVoice: () => void;
    /** Arrived from the हजेरी mic: no home, and back from the crop question returns to हजेरी. */
    labourIntent: boolean;
    onBackToLabour: () => void;
    onClearLabourIntent: () => void;
    /** One part of a log is being said again: straight to the mic, with its band and cancel. */
    recordingSegment: LogSegment | null;
    onCancelSegment: () => void;
    /** The आजची कामे tab was tapped: show the work home, fresh. */
    homeRequested?: boolean;
    onHomeRequestHandled?: () => void;
    /** Present only for someone who may manage labour (owner tier or the labour grant). */
    onOpenAttendance?: () => void;
    /** Lane FX-1 — the हजेरी card's state on the work home (today's work and headcount, each told or not). */
    attendance?: TodayAttendance;
    /** Lane FX-1 — both told: the हजेरी card opens the names. */
    onOpenAttendanceNames?: () => void;
    /** The running-cost card for the home; absent = not shown to this person. */
    cost?: RunningCost;
    /** Lane L8c-2 - the plan door on the work home (its kind follows the server's authorities); absent = none. */
    planDoor?: PlanDoorProps;
    /** Repair R1-g Part 2 - the day card on the work home (under the doors); absent = none. */
    dayCard?: React.ReactNode;
    /** Sathi's question he chose to answer by speaking (wave-3.7) — stays visible above the mic. */
    pinnedQuestion?: string | null;
    /** Lane MIC-1 — why he is speaking (the ONE mic's band), shown above the mic. */
    micLead?: React.ReactNode;
    renderRecorder: (hooks: RecorderHooks) => React.ReactNode;
    /** Lane MIC-1 — start on the crop question (no work home), and leave the flow by this instead of going home. */
    startAt?: 'entry';
    onExit?: () => void;
    /** Lane OF (D-60) — a past day he chose ("30 ऑक्टो"): the crop and plot questions name it. */
    forDay?: string;
    /** spec voice-flow-v2-2026-11-23 (F2): draw the crop / plot / mic step as the voice journey's full-screen layer. Off = in the page, as before. */
    fullScreen?: boolean;
    /** The phone's saved logs: the layer's "या महिन्यात N दिवस" chip counts from them (only for one chosen plot, only when the phone's pull covers the month). */
    history?: readonly DailyLog[];
}

/** The app's flat scope as the selector's crop -> plots map (the same mapping the old screen used). */
export function plotsByCrop(crops: CropProfile[], scope: LogScope): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    scope.selectedCropIds.forEach(cropId => {
        map[cropId] = scope.selectedPlotIds.filter(pid => crops.find(c => c.id === cropId)?.plots.some(p => p.id === pid));
    });
    return map;
}

/**
 * spec plr-d10 (part 03, A1) — the farm on this screen has exactly ONE plot: the crop tap already picks it (a crop with a single plot has
 * that plot chosen for him, `cropSelection.toggleCrop`), so the plot page would hold no choice and the mic page opens at once.
 */
export const hasOnlyOnePlot = (crops: readonly { plots: readonly unknown[] }[]): boolean =>
    crops.reduce((n, c) => n + c.plots.length, 0) === 1;

export const LogEntryFlow: React.FC<LogEntryFlowProps> = (props) => {
    const {
        crops, logScope, setLogScope, onChooseVoice, labourIntent, onBackToLabour, onClearLabourIntent,
        recordingSegment, onCancelSegment, homeRequested = false, onHomeRequestHandled, onOpenAttendance, attendance, onOpenAttendanceNames, cost, planDoor, dayCard,
        pinnedQuestion, micLead, renderRecorder, startAt, onExit, forDay, fullScreen = false, history,
    } = props;
    const hasSelection = logScope.selectedCropIds.length > 0;
    // Repair R1-g 1a (CTO ruling 2) — the first-record card's "बोलायला सुरुवात करा" asked the log tab to open on the crop
    // question, the step "झालेले काम सांगा" opens (`entryOpening.ts`). Read once, by the log tab's own flow only (the ONE
    // mic's flow has `startAt`); a tab tap (`homeRequested`) still wins.
    const [openOnCrop] = useState(() => startAt === undefined && !homeRequested && !labourIntent && peekEntryOpening() === 'crop');
    useEffect(() => { if (startAt === undefined) clearEntryOpening(); }, [startAt]);
    const [step, setStep] = useState<FlowStep>(() => (startAt ?? (openOnCrop ? 'entry' : homeRequested || (!labourIntent && !hasSelection) ? 'home' : 'entry')));
    const [entryStep, setEntryStep] = useState<StepperStep>(() => (hasSelection && !homeRequested && !openOnCrop ? 'plot' : 'crop'));
    const [recording, setRecording] = useState(false);
    // spec voice-flow-v2-2026-11-23 (H7) — only with the flag on does a plot tap change any new state.
    const micCountdown = FEATURE_FLAGS.voiceFlowV2 === true && !labourIntent;
    const [armSeq, setArmSeq] = useState(0);
    // spec plr-d10 (part 03, A1) — the plot page and the mic page, two pages, on the log tab's full-screen flow only.
    const twoPages = micCountdown && fullScreen;
    const [micPage, setMicPage] = useState(() => twoPages && step === 'entry' && entryStep === 'plot');
    /** He opened the mic page (the green bar, a swipe up, or a farm with one plot): its countdown is armed by this opening. */
    const openMicPage = () => {
        hapticFeedback.light();
        setMicPage(true);
        setArmSeq(n => n + 1);
    };

    const goHome = () => {
        setLogScope(EMPTY_SCOPE);
        setEntryStep('crop');
        setMicPage(false);
        setStep('home');
        if (labourIntent) onClearLabourIntent();
    };
    const backFromCrop = () => (onExit ? onExit() : labourIntent ? onBackToLabour() : goHome());
    const backOneStep = () => {
        if (micPage) { setMicPage(false); return; }
        if (entryStep === 'plot') { setLogScope(EMPTY_SCOPE); setEntryStep('crop'); return; }
        backFromCrop();
    };

    // The tab tap: fresh home — but never under a live recording (that would throw his words away).
    const latest = useRef({ goHome, recording, onHomeRequestHandled });
    latest.current = { goHome, recording, onHomeRequestHandled };
    useEffect(() => {
        if (!homeRequested) return;
        const { goHome: home, recording: busy, onHomeRequestHandled: handled } = latest.current;
        handled?.();
        if (!busy) home();
    }, [homeRequested]);

    useBackDismiss(step !== 'home' && !recording && !recordingSegment, backOneStep);

    // "The mic right there, no scroll": the real header is taller than the preview's (PLR-D9 T9, not
    // ruled), so the moment a plot (or the whole farm) is chosen the mic card is brought into view, and
    // when he starts speaking the recorder is lifted to the top — he never has to scroll to find either.
    const micAnchor = useRef<HTMLDivElement | null>(null);
    const ready = logScope.selectedPlotIds.length > 0 || logScope.selectedCropIds.includes('FARM_GLOBAL');
    useEffect(() => {
        if (step !== 'entry' || !ready) return;
        const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        micAnchor.current?.scrollIntoView?.({ block: recording ? 'start' : 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, [step, ready, recording]);
    // A1 — one swipe up on the plot page, once a place is chosen, opens the mic page (as the green bar does).
    const plotPage = useRef<HTMLDivElement | null>(null);
    useSwipeUp(plotPage, twoPages && !micPage && step === 'entry' && ready, openMicPage);

    const hooks: RecorderHooks = micCountdown ? { onRecordingChange: setRecording, armSeq } : { onRecordingChange: setRecording };
    const placeOf = (language: string | undefined) => placeLabelOf(logScope, crops, language, resultStr(language).wholeFarm);
    const monthOf = { history, plotId: logScope.selectedPlotIds.length === 1 ? logScope.selectedPlotIds[0] : null };
    const pinned = pinnedQuestion ? (
        <div data-testid="shramsathi-pinned-question" className="mb-3 rounded-xl border px-4 py-3 text-[16px] font-medium"
            style={{ fontFamily: SANS, backgroundColor: '#FEF8EF', borderColor: '#F6E3C4', color: '#B4650F' }}>
            {pinnedQuestion}
        </div>
    ) : null;

    if (recordingSegment) {
        return (
            <div className="px-1" data-testid="log-entry-flow" data-step="segment" style={{ fontFamily: SANS }}>
                <SegmentBanner segment={recordingSegment} />
                {renderRecorder({ onRecordingChange: setRecording })}
                {!recording && <SegmentCancel onCancel={onCancelSegment} />}
            </div>
        );
    }

    if (step === 'home') {
        return (
            <div data-testid="log-entry-flow" data-step="home">
                {/* The हजेरी card's button is this same "झालेले काम सांगा" step: the crop question first (rule CTX-1). */}
                <WorkHome onTell={() => { setLogScope(EMPTY_SCOPE); setEntryStep('crop'); setStep('entry'); }} onAttendance={onOpenAttendance}
                    attendance={attendance} onAttendanceNames={onOpenAttendanceNames} cost={cost} planDoor={planDoor} dayCard={dayCard} />
            </div>
        );
    }

    if (twoPages && micPage) {
        // A1 — the mic page: "प्लॉट बदला", then THE recorder; its card counts 3 s down when this opening armed it.
        return (
            <VoiceLayer step="mic" monthOf={monthOf} placeLabel={placeOf}>
                <div data-testid="log-entry-flow" data-step="mic" data-recording={recording ? 'yes' : 'no'}>
                    <MicPage recording={recording} onChangePlot={() => setMicPage(false)}>
                        {micLead}
                        {pinned}
                        {renderRecorder(hooks)}
                    </MicPage>
                </div>
            </VoiceLayer>
        );
    }

    const entry = (
        <div ref={plotPage} data-testid="log-entry-flow" data-step={entryStep} data-recording={recording ? 'yes' : 'no'}>
            {entryStep === 'crop' && (
                <div className="flex items-center gap-2 px-3 pt-2">
                    <FlowBackButton onClick={backFromCrop} testId="entry-back-home" />
                </div>
            )}
            <div id="crop-selector-container">
                <CropSelector
                    mode="log" layout="stepper" crops={crops}
                    selectedCrops={logScope.selectedCropIds}
                    selectedPlots={plotsByCrop(crops, logScope)}
                    onSelectionChange={(newCrops, newPlots) => {
                        const plots = Object.values(newPlots).flat();
                        setLogScope({ selectedCropIds: newCrops, selectedPlotIds: plots, mode: plots.length > 1 ? 'multi' : 'single', applyPolicy: 'broadcast' });
                        if (plots.length > 0 || newCrops.includes('FARM_GLOBAL')) {
                            onChooseVoice();
                            // A1 — two pages: a plot tap never arms the countdown (opening the mic page does); a one-plot farm opens it now.
                            if (twoPages) { if (plots.length > 0 && hasOnlyOnePlot(crops)) openMicPage(); }
                            else if (micCountdown) setArmSeq(n => n + 1);
                        }
                    }}
                    stepper={{
                        step: entryStep,
                        onStepChange: setEntryStep,
                        lead: ctx => <SathiAskBand {...ctx} labour={labourIntent} forDay={forDay} />,
                        labels: STEPPER_LABELS,
                        focusFooter: recording,
                        footer: twoPages
                            ? () => <MicPageBar placeOf={placeOf} onOpen={openMicPage} />
                            : () => (
                                // scroll margins keep the card clear of the bottom bar (its whole room, lane FX-1) and of the top edge
                                <div ref={micAnchor} className="scroll-mt-2" style={{ scrollMarginBottom: BOTTOM_BAR_CLEARANCE }} data-testid="flow-mic-anchor">
                                    {micLead}
                                    {pinned}
                                    {renderRecorder(hooks)}
                                </div>
                            ),
                    }}
                />
            </div>
        </div>
    );
    if (!fullScreen) return entry;
    // F2: from the green door on, the whole step is one full-screen layer (no farm header, tabs or bottom bar); the place chip is
    // drawn once a place is chosen. The right-hand chip is left out: the app holds no "days logged this month" number to show.
    return (
        <VoiceLayer step={entryStep} monthOf={monthOf} placeLabel={placeOf}>
            {entry}
        </VoiceLayer>
    );
};

export default LogEntryFlow;
