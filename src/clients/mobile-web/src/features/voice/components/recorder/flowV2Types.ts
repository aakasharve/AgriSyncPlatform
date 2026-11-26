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
    /** The full-screen recording stage's place chip ("द्राक्ष · प्लॉट २"); absent = an empty chip. */
    placeLabel?: (language: string | undefined) => string;
    /** The plot on the stage's field card ("तुमचं शेत · प्लॉट २"); absent = "तुमचं शेत" alone. */
    plotLabel?: (language: string | undefined) => string;
    /** Days recorded this month (a count, never a streak) for "या महिन्यात N दिवस"; absent / 0 = not shown. */
    days?: number | null;
}
