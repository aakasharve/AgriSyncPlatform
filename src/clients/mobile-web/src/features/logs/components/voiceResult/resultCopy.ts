/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — the words lane L6b adds to the ONE result screen:
 * the why-tiles, Sathi's question card, the product rows and the typed-entry marks. One language at a time:
 * Marathi mode shows only Marathi, English mode only English (founder 2026-10-26). Each line says where it comes from:
 *   - DESIGN: copied word-for-word from the founder's design preview (agrisync-plr-d1a postVoiceResult/*);
 *   - REUSED: an existing app string, read from where it lives (never re-typed);
 *   - PROPOSED (Marathi) / PROPOSED (English): new wording, waiting for his review.
 * The older strings of this screen stay in `resultStrings.ts` (Marathi in both languages — the known gap spec I18 owns).
 */
import { TYPED_WORDS } from '../../../voice/components/recorder/TypedEntry';
import { toMarathiNumber } from '../../services/disciplineRecognition';
import { RESULT_STR } from './resultStrings';

export interface ResultCopy {
    /** The why-tiles' heading. */
    whyHeading: string;
    whySub: string;
    /** The only "why" there is: which of his words led to the item (a fixed template, never an explanation). */
    whyReason: string;
    wrote: string;
    more: (n: number) => string;
    less: string;
    /** Sathi's question card. */
    askHeading: string;
    speakAnswer: string;
    later: string;
    /** No recording behind it. */
    typedTag: string;
    typedNote: string;
    /** The product rows. */
    products: string;
    spray: string;
    drip: string;
    water: string;
    litres: (n: string) => string;
    hours: (n: string) => string;
    /** Screen-reader words for a part the ring shows as not told (its orbs are drawn, not buttons). */
    notToldPart: (part: string) => string;
    /** The ring's arrow down to his words, for a typed entry (nothing to listen to). */
    readBelow: string;
}

const mr: ResultCopy = {
    // DESIGN — TranscriptLinks.tsx LINKS_STR.heading.
    whyHeading: 'श्रम साथीला हे का समजले?',
    // REUSED — the line already under these tiles (RESULT_STR.linksSub, the design's LINKS_STR.sub).
    whySub: RESULT_STR.linksSub,
    // PROPOSED (Marathi)
    whyReason: 'साथीला हे तुमच्या या शब्दांतून समजलं',
    // REUSED — RESULT_STR.wrote (the design's LINKS_STR.wrote).
    wrote: RESULT_STR.wrote,
    // DESIGN — LINKS_STR.more / LINKS_STR.less.
    more: (n: number) => `आणखी ${toMarathiNumber(n)} दाखवा`,
    less: 'कमी दाखवा',
    // DESIGN — model.ts STR.explainMore (founder 2026-10-24: he understands MORE, never "the number will rise").
    askHeading: 'तुम्ही अजून उलगडून सांगितलं तर साथी नीट समजून घेऊ शकेल',
    // DESIGN — model.ts STR.speakAnswer (its 🎤 is the mic icon on the button).
    speakAnswer: 'बोलून सांगा',
    // DESIGN — model.ts STR.later (the word MeterDisplay already uses).
    later: 'नंतर',
    // REUSED — the founder's tag word (RESULT_STR.typedTag) and the typed sheet's no-recording line (TYPED_WORDS.noAudio).
    typedTag: RESULT_STR.typedTag,
    typedNote: TYPED_WORDS.noAudio,
    // DESIGN — ProductCard.tsx PSTR.products / PSTR.op.spray / PSTR.op.fertigation / PSTR.water.
    products: 'औषध / खत',
    spray: 'फवारणी',
    drip: 'ठिबकातून सोडलं',
    water: 'पाणी',
    // REUSED — the unit words resultModel.ts already builds into values (PROPOSED there).
    litres: (n: string) => `${n} लिटर`,
    hours: (n: string) => `${n} तास`,
    // PROPOSED (Marathi) — built from RESULT_STR.noneYet + RESULT_STR.tellMore.
    notToldPart: (part: string) => `${part} — ${RESULT_STR.noneYet}. ${RESULT_STR.tellMore}`,
    // PROPOSED (Marathi) — the ring arrow's "खाली वाचा किंवा ऐका" without "ऐका": a typed entry has no recording.
    readBelow: 'खाली वाचा',
};

const en: ResultCopy = {
    whyHeading: 'Why did Shram Sathi understand this?', // PROPOSED (English)
    whySub: 'Tap a part to see which of your words told Sathi', // PROPOSED (English)
    whyReason: 'Sathi understood this from these words of yours', // PROPOSED (English)
    wrote: 'Shram Sathi wrote', // PROPOSED (English)
    more: (n: number) => `Show ${n} more`, // PROPOSED (English)
    less: 'Show less', // PROPOSED (English)
    askHeading: 'If you explain a little more, Sathi can understand it properly', // PROPOSED (English)
    speakAnswer: 'Answer by speaking', // PROPOSED (English)
    later: 'Later', // PROPOSED (English)
    typedTag: 'Typed', // PROPOSED (English)
    typedNote: 'No voice recording. This was told in writing.', // PROPOSED (English)
    products: 'Sprays / fertiliser', // PROPOSED (English)
    spray: 'Spray', // PROPOSED (English)
    drip: 'Given through drip', // PROPOSED (English)
    water: 'Water', // PROPOSED (English)
    litres: (n: string) => `${n} litres`, // PROPOSED (English)
    hours: (n: string) => `${n} hours`, // PROPOSED (English)
    notToldPart: (part: string) => `${part} — not told yet. Tap and tell Sathi.`, // PROPOSED (English)
    readBelow: 'Read below', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function resultCopy(language: string | null | undefined): ResultCopy {
    return language === 'en' ? en : mr;
}
