/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — what the voice flow v2 hands the recorder face. Absent = today's recorder, unchanged.
 */

/** The mic card shown after he taps a plot (the 7 s ring that starts listening by itself). */
export interface MicCardSpec {
    /** Bumps on every plot tap made on this screen; 0 = never armed (arriving with a plot already chosen never arms). */
    armSeq: number;
    /** "द्राक्ष · प्लॉट २", in the screen's language. */
    placeLabel: (language: string | undefined) => string;
}

export interface RecorderFlowV2 {
    /** Show the silence help and the "finished?" hint while recording. */
    silenceHelp: boolean;
    /** The mic card instead of the plain idle mic. */
    card?: MicCardSpec;
    /**
     * spec plr-d10 (part 03, A3) — the founder's final recording screen (`SathiListening`: the listening wave, the blackboard, the
     * centred stop, one buzz per finished sentence). Only the log tab's flow sets it; absent = today's v2 recording screen.
     */
    listening?: boolean;
}
