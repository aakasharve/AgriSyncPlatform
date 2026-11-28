/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 2, amendments Verifier 1 / H1) — when to help him while the mic is open.
 *
 * The ONLY speech signal while recording is the open microphone's level (`useMicLevel`, 0..1 every ~90 ms, `undefined`
 * when the phone cannot measure it). There are no live transcript words during recording. So: no level, no hints
 * (P5 — a hint that says "I hear silence" when the phone cannot hear at all would be a fabricated reading).
 * Pure: no timers, no React; `RecorderFace` steps it.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A2; founder's final design 28 Nov) — the quiet stop: after he
 * has said at least QUIET_STOP_SPEECH_MS of real speech, QUIET_STOP_MS with no sound above the speech level ends the
 * recording by itself. Any sound above the speech level (even one too short to count as speech) starts the quiet again, so a
 * noisy room keeps listening rather than cutting him off; under the speech floor it never stops by itself (it keeps
 * listening, and the "finished?" ask still comes at QUIET_DONE_MS). No level, or a level stuck at 0: never.
 */

/** useMicLevel's GAIN 3.2 lifts normal speech well above this (tune at Gate 2). */
export const SPEECH_LEVEL = 0.12;
/** This long above SPEECH_LEVEL = he is speaking (a cough or a tap is shorter). */
export const SPEECH_MIN_MS = 300;
/** Before he speaks: one example at 4 s, three prompts at 9 s, the stop note at 16 s. */
export const COACH_MS = [4000, 9000, 16000] as const;
/** After speech, this much quiet asks "finished? press the red button". */
export const QUIET_DONE_MS = 5000;
/** A long talk is asked once at this point, even while he is talking. */
export const LONG_TALK_MS = 60000;
/** How long that one long-talk ask stays. */
export const LONG_TALK_SHOW_MS = 6000;
/** An AUTO-started recording with no speech by now is cancelled silently (amendment H1). */
export const AUTO_SILENT_CANCEL_MS = 20000;
/** A level stuck at exactly 0 this long from the start = the phone is not really measuring (amendment H1). */
export const ZERO_UNMEASURABLE_MS = 3000;
/** This much quiet after enough speech ends the recording by itself (A2: "about 3 seconds of quiet"). */
export const QUIET_STOP_MS = 3000;
/** Less real speech than this is never stopped by itself (A2: "never auto-stop a clip with less than about 1 second"). */
export const QUIET_STOP_SPEECH_MS = 1000;
/** The quiet ring and its words show only from this much quiet: the gaps between his words never flash it. */
export const QUIET_STOP_SHOW_MS = 600;

export type SilenceStage = 'none' | 'coachOne' | 'coachPrompts' | 'stopNote' | 'doneAsk';

export interface SilenceState {
    startedAt: number;
    /** A real level has been read at least once. */
    measured: boolean;
    /** A level above exactly 0 has been read (a level stuck at 0 is not a measurement). */
    heardSound: boolean;
    /** Since when the level has stayed above SPEECH_LEVEL; null when below. */
    aboveSince: number | null;
    spoke: boolean;
    lastSpeechAt: number | null;
    /** Real speech in the runs that have ended: each run above SPEECH_LEVEL that lasted at least SPEECH_MIN_MS. */
    speechMs: number;
    /** The latest reading above SPEECH_LEVEL in the current run; null when below. */
    lastAboveAt: number | null;
    /** When the level fell below SPEECH_LEVEL after a sound; null before any sound and while above. */
    quietSince: number | null;
}

export function silenceStart(now: number): SilenceState {
    return {
        startedAt: now, measured: false, heardSound: false, aboveSince: null, spoke: false, lastSpeechAt: null,
        speechMs: 0, lastAboveAt: null, quietSince: null,
    };
}

/** One meter reading. `undefined` changes nothing (the first ~90 ms are always undefined: never latch on them). */
export function silenceStep(s: SilenceState, level: number | undefined, now: number): SilenceState {
    if (level === undefined || Number.isNaN(level)) return s;
    const heardSound = s.heardSound || level > 0;
    if (level < SPEECH_LEVEL) {
        if (s.aboveSince === null) {
            if (s.measured && s.heardSound === heardSound) return s;
            return { ...s, measured: true, heardSound };
        }
        // A run above the speech level just ended: it counts as speech only if it lasted SPEECH_MIN_MS (a cough or a tap does not).
        const run = (s.lastAboveAt ?? s.aboveSince) - s.aboveSince;
        return {
            ...s, measured: true, heardSound, aboveSince: null, lastAboveAt: null,
            speechMs: s.speechMs + (run >= SPEECH_MIN_MS ? run : 0),
            quietSince: now,
        };
    }
    const aboveSince = s.aboveSince ?? now;
    const speaking = now - aboveSince >= SPEECH_MIN_MS;
    return {
        ...s, measured: true, heardSound, aboveSince, lastAboveAt: now, quietSince: null,
        spoke: s.spoke || speaking,
        lastSpeechAt: speaking ? now : s.lastSpeechAt,
    };
}

/** The real speech heard so far: the ended runs, and the current one once it is long enough to be speech. */
export function speechHeldMs(s: SilenceState): number {
    const run = s.aboveSince !== null && s.lastAboveAt !== null ? s.lastAboveAt - s.aboveSince : 0;
    return s.speechMs + (run >= SPEECH_MIN_MS ? run : 0);
}

/**
 * When the quiet that will end this recording began, or null when it will not: the level is below speech now, after at
 * least QUIET_STOP_SPEECH_MS of real speech. Never on an unmeasured level (P5).
 */
export function quietStopSince(s: SilenceState): number | null {
    if (!s.measured || s.aboveSince !== null || s.quietSince === null) return null;
    return speechHeldMs(s) >= QUIET_STOP_SPEECH_MS ? s.quietSince : null;
}

/** The quiet has lasted QUIET_STOP_MS: the recording ends by itself now. */
export function quietStopDue(s: SilenceState, now: number): boolean {
    const since = quietStopSince(s);
    return since !== null && now - since >= QUIET_STOP_MS;
}

/** The level cannot be trusted: never read, or stuck at exactly 0 for ZERO_UNMEASURABLE_MS. */
export function silenceUnmeasurable(s: SilenceState, now: number): boolean {
    if (!s.measured) return true;
    return !s.heardSound && now - s.startedAt >= ZERO_UNMEASURABLE_MS;
}

export function silenceStage(s: SilenceState, now: number): SilenceStage {
    if (!s.measured || (!s.heardSound && now - s.startedAt >= ZERO_UNMEASURABLE_MS)) return 'none';
    const elapsed = now - s.startedAt;
    if (!s.spoke) {
        if (elapsed >= COACH_MS[2]) return 'stopNote';
        if (elapsed >= COACH_MS[1]) return 'coachPrompts';
        if (elapsed >= COACH_MS[0]) return 'coachOne';
        return 'none';
    }
    if (elapsed >= LONG_TALK_MS && elapsed < LONG_TALK_MS + LONG_TALK_SHOW_MS) return 'doneAsk';
    const speakingNow = s.aboveSince !== null && now - s.aboveSince >= SPEECH_MIN_MS;
    if (!speakingNow && s.lastSpeechAt !== null && now - s.lastSpeechAt >= QUIET_DONE_MS) return 'doneAsk';
    return 'none';
}
