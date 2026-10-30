/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — ONE mic for the whole app.
 *
 * Founder 2026-10-30: "the mic should redirect to the legacy log mic window … without any delay or lag … and then
 * bring back the user where he initiated … make sure it happens everywhere". So every "बोलून सांगा", "दाबा आणि बोला",
 * "पुन्हा सांगा", "आणखी सांगा" and mic button that means "speak to the log" goes through ONE call:
 *
 *     requestSpeak({ purpose, context, returnTo, onLanded })
 *
 * and `SpeakHost` (mounted once by the router) opens the ONE standard log recorder over the screen he is on — the same
 * recorder the log tab uses, then the same founder-approved waiting screen — and brings him back to that very screen
 * (it was never left), where `onLanded` applies what he said.
 *
 * This module is the state only (pure, no React tree, no app context): the request being spoken, the words Sathi
 * understood for a request that must NOT be saved by itself (a correction), and the open "बदला" screen. Every reader
 * subscribes through `useSpeakState`.
 */
import { useSyncExternalStore } from 'react';
import type { AgriLogResponse, AppRoute, PageView } from '../../types';
import type { PartKey } from '../../features/logs/components/voiceResult/resultModel';

/** Why he is speaking: it decides the band above the mic and what happens to his words. */
export type SpeakPurpose =
    | 'addToDay'        // more work for a day (आढावा's plot day, the result screen's "आणखी सांगा")
    | 'fillPart'        // a part the result screen says was not told ("… सांगितलं नाही. दाबा आणि बोला")
    | 'answerQuestion'  // Sathi's question, answered by speaking
    | 'correctEntry'    // "बदला": the change to one saved entry — understood, shown before → after, saved only on "जतन करा"
    | 'addTodo'         // a reminder / to-do (आढावा's करायची कामे)
    | 'attention'       // a लक्ष द्या item ("काम नोंदवा")
    | 'scheduleDone';   // a schedule step done (no screen offers it today; the purpose is kept for it)

export const SPEAK_PURPOSES: readonly SpeakPurpose[] = ['addToDay', 'fillPart', 'answerQuestion', 'correctEntry', 'addTodo', 'attention', 'scheduleDone'];

/** Where his words belong. `cropId: 'FARM_GLOBAL'` with no plot is the whole farm. */
export interface SpeakPlace { cropId: string; plotId?: string }

export interface SpeakContext {
    /**
     * Known: the recorder skips the crop → plot pickers. `'current'`: the plots the log tab already holds (the result
     * screen's own recording). Absent: not known — he picks the crop and plot first, as on the log tab.
     */
    place?: SpeakPlace | 'current';
    /** `fillPart` — the part he was asked for. */
    part?: PartKey;
    /** `correctEntry` — the entry being changed. */
    logId?: string;
    /** `answerQuestion` — Sathi's question, kept in sight above the mic. */
    question?: string;
}

/** The screen he started on; he lands back on it. */
export interface SpeakReturn { route: AppRoute; mainView: PageView }

/** How a request ended — handed to the screen he started on. */
export type SpeakLanding =
    /** His words were saved (the logs they became). */
    | { kind: 'saved'; logIds: string[] }
    /** Understood but NOT saved (a correction): the screen shows before → after and saves only on his word. */
    | { kind: 'parsed'; draft: AgriLogResponse; typed: boolean }
    /** He went back before speaking. Nothing was saved. */
    | { kind: 'cancelled' }
    /** Something already waited on the log tab, or his words need the review there: he was taken to it (never lost). */
    | { kind: 'handedOver' };

export interface SpeakRequestInput {
    purpose: SpeakPurpose;
    context?: SpeakContext;
    returnTo: SpeakReturn;
    onLanded?: (landing: SpeakLanding) => void;
}

export interface SpeakRequest extends SpeakRequestInput {
    id: string;
    context: SpeakContext;
}

/** The "बदला" screen: the entry, and what he said for it (until he saves, says it again, or goes back). */
export interface CorrectionSession {
    logId: string;
    proposal: { draft: AgriLogResponse; typed: boolean } | null;
}

export interface SpeakState {
    request: SpeakRequest | null;
    /** Words understood for the active request that its purpose keeps unsaved (a correction). */
    spoken: { requestId: string; draft: AgriLogResponse; typed: boolean } | null;
    correction: CorrectionSession | null;
}

const EMPTY: SpeakState = { request: null, spoken: null, correction: null };
let state: SpeakState = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();

const set = (next: SpeakState): void => {
    state = next;
    listeners.forEach(l => l());
};

export const speakState = (): SpeakState => state;

export function subscribeSpeak(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** THE call every speak entry point makes. A new request replaces one not yet spoken. */
export function requestSpeak(input: SpeakRequestInput): SpeakRequest {
    seq += 1;
    const request: SpeakRequest = { ...input, context: input.context ?? {}, id: `speak-${seq}` };
    set({ ...state, request, spoken: null });
    return request;
}

/** Words Sathi understood for the active request, kept unsaved (its purpose decides; only a correction today). */
export function deliverSpoken(draft: AgriLogResponse, typed: boolean): boolean {
    const { request } = state;
    if (!request) return false;
    set({ ...state, spoken: { requestId: request.id, draft, typed } });
    return true;
}

/** Ends the active request and hands the landing to the screen he started on. Returns the request it ended. */
export function landSpeak(landing: SpeakLanding): SpeakRequest | null {
    const { request } = state;
    if (!request) return null;
    set({ ...state, request: null, spoken: null });
    request.onLanded?.(landing);
    return request;
}

/** Opens the "बदला" screen for one entry (over the screen he is on). */
export function openCorrection(logId: string): void {
    set({ ...state, correction: { logId, proposal: null } });
}

export function closeCorrection(): void {
    if (state.correction) set({ ...state, correction: null });
}

/** What he said for the entry on the "बदला" screen (`null`: "पुन्हा सांगा" — the screen forgets it, nothing saved). */
export function setCorrectionProposal(proposal: CorrectionSession['proposal']): void {
    if (state.correction) set({ ...state, correction: { ...state.correction, proposal } });
}

export function useSpeakState(): SpeakState {
    return useSyncExternalStore(subscribeSpeak, speakState, speakState);
}

/** Tests only: back to nothing open. */
export function resetSpeakStoreForTests(): void {
    seq = 0;
    set(EMPTY);
}
