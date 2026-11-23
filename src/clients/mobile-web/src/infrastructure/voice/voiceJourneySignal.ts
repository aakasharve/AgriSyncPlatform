/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — voiceJourneySignal: a tiny in-memory pub/sub that lets the v2 step list ("आवाज जतन
 * केला → … → जतन झालं") tick ONLY on real events of the existing save path (P4: never a timer pretending progress).
 * Pattern: `features/logs/services/dfesAnswerSignal.ts`. It lives in infrastructure so `BackendAiClient` may emit it.
 *
 * Display only: emitting never throws and never changes what is saved; a listener's error is caught and dropped.
 * Snapshots are replaced, never mutated, so `useSyncExternalStore` sees each change.
 */
import type { AgriLogResponse } from '../../domain/types/log.types';

export type VoicePlaceResult = 'same' | 'otherPlot' | 'unclear';

export type VoiceJourneyEvent =
    | { kind: 'kept'; input: 'audio' | 'text'; durationMs?: number }
    | { kind: 'understood'; draft: AgriLogResponse }
    | { kind: 'placeChecked'; result: VoicePlaceResult }
    | { kind: 'written'; logIds: string[] };

export interface VoiceJourneySnapshot {
    startedAt: number;
    input?: 'audio' | 'text';
    durationMs?: number;
    keptAt?: number;
    draft?: AgriLogResponse;
    understoodAt?: number;
    place?: VoicePlaceResult;
    placeAt?: number;
    writtenAt?: number;
    logIds?: string[];
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current: VoiceJourneySnapshot | null = null;

function next(snapshot: VoiceJourneySnapshot): void {
    current = snapshot;
    listeners.forEach(listener => {
        try {
            listener();
        } catch {
            // one broken subscriber must never stop the others, nor reach the save path
        }
    });
}

/** Records one real event. 'kept' starts a NEW journey; the others fill in the current one (ignored without one). */
export function noteVoiceJourney(event: VoiceJourneyEvent, now: number = Date.now()): void {
    try {
        if (event.kind === 'kept') {
            next({ startedAt: now, input: event.input, durationMs: event.durationMs, keptAt: now });
            return;
        }
        if (!current) return;
        if (event.kind === 'understood') next({ ...current, draft: event.draft, understoodAt: now });
        else if (event.kind === 'placeChecked') next({ ...current, place: event.result, placeAt: now });
        else next({ ...current, logIds: [...event.logIds], writtenAt: now });
    } catch {
        // display only
    }
}

export function readVoiceJourney(): VoiceJourneySnapshot | null {
    return current;
}

export function subscribeVoiceJourney(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function resetVoiceJourneyForTests(): void {
    current = null;
    listeners.clear();
}
