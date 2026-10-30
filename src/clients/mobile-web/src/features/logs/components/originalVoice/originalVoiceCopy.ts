/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — the words of "मूळ आवाज ऐका" (founder D-31: "Add a Play
 * original voice button so the reviewer can understand the speaker's meaning"). One language at a time: Marathi mode
 * shows only Marathi, English mode only English (founder 2026-10-26). Each line says where it comes from.
 */
import { VOICE_DIARY_BUNDLES } from '../../../../i18n/voiceDiaryTranslations';

export interface OriginalVoiceCopy {
    play: string;
    stop: string;
    loading: string;
    /** No recording he may play: the words stay on screen. */
    unavailable: string;
    /** The recording is not on the server yet (the speaker's phone may still be sending it) — retry later. */
    pending: string;
    /** Could not reach or open it this time — never "there is no recording". */
    failed: string;
}

const mr: OriginalVoiceCopy = {
    // PROPOSED (Marathi) — the founder's D-31 "Play original voice", in the words the lane brief names the control.
    play: 'मूळ आवाज ऐका',
    // the result screen's existing word for stopping a clip (resultStrings RESULT_STR.stop)
    stop: 'थांबवा',
    // PROPOSED (Marathi)
    loading: 'आवाज आणत आहे…',
    // L5's PROPOSED (Marathi) rendering of the founder's D-31 "Original recording unavailable." (reused, never re-typed)
    unavailable: VOICE_DIARY_BUNDLES['mr-IN'].replay.originalUnavailable,
    // PROPOSED (Marathi)
    pending: 'मूळ आवाज अजून सर्व्हरवर आलेला नाही — थोड्या वेळाने पुन्हा दाबा',
    // PROPOSED (Marathi)
    failed: 'आत्ता ऐकता आलं नाही — पुन्हा दाबा',
};

const en: OriginalVoiceCopy = {
    // Founder D-31, verbatim ("Play original voice").
    play: 'Play original voice',
    // PROPOSED (English)
    stop: 'Stop',
    // PROPOSED (English)
    loading: 'Fetching the voice…',
    // Founder D-31, verbatim (the same string L5 holds in voiceDiaryTranslations).
    unavailable: VOICE_DIARY_BUNDLES['en-IN'].replay.originalUnavailable,
    // PROPOSED (English)
    pending: 'The original voice has not reached the server yet — tap again in a while',
    // PROPOSED (English)
    failed: 'Could not play it right now — tap again',
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function originalVoiceCopy(language: string | null | undefined): OriginalVoiceCopy {
    return language === 'en' ? en : mr;
}
