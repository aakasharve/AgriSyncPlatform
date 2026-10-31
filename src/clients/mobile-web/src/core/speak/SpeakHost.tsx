/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes MIC-1 + E1) — mounted ONCE by the router, over every screen:
 *
 *   - THE ONE MIC. A `requestSpeak(...)` from anywhere opens the standard log recorder at once (no route change, no chunk
 *     to load: the screen he is on stays where it is underneath), with one band saying why. A known place skips the
 *     crop → plot pickers; an unknown one shows the log tab's own crop → plot → mic flow. After he speaks: the
 *     founder-approved waiting screen, then back to the very screen he started on, his words applied there
 *     (`onLanded`). The rules are in `speakFlow.ts`; this only carries them out.
 *   - THE "बदला" SCREEN (`CorrectionHost`), opened by `openCorrection(logId)` from the result screen, आढावा and the saved
 *     card: speak the change, see before → after, save a new version.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppStatus, LogScope } from '../../types';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { LogEntryFlow } from '../../features/logs/components/entry/LogEntryFlow';
import { abandonPendingQuestionAnswer } from '../../features/logs/services/pendingQuestionAnswer';
import { readRefusedChange, type RefusedChange } from '../../features/logs/components/correction/refusedRevision';
import { readMoneyNotFollowed } from '../../features/finance/editMoney';
import { placeWords } from '../../shared/names/placeWords';
import { renderLogRecorder, renderProcessingScreen } from '../navigation/logRecorder';
import type { AppRouterContext } from '../navigation/routeContext';
import { useBackDismiss } from '../navigation/useBackDismiss';
import { FARM_GLOBAL, afterLanding, landingAfter, scopeForRequest, startDecision } from './speakFlow';
import { landSpeak, useSpeakState, type SpeakLanding, type SpeakRequest } from './speakStore';
import { SpeakBandView, SpeakScreen } from './SpeakScreen';
import { speakWords } from './speakWords';
import { dayShort } from '../../features/logs/components/dayPick/dayWords';
import { CorrectionHost, type CorrectionSaveDeps } from './CorrectionHost';

/** "No delay": what can be made ready ahead is asked for the first time the mic opens (the result screen's code). */
let warmed = false;
function warmRecorder(): void {
    if (warmed || import.meta.env.MODE === 'test') return;
    warmed = true;
    void import('../../features/logs/components/voiceResult/VoiceResultContainer').catch(() => undefined);
    try {
        void navigator.permissions?.query({ name: 'microphone' as PermissionName }).catch(() => undefined);
    } catch {
        // a browser without the permissions API: nothing to warm
    }
}

/** "द्राक्ष · G1" for the recorder's plots (crop names strictly in his language), the whole farm by its own name. */
export function placeLabelOf(scope: LogScope, crops: AppRouterContext['crops'], language: string | null | undefined, wholeFarm: string): string | undefined {
    if (scope.selectedCropIds.includes(FARM_GLOBAL)) return wholeFarm;
    const crop = crops.find(c => scope.selectedCropIds.includes(c.id));
    if (!crop) return undefined;
    const plots = (crop.plots ?? []).filter(p => scope.selectedPlotIds.includes(p.id)).map(p => p.name).filter(Boolean);
    return placeWords(crop.name, plots, language) || undefined; // lane OF fix 1 (10): never "द्राक्ष · द्राक्ष G1"
}

interface Session { id: string; prevScope: LogScope | null; spoke: boolean; savedAtStart: string | undefined; statusAtStart: AppStatus; typedSent?: boolean }

const sameScope = (a: LogScope, b: LogScope): boolean =>
    a.selectedCropIds.join('|') === b.selectedCropIds.join('|') && a.selectedPlotIds.join('|') === b.selectedPlotIds.join('|');


// The "बदला" screen moved to its own file (lane OF); these stay importable from here.
export { placeOfLog, type CorrectionSaveDeps } from './CorrectionHost';

