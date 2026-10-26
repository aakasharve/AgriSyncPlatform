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
 * as the real `CropSelector` contract allows), the mic IS the real recorder (passed in by the router),
 * the typed form IS the real `ManualEntry`. Nothing here is sample data.
 *
 * Back is ONE step on a big labelled "मागे" and never leaves the app: mic/plots -> crop -> home
 * (the हजेरी arrival goes back to हजेरी, where it came from). Android hardware Back follows the same
 * steps (`useBackDismiss`). Tapping the आजची कामे tab again (`homeRequested`) returns here, fresh.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { CropProfile } from '../../../../types';
import type { LogScope, LogSegment } from '../../../../domain/types/log.types';
import CropSelector from '../../../context/components/CropSelector';
import type { StepperStep } from '../../../context/components/CropPlotStepper';
import FlowBackButton from '../../../context/components/FlowBackButton';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { TypedTag } from '../../../voice/components/recorder/TypedEntry';
import { SathiAskBand } from './SathiAskBand';
import { WorkHome } from './WorkHome';
import type { RunningCost } from './RunningCostCard';
import { SegmentBanner, SegmentCancel } from './SegmentBanner';
import { FORM_WORDS, STEPPER_LABELS } from './entryWords';

const SANS = "'Noto Sans Devanagari', sans-serif";
const EMPTY_SCOPE: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

export type FlowStep = 'home' | 'entry' | 'form';

export interface RecorderHooks {
    /** The recorder says when it starts and stops listening (the choices hide while it listens). */
    onRecordingChange: (recording: boolean) => void;
    /** Opens the hand-filled form step (from the typing sheet). */
    onOpenForm: () => void;
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
    /** The running-cost card for the home; absent = not shown to this person. */
    cost?: RunningCost;
    /** Sathi's question he chose to answer by speaking (wave-3.7) — stays visible above the mic. */
    pinnedQuestion?: string | null;
    renderRecorder: (hooks: RecorderHooks) => React.ReactNode;
    renderForm: () => React.ReactNode;
    /** Called when he leaves speaking for the hand-filled form. */
    onLeaveVoice?: () => void;
}

/** The app's flat scope as the selector's crop -> plots map (the same mapping the old screen used). */
export function plotsByCrop(crops: CropProfile[], scope: LogScope): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    scope.selectedCropIds.forEach(cropId => {
        map[cropId] = scope.selectedPlotIds.filter(pid => crops.find(c => c.id === cropId)?.plots.some(p => p.id === pid));
    });
    return map;
}

export const LogEntryFlow: React.FC<LogEntryFlowProps> = (props) => {
    const {
        crops, logScope, setLogScope, onChooseVoice, labourIntent, onBackToLabour, onClearLabourIntent,
        recordingSegment, onCancelSegment, homeRequested = false, onHomeRequestHandled, onOpenAttendance, cost,
        pinnedQuestion, renderRecorder, renderForm, onLeaveVoice,
    } = props;
    const hasSelection = logScope.selectedCropIds.length > 0;
    const [step, setStep] = useState<FlowStep>(() => (homeRequested || (!labourIntent && !hasSelection) ? 'home' : 'entry'));
    const [entryStep, setEntryStep] = useState<StepperStep>(() => (hasSelection && !homeRequested ? 'plot' : 'crop'));
    const [recording, setRecording] = useState(false);

    const goHome = () => {
        setLogScope(EMPTY_SCOPE);
        setEntryStep('crop');
        setStep('home');
        if (labourIntent) onClearLabourIntent();
    };
    const backFromCrop = () => (labourIntent ? onBackToLabour() : goHome());
    const backOneStep = () => {
        if (step === 'form') { setStep('entry'); return; }
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

    const hooks: RecorderHooks = {
        onRecordingChange: setRecording,
        onOpenForm: () => { onLeaveVoice?.(); setStep('form'); },
    };

    if (recordingSegment) {
        return (
            <div className="px-1" data-testid="log-entry-flow" data-step="segment" style={{ fontFamily: SANS }}>
                <SegmentBanner segment={recordingSegment} />
                {renderRecorder(hooks)}
                {!recording && <SegmentCancel onCancel={onCancelSegment} />}
            </div>
        );
    }

    if (step === 'home') {
        return (
            <div data-testid="log-entry-flow" data-step="home">
                <WorkHome onTell={() => { setLogScope(EMPTY_SCOPE); setEntryStep('crop'); setStep('entry'); }} onAttendance={onOpenAttendance} cost={cost} />
            </div>
        );
    }

    if (step === 'form') {
        return (
            <div className="px-1 pt-2" data-testid="log-entry-flow" data-step="form" style={{ fontFamily: SANS }}>
                <div className="mb-3 flex items-center gap-2 px-2">
                    <FlowBackButton onClick={() => setStep('entry')} testId="form-back" />
                    <h2 className="m-0 min-w-0 flex-1 truncate text-[20px] font-extrabold text-stone-900">{FORM_WORDS.title}</h2>
                    <TypedTag testId="form-typed-tag" />
                </div>
                {renderForm()}
            </div>
        );
    }

    return (
        <div data-testid="log-entry-flow" data-step={entryStep} data-recording={recording ? 'yes' : 'no'}>
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
                        if (plots.length > 0 || newCrops.includes('FARM_GLOBAL')) onChooseVoice();
                    }}
                    stepper={{
                        step: entryStep,
                        onStepChange: setEntryStep,
                        lead: ctx => <SathiAskBand {...ctx} labour={labourIntent} />,
                        labels: STEPPER_LABELS,
                        focusFooter: recording,
                        footer: () => (
                            // scroll margins keep the card clear of the bottom bar (nav ~84px) and of the top edge
                            <div ref={micAnchor} className="scroll-mb-28 scroll-mt-2" data-testid="flow-mic-anchor">
                                {pinnedQuestion && (
                                    <div data-testid="shramsathi-pinned-question" className="mb-3 rounded-xl border px-4 py-3 text-[16px] font-medium"
                                        style={{ fontFamily: SANS, backgroundColor: '#FEF8EF', borderColor: '#F6E3C4', color: '#B4650F' }}>
                                        {pinnedQuestion}
                                    </div>
                                )}
                                {renderRecorder(hooks)}
                            </div>
                        ),
                    }}
                />
            </div>
        </div>
    );
};

export default LogEntryFlow;
