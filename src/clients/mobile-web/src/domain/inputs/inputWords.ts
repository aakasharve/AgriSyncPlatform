/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 4) — the fixed words for the
 * product-identity and mixing screens (no screen yet; lane IT4 places them).
 *
 * Language strict: Marathi mode shows Marathi only, English mode English only. No "AI" wording, no
 * emoji. Product facts are labelled "माहिती: श्रमसफल लायब्ररी" — the farmer never sees the word for the
 * dosage guide (founder 2026-11-06). No string says "तुम्ही": every "who said it" is a real name.
 * The photo state is "फोटो ठेवला" until a label reader ships (doctrine P5).
 */

export const INPUT_WORD_KEYS = [
    'whichProduct',
    'yes',
    'no',
    'photo',
    'photoKept',
    'notFound',
    'ambiguous',
    'whyTogether',
    'mixRed',
    'mixGreen',
    'mixGrey',
    'mixUnknownMember',
    'recordUnchanged',
    'fromWeb',
    'fromLibrary',
    'firstLook',
    'whatToDo',
    'seen',
    'ingredientNotInLibrary',
] as const;

export type InputWordKey = typeof INPUT_WORD_KEYS[number];
export type InputWords = Record<InputWordKey, string>;

const MR: InputWords = {
    whichProduct: 'हेच औषध का?',
    yes: 'हो',
    no: 'नाही',
    photo: 'फोटो',
    photoKept: 'फोटो ठेवला',
    notFound: 'हे औषध ओळखता आलं नाही',
    ambiguous: 'नक्की कुठलं ते सांगा',
    whyTogether: 'एकत्र का दिलं',
    mixRed: 'हे मिश्रण चुकीचं आहे',
    mixGreen: 'एकत्र चालतं',
    mixGrey: 'मिसळण्याची नोंद नाही',
    mixUnknownMember: 'ओळख नसल्याने तपासता आलं नाही',
    recordUnchanged: 'नोंद सांगितली तशीच राहील',
    fromWeb: 'इंटरनेटवरून',
    fromLibrary: 'माहिती: श्रमसफल लायब्ररी',
    firstLook: 'आधी हे पाहा',
    whatToDo: 'काय करायचं',
    seen: 'पाहिलं',
    ingredientNotInLibrary: 'घटक श्रमसफल लायब्ररीत नाही',
};

const EN: InputWords = {
    whichProduct: 'Is this the product?',
    yes: 'Yes',
    no: 'No',
    photo: 'Photo',
    photoKept: 'Photo saved',
    notFound: 'This product could not be identified',
    ambiguous: 'Say which one exactly',
    whyTogether: 'Why given together',
    mixRed: 'This mix is wrong',
    mixGreen: 'These go together',
    mixGrey: 'No record on mixing these',
    mixUnknownMember: 'Could not check: a product is not identified',
    recordUnchanged: 'The record stays exactly as it was said',
    fromWeb: 'From the internet',
    fromLibrary: 'Source: ShramSafal Library',
    firstLook: 'Look at this first',
    whatToDo: 'What to do',
    seen: 'Seen',
    ingredientNotInLibrary: 'Ingredient not in the ShramSafal Library',
};

/** The fixed words in one language. A fresh copy each call. */
export function inputWords(language: 'mr' | 'en'): InputWords {
    return { ...(language === 'en' ? EN : MR) };
}
