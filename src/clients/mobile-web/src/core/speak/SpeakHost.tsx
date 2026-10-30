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
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppStatus, DailyLog, LogScope } from '../../types';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';
import { mayShowFarmMoney } from '../../features/labour/homeAttendanceDoor';
import { LogEntryFlow } from '../../features/logs/components/entry/LogEntryFlow';
import { abandonPendingQuestionAnswer } from '../../features/logs/services/pendingQuestionAnswer';
import CorrectionScreen from '../../features/logs/components/correction/CorrectionScreen';
import { correctionWords } from '../../features/logs/components/correction/correctionWords';
import {
    blockerChange, correctionRows, isLabourDoorLog, mergeCorrection, revisionUpdates, saysAnything, spokenAsLog, HIDDEN_MONEY,
} from '../../features/logs/components/correction/correctionModel';
import { saveSpokenCorrection, type SaveCorrectionDeps } from '../../features/logs/components/correction/saveCorrection';
import { cropNameIn } from '../../features/logs/components/voiceResult/partNames';
import { isConfirmed, recordingOf, withoutInventedStoppage, type PartEntry } from '../../features/logs/components/voiceResult/resultModel';
import { formatFarmerLogTime } from '../navigation/helpers';
import { renderLogRecorder, renderProcessingScreen } from '../navigation/logRecorder';
import type { AppRouterContext } from '../navigation/routeContext';
import { useBackDismiss } from '../navigation/useBackDismiss';
import { FARM_GLOBAL, afterLanding, landingAfter, scopeForPlace, scopeForRequest, startDecision } from './speakFlow';
import {
    closeCorrection, landSpeak, requestSpeak, setCorrectionProposal, useSpeakState,
    type CorrectionSession, type SpeakLanding, type SpeakPlace, type SpeakRequest,
} from './speakStore';
import { SpeakBandView, SpeakScreen } from './SpeakScreen';
import { speakWords } from './speakWords';

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
    return [cropNameIn(crop.name, language), plots.join(', ')].filter(Boolean).join(' · ') || undefined;
}

/** The entry's own place, for the mic that speaks its change. */
export function placeOfLog(log: DailyLog): SpeakPlace {
    const sel = log.context?.selection?.[0];
    if (!sel || sel.cropId === FARM_GLOBAL) return { cropId: FARM_GLOBAL };
    return { cropId: sel.cropId, plotId: sel.selectedPlotIds?.[0] };
}

interface Session { id: string; prevScope: LogScope | null; spoke: boolean; savedAtStart: string | undefined; statusAtStart: AppStatus }

const NO_WHO = { youIds: new Set<string>(), nameOf: () => undefined, youLabel: '', unknownLabel: '' };

/** What the router gives the "बदला" screen to save with (the language is the screen's own). */
export type CorrectionSaveDeps = Omit<SaveCorrectionDeps, 'language'>;