export const SpeakHost: React.FC<{
    ctx: AppRouterContext;
    save?: CorrectionSaveDeps | null;
    /** Was a change he saved for an entry refused by the server? (injected for tests; the real one reads the sync queue) */
    readRefused?: (logId: string) => Promise<RefusedChange | null>;
    /** Lane OF-M — why the money of his last saved change did not follow (injected for tests; the real one reads the phone). */
    readMoneyNotFollowed?: (logId: string) => Promise<string[]>;
}> = ({ ctx, save = null, readRefused = readRefusedChange, readMoneyNotFollowed: readMoney = readMoneyNotFollowed }) => {
    const { request, correction } = useSpeakState();
    const language = useOptionalLanguage()?.language;
    const session = useRef<Session | null>(null);
    const [recording, setRecording] = useState(false);
    const latest = useRef(ctx);
    latest.current = ctx;

    const finish = (req: SpeakRequest, landing: SpeakLanding) => {
        const s = session.current;
        session.current = null;
        setRecording(false);
        const c = latest.current;
        landSpeak(landing);
        const after = afterLanding(req, landing, { spoke: !!s?.spoke, statusAtStart: s?.statusAtStart ?? 'idle' });
        if (after.resetLogFlow) { c.handleReset(); c.setMode('voice'); }
        if (after.restoreFlow === 'success') c.setStatus('success');
        if (after.restoreFlow === 'voice') c.setMode('voice');
        if (after.restoreScope && s?.prevScope) c.setLogScope(s.prevScope);
        if (after.abandonQuestion) void abandonPendingQuestionAnswer();
        if (c.currentRoute !== after.goTo.route) c.setCurrentRoute(after.goTo.route);
        if (after.goTo.route === 'main' && c.mainView !== after.goTo.mainView) c.setMainView(after.goTo.mainView);
    };

    // START — before paint, so the recorder never shows a plot it is not for.
    useLayoutEffect(() => {
        if (!request || session.current?.id === request.id) return;
        const c = latest.current;
        if (startDecision(c) === 'waiting') {
            // Something already waits on the log tab: he is taken to it, nothing of it is touched (P10).
            session.current = null;
            landSpeak({ kind: 'handedOver' });
            c.setCurrentRoute('main');
            c.setMainView('log');
            return;
        }
        const scope = scopeForRequest(request);
        // A request that replaced one not yet spoken keeps the plots the log tab held before the first.
        const prevScope = session.current ? session.current.prevScope : scope ? c.logScope : null;
        const statusAtStart = session.current ? session.current.statusAtStart : c.status;
        session.current = { id: request.id, prevScope, spoke: false, savedAtStart: c.lastSavedLogIds?.[0], statusAtStart };
        if (scope) c.setLogScope(scope);
        // A result (or saved) screen underneath stays as it is; if his words then fail, the flow underneath goes back to
        // the mic, never to the old form an idle 'manual' flow would draw (lane E1).
        if (c.status === 'success') c.setMode('voice');
        warmRecorder();
    }, [request]);

    // Lane OF (rule TAP-1) — what he TYPED ("बोलता येत नसेल तर इथे लिहा") goes to the same understanding as speech, once,
    // as soon as the mic's place is set (the recorder's own typing sheet sends it the same way).
    useEffect(() => {
        const s = session.current;
        const text = request?.context.typed;
        if (!request || !text || !s || s.id !== request.id || s.typedSent) return;
        const want = scopeForRequest(request);
        if (want && !sameScope(want, ctx.logScope)) return;
        s.typedSent = true;
        void ctx.handleTextReady(text);
    });

    // His words went to Sathi for THIS request (the waiting screen showed).
    useEffect(() => {
        if (request && session.current?.id === request.id && ctx.status === 'processing') session.current.spoke = true;
    }, [request, ctx.status]);

    // END — saved, understood (kept unsaved), or handed to the review; an error keeps him on the mic.
    useEffect(() => {
        const s = session.current;
        if (!request || s?.id !== request.id) return;
        const newSave = (ctx.lastSavedLogIds?.length ?? 0) > 0 && ctx.lastSavedLogIds[0] !== s.savedAtStart;
        const landing = landingAfter(request, s.spoke || newSave, { status: ctx.status, draftLog: ctx.draftLog, lastSavedLogIds: ctx.lastSavedLogIds ?? [] });
        if (landing) finish(request, landing);
    });

    // The mic is on screen whenever a request is (a request handed over at once is cleared before paint).
    const active = !!request;
    const known = request?.context.place !== undefined;
    const cancel = () => { if (request && session.current?.id === request.id) finish(request, { kind: 'cancelled' }); };
    const processing = ctx.status === 'processing';
    // The phone's back leaves the mic; while he picks a crop / plot, the picker's own back steps (plot → crop → out).
    useBackDismiss(active && known && !recording && !processing, cancel);

    const words = speakWords(language);
    // Lane OF (D-60) — a past day he chose is named on the band and in the crop → plot questions.
    const forDay = request?.context.date ? dayShort(request.context.date, language) : undefined;
    const band = request ? words.band(request.purpose, { part: request.context.part, question: request.context.question, day: forDay }) : { title: '' };
    const onRecordingChange = (r: boolean) => setRecording(r);
    // On the log tab the waiting screen is already drawn by the tab itself (`renderLogView`): one, not two — unless the
    // "बदला" screen sits over it, which the mic's own waiting screen must then cover.
    const tabDrawsWaiting = processing && ctx.currentRoute === 'main' && ctx.mainView === 'log' && !correction;
    return (
        <>
            {correction && <CorrectionHost ctx={ctx} correction={correction} speaking={!!request} save={save} readRefused={readRefused} readMoneyNotFollowed={readMoney} />}
            {request && !tabDrawsWaiting && (
                <SpeakScreen
                    purpose={request.purpose}
                    band={band}
                    backLabel={words.back}
                    placeLabel={known ? placeLabelOf(ctx.logScope, ctx.crops, language, words.wholeFarm) : undefined}
                    processing={processing}
                    processingNode={renderProcessingScreen(ctx)}
                    showBack={known && !recording}
                    onBack={cancel}
                    showBand={known}
                >
                    {known ? renderLogRecorder(ctx, { onRecordingChange }) : (
                        <LogEntryFlow
                            crops={ctx.crops}
                            logScope={ctx.logScope}
                            setLogScope={ctx.setLogScope}
                            onChooseVoice={() => undefined}
                            labourIntent={false}
                            onBackToLabour={() => undefined}
                            onClearLabourIntent={() => undefined}
                            recordingSegment={null}
                            onCancelSegment={() => undefined}
                            startAt="entry"
                            onExit={cancel}
                            forDay={forDay}
                            micLead={<SpeakBandView band={band} />}
                            renderRecorder={hooks => renderLogRecorder(ctx, { onRecordingChange: r => { onRecordingChange(r); hooks.onRecordingChange(r); } })}
                        />
                    )}
                </SpeakScreen>
            )}
        </>
    );
};

export default SpeakHost;
