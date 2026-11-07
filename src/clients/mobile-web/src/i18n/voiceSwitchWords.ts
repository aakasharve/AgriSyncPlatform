// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 1: M2, M3) - founder D-50 choice 2, CTO call D-101.
//
// ONE place for the words about the voice-playback switch, so the privacy page, the voice diary and the notice cannot drift apart.
//
// The founder's own D-50 sentence (English): "ShramSafal keeps the original sound of every record as proof; this switch only decides
// whether it can be played." Everything below that is not the founder's verbatim description is PROPOSED (the founder confirms
// the words). The Marathi is a PROPOSED rendering of that sentence.

/** The founder's D-2 description of the switch, verbatim (first two sentences only; nothing is added inside it). */
export const D2_DESCRIPTION_MR =
    'श्रमसफलने तुमचे बोलणे समजून घेताना काही चूक केली किंवा माहिती सुटली, तर तुमचा मूळ आवाज पुन्हा ऐकून तुम्ही नेमके काय सांगितले होते ते तपासू शकता. तुमच्या कामाचा संदर्भ टिकून राहण्यासाठी हा आवाज नोंदीसोबत जतन केला जातो.';

/** PROPOSED (English rendering of the founder's D-2 description; the Marathi above is the founder's). */
export const D2_DESCRIPTION_EN =
    'If Shram Safal misunderstands what you said or misses something, you can listen to your original voice again and check exactly what you said. The voice is kept with the record so the context of your work is not lost.';

/**
 * PROPOSED (Marathi rendering of the founder's D-50 sentence): the original sound of every record is kept as proof; the switch only decides
 * playback. ONE rendering everywhere outside Sathi's own surface (the notice, the sheet, the privacy page, the consent form, the Marathi Privacy
 * Notice and Terms): it says "आवाज", never "रेकॉर्डिंग" (lane WORD-1, founder D-109: "don't use recording but understanding") and never the
 * "नोंद" rendering (decision 13's "नोंद scope = sathi-only"). A farmer never sees two renderings side by side.
 */
export const PROOF_KEPT_MR = 'श्रमसफल तुमचा प्रत्येक मूळ आवाज पुराव्यासाठी जतन करते; हे बटण फक्त तो ऐकता येईल की नाही हे ठरवते.';

/** The founder's D-50 sentence (English), as he wrote it. */
export const PROOF_KEPT_EN = 'ShramSafal keeps the original sound of every record as proof; this switch only decides whether it can be played.';

/**
 * The one true consequence of turning the switch off (CTO call D-101). Lane WORD-1 (founder D-109, 2026-11-08): the founder approved
 * this exact line - "don't use recording but understanding". The word "रेकॉर्डिंग" / "recording" is not used for the switch anywhere
 * outside the Sathi screen.
 */
export const OFF_CONSEQUENCE_MR = 'हा पर्याय बंद असताना श्रमसाथीने समजून घेतलेला आवाज नंतर ऐकता येणार नाही.';

/** The founder's approved English line (D-109). */
export const OFF_CONSEQUENCE_EN = 'A voice Shram Sathi understood while this is off cannot be played later.';

/** PROPOSED: the switch's names. Not the founder's: he asked for "who may listen". */
export const SWITCH_TITLE_MR = 'मूळ आवाज ऐकू देणे';
export const SWITCH_TITLE_EN = 'Allow playback of my original voice';

/** PROPOSED: what the switch grants (the same listeners the earlier words named: him and the people trusted to confirm). */
export const SWITCH_MEANING_MR = 'माझा मूळ आवाज मला आणि या शेतावरील अधिकृत तपासणाऱ्यांना ऐकू द्या.';
export const SWITCH_MEANING_EN = 'Allow me and authorized reviewers on this farm to play back my original voice.';