const CorrectionHost: React.FC<{ ctx: AppRouterContext; correction: CorrectionSession; speaking: boolean; save: CorrectionSaveDeps | null }> = ({ ctx, correction, speaking, save }) => {
    const language = useOptionalLanguage()?.language;
    const log = ctx.history.find(l => l.id === correction.logId);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    // A record that is no longer here (deleted meanwhile) has nothing to change: the screen closes.
    useEffect(() => { if (!log) closeCorrection(); }, [log]);
    useBackDismiss(!!log && !speaking && !saving, closeCorrection);

    const sessionUserId = getSessionUserId();
    const hideMoney = !mayShowFarmMoney(ctx.farmRole) && !(log?.meta?.createdByOperatorId && log.meta.createdByOperatorId === sessionUserId);
    const current = useMemo(() => {
        if (!log) return { entries: [] as PartEntry[], blockers: [] };
        const view = withoutInventedStoppage(recordingOf([log], NO_WHO), [log]);
        const entries = hideMoney ? view.entries.map(e => (e.part === 'expense' ? { ...e, value: HIDDEN_MONEY, quote: undefined } : e)) : view.entries;
        return { entries, blockers: view.blockers };
    }, [log, hideMoney]);
    const proposal = correction.proposal;
    const merged = useMemo(() => {
        if (!log || !proposal) return null;
        const fresh = spokenAsLog(proposal.draft, log, { crops: ctx.crops, profile: ctx.farmerProfile });
        return fresh ? mergeCorrection(log, proposal.draft, fresh) : null;
    }, [log, proposal, ctx.crops, ctx.farmerProfile]);
    if (!log) return null;

    const rows = merged ? correctionRows(log, merged.after, { hideMoney, language }) : [];
    const blockers = merged ? blockerChange(log, merged.after) : { before: [], after: [], changed: false };
    const nothing = !proposal || !merged || !saysAnything(proposal.draft) || (!rows.some(r => r.changed) && !blockers.changed);
    const speak = () => {
        setFailed(false);
        requestSpeak({
            purpose: 'correctEntry',
            context: { place: placeOfLog(log), logId: log.id },
            returnTo: { route: ctx.currentRoute, mainView: ctx.mainView },
            onLanded: (landing: SpeakLanding) => {
                if (landing.kind === 'parsed') setCorrectionProposal({ draft: landing.draft, typed: landing.typed });
                // Something already waited on the log tab and he was taken to it: this screen steps aside (nothing saved).
                if (landing.kind === 'handedOver') closeCorrection();
            },
        });
    };
    const words = correctionWords(language);
    return (
        <CorrectionScreen
            timeLabel={formatFarmerLogTime(log.meta?.createdAtISO)}
            placeLabel={placeLabelOf(scopeForPlace(placeOfLog(log)), ctx.crops, language, words.wholeFarm) ?? ''}
            confirmed={isConfirmed(log)}
            current={current}
            proposal={proposal ? { transcript: (proposal.draft.fullTranscript ?? '').trim(), typed: proposal.typed, rows, blockers, nothing } : undefined}
            refused={isLabourDoorLog(log)}
            saving={saving}
            saveFailed={failed}
            onSpeak={speak}
            // "पुन्हा सांगा": what he said is forgotten (nothing saved) and the mic opens again.
            onAgain={() => { setCorrectionProposal(null); speak(); }}
            onSave={() => {
                if (!merged || nothing || saving) return;
                if (!save) { setFailed(true); return; } // a preview: nothing can be saved, and it says so
                setSaving(true);
                setFailed(false);
                void saveSpokenCorrection({ ...save, language: language === 'en' ? 'en' : 'mr' }, log, revisionUpdates(log, merged))
                    .catch(() => false)
                    .then(ok => { setSaving(false); if (ok) closeCorrection(); else setFailed(true); });
            }}
            // Back: nothing is saved.
            onBack={() => { if (!saving) closeCorrection(); }}
            onOpenAttendance={ctx.canOpenAttendanceFromHome
                ? () => { closeCorrection(); if (ctx.openPlace) ctx.openPlace('labour'); else ctx.setCurrentRoute('labour'); }
                : undefined}
        />
    );
};

export const SpeakHost: React.FC<{ ctx: AppRouterContext; save?: CorrectionSaveDeps | null }> = ({ ctx, save = null }) => {
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
    const band = request ? words.band(request.purpose, { part: request.context.part, question: request.context.question }) : { title: '' };
    const onRecordingChange = (r: boolean) => setRecording(r);
    // On the log tab the waiting screen is already drawn by the tab itself (`renderLogView`): one, not two — unless the
    // "बदला" screen sits over it, which the mic's own waiting screen must then cover.
    const tabDrawsWaiting = processing && ctx.currentRoute === 'main' && ctx.mainView === 'log' && !correction;
    return (
        <>
            {correction && <CorrectionHost ctx={ctx} correction={correction} speaking={!!request} save={save} />}
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
