/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — the rules of ONE mic, pure, so each can be read and
 * tested alone. `SpeakHost` only carries them out.
 *
 *   - START: something already waiting on the log tab (a parsed draft to review, a recording in flight, a confirm
 *     screen) is never touched — the request hands him over to it instead (`openLogFlow`'s rule, P10).
 *   - THE PLACE: a known plot (or the whole farm) is set on the recorder, so it opens on the mic, no pickers.
 *   - THE END: his words were saved (`saved`), understood and kept unsaved for his decision (`parsed`, a correction),
 *     need the review on the log tab (`handedOver`: the auto-save declined them — never lost), or he went back
 *     (`cancelled`).
 *   - THE WAY BACK: he lands on the screen he started on. A screen other than the log tab leaves the log tab as it
 *     was (the recorder's own success screen is cleared, his plots there restored); the result screen he started on
 *     shows the new recording, which is "the same screen with what he said applied".
 */
import type { AgriLogResponse, AppStatus, LogScope } from '../../types';
import type { VoiceDraftSink } from '../../features/voice/useVoiceRecorder.types';
import { hasWaitingLogWork } from '../navigation/openLogFlow';
import { deliverSpoken, speakState, type SpeakLanding, type SpeakPlace, type SpeakRequest, type SpeakReturn } from './speakStore';

export const FARM_GLOBAL = 'FARM_GLOBAL';
const LOG_TAB: SpeakReturn = { route: 'main', mainView: 'log' };

/** Purposes whose words are understood but NOT saved by the recorder: the screen he started on decides. */
export const KEEPS_UNSAVED: ReadonlySet<SpeakRequest['purpose']> = new Set(['correctEntry']);

/** Can the mic open now, or does something already wait on the log tab? */
export const startDecision = (ctx: { status: AppStatus; draftLog: AgriLogResponse | null }): 'open' | 'waiting' =>
    (hasWaitingLogWork(ctx) ? 'waiting' : 'open');

/** The recorder's plots for a known place (one plot, a crop with none, or the whole farm). */
export function scopeForPlace(place: SpeakPlace): LogScope {
    if (place.cropId === FARM_GLOBAL) return { selectedCropIds: [FARM_GLOBAL], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
    return { selectedCropIds: [place.cropId], selectedPlotIds: place.plotId ? [place.plotId] : [], mode: 'single', applyPolicy: 'broadcast' };
}

export const EMPTY_SCOPE: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

/** The scope the recorder needs for this request; `null` = leave the log tab's own plots as they are. */
export function scopeForRequest(request: SpeakRequest): LogScope | null {
    const { place } = request.context;
    if (place === 'current') return null;
    return place ? scopeForPlace(place) : EMPTY_SCOPE;
}

export interface FlowSnapshot {
    status: AppStatus;
    draftLog: AgriLogResponse | null;
    lastSavedLogIds: readonly string[];
}

/**
 * Has the request ended, and how? Only after its words went to Sathi (`spokeNow`: the waiting screen showed for THIS
 * request) — so a result screen he started from, already at 'success', never reads as a new save.
 */
export function landingAfter(request: SpeakRequest, spokeNow: boolean, snap: FlowSnapshot): SpeakLanding | null {
    const { spoken } = speakState();
    if (spoken && spoken.requestId === request.id) return { kind: 'parsed', draft: spoken.draft, typed: spoken.typed };
    if (!spokeNow || snap.status === 'processing' || snap.status === 'recording') return null;
    if (snap.status === 'success') return { kind: 'saved', logIds: [...snap.lastSavedLogIds] };
    if (snap.status === 'idle' && snap.draftLog) return { kind: 'handedOver' };
    return null; // an error, or nothing understood yet: he stays on the mic, the recorder says what went wrong
}

/** What the host does once a request has ended. */
export interface AfterLanding {
    /** Clear the log tab's recorder flow (its success screen), so it is as it was. */
    resetLogFlow: boolean;
    /** Put back the plots the log tab held before the request. */
    restoreScope: boolean;
    /**
     * Nothing new was saved, but his words went through the voice flow (the waiting screen showed): the log tab must show
     * what it showed before — its result screen again (`'success'`), or the mic (`'voice'`), never the old hand-filled
     * form an idle flow in 'manual' mode would draw (lane E1).
     */
    restoreFlow: 'success' | 'voice' | null;
    /** Where he must be: the screen he started on, or the log tab when his words wait there. */
    goTo: SpeakReturn;
    /** Sathi's question was not answered by speaking after all: record the skip honestly (never an invented answer). */
    abandonQuestion: boolean;
}

/** What the request's run knew: did his words go to Sathi, and what was the log tab showing when it began. */
export interface RunFacts { spoke: boolean; statusAtStart: AppStatus }

const isLogTab = (r: SpeakReturn): boolean => r.route === 'main' && r.mainView === 'log';

export function afterLanding(request: SpeakRequest, landing: SpeakLanding, run: RunFacts): AfterLanding {
    const origin = request.returnTo;
    if (landing.kind === 'handedOver') return { resetLogFlow: false, restoreScope: false, restoreFlow: null, goTo: LOG_TAB, abandonQuestion: false };
    const unsaved = landing.kind === 'cancelled' || landing.kind === 'parsed';
    return {
        // A save started anywhere but the log tab: the log tab's success screen is cleared (it was applied where he is).
        resetLogFlow: landing.kind === 'saved' && !isLogTab(origin),
        restoreScope: request.context.place !== 'current',
        restoreFlow: unsaved && run.spoke ? (run.statusAtStart === 'success' ? 'success' : 'voice') : null,
        goTo: origin,
        abandonQuestion: landing.kind === 'cancelled' && request.purpose === 'answerQuestion',
    };
}

/**
 * Review B004 — may words spoken NOW be kept offline as a pending job? Not a correction's: kept that way they would come
 * back later as a NEW log. The parse then keeps nothing and says so (`offlineVoiceQueue`).
 */
export const mayKeepOffline = (): boolean => {
    const purpose = speakState().request?.purpose;
    return !purpose || !KEEPS_UNSAVED.has(purpose);
};

/**
 * The recorder's hand-off, purpose-aware: for a purpose that keeps his words unsaved (a correction) the parse is held
 * for the screen he started on and nothing is written; every other parse goes to the voice auto-save as always.
 */
export function withSpeakPurpose(sink: VoiceDraftSink, deps: { setStatus: (status: AppStatus) => void }): VoiceDraftSink {
    return async (draft, provenance, recording) => {
        const { request } = speakState();
        if (request && KEEPS_UNSAVED.has(request.purpose)) {
            deliverSpoken(draft, recording.typed === true);
            deps.setStatus('idle');
            return true;
        }
        return sink(draft, provenance, recording);
    };
}
