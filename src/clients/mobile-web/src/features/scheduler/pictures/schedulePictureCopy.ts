/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - every word of the owner's "my photo" and "this schedule's
 * picture" action on the owner bar, in BOTH languages (Marathi mode shows Marathi only, English mode English only). Marathi first.
 *
 * Where each word comes from:
 *   - BRIEF - the lane brief, Marathi verbatim: "फोटो काढा" is REMOVE (the server's DELETE).
 *   - PROPOSED - written for this lane; each carries `// PROPOSED (Marathi)` / `// PROPOSED (English)`. The English twins are all PROPOSED.
 * No emoji. Nothing here says "AI". The sheet says plainly who will see the picture (it is the person's own data) and that it can be removed any time.
 */
import type { PictureFailure } from './schedulePictureApi';

export type PictureLanguage = 'mr' | 'en';

export interface PictureWords {
    /** The small button on the owner bar, with no picture of the owner's yet / with one. */
    open: string;
    openChange: string;
    close: string;
    sheetTitle: string;
    /** Who will see the picture, and that it can be removed (shown above the two choices). */
    notice: string;
    mine: string;
    mineHint: string;
    schedule: string;
    scheduleHint: string;
    choose: string;
    change: string;
    /** REMOVE (the server's DELETE). */
    remove: string;
    working: string;
    saved: string;
    removed: string;
    /** Marathi and English words for each way a try can fail. */
    problem: Readonly<Record<PictureFailure | 'unreadable' | 'too-big', string>>;
}

export const PICTURE_WORDS: Readonly<Record<PictureLanguage, PictureWords>> = {
    mr: {
        open: 'फोटो लावा', // PROPOSED (Marathi)
        openChange: 'फोटो बदला', // PROPOSED (Marathi)
        close: 'बंद करा', // PROPOSED (Marathi)
        sheetTitle: 'शेड्यूलचा फोटो', // PROPOSED (Marathi)
        notice: 'ज्यांना तुमचं शेड्यूल दिसतं, त्यांना हा फोटो दिसेल. तुम्ही तो कधीही काढू शकता.', // PROPOSED (Marathi)
        mine: 'माझा फोटो', // PROPOSED (Marathi)
        mineHint: 'तुमच्या सगळ्या शेड्यूलवर तुमचा फोटो दिसेल.', // PROPOSED (Marathi)
        schedule: 'या शेड्यूलचं चित्र', // PROPOSED (Marathi)
        scheduleHint: 'फक्त या शेड्यूलवर दिसेल, तुमच्या फोटोच्या जागी.', // PROPOSED (Marathi)
        choose: 'फोटो निवडा', // PROPOSED (Marathi)
        change: 'फोटो बदला', // PROPOSED (Marathi)
        remove: 'फोटो काढा', // BRIEF
        working: 'फोटो पाठवत आहे…', // PROPOSED (Marathi)
        saved: 'फोटो ठेवला. थोड्या वेळाने दिसेल.', // PROPOSED (Marathi)
        removed: 'फोटो काढला. थोड्या वेळाने बदल दिसेल.', // PROPOSED (Marathi)
        problem: {
            offline: 'इंटरनेट नाही. इंटरनेट चालू झाल्यावर पुन्हा प्रयत्न करा. काहीही नंतरसाठी ठेवलेलं नाही.', // PROPOSED (Marathi)
            unreadable: 'हा फोटो उघडता आला नाही. दुसरा फोटो निवडा.', // PROPOSED (Marathi)
            'too-big': 'हा फोटो लहान करता आला नाही. दुसरा फोटो निवडा.', // PROPOSED (Marathi)
            unsupported: 'फक्त JPEG, PNG किंवा WebP फोटो चालतो.', // PROPOSED (Marathi)
            empty: 'फोटो रिकामा आहे. दुसरा फोटो निवडा.', // PROPOSED (Marathi)
            'too-large': 'फोटो खूप मोठा आहे. दुसरा फोटो निवडा.', // PROPOSED (Marathi)
            'not-allowed': 'हा फोटो तुम्हाला बदलता येत नाही.', // PROPOSED (Marathi)
            'not-found': 'हे शेड्यूल सापडलं नाही. थोड्या वेळाने पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
            'signed-out': 'पुन्हा साइन इन करा आणि मग प्रयत्न करा.', // PROPOSED (Marathi)
            failed: 'फोटो ठेवता आला नाही. थोड्या वेळाने पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        },
    },
    en: {
        open: 'Add photo', // PROPOSED (English)
        openChange: 'Change photo', // PROPOSED (English)
        close: 'Close', // PROPOSED (English)
        sheetTitle: 'Schedule photo', // PROPOSED (English)
        notice: 'Anyone who can see your schedule will see this photo. You can remove it any time.', // PROPOSED (English)
        mine: 'My photo', // PROPOSED (English)
        mineHint: 'Your photo shows on all your schedules.', // PROPOSED (English)
        schedule: 'This schedule\'s picture', // PROPOSED (English)
        scheduleHint: 'Shows only on this schedule, in place of your photo.', // PROPOSED (English)
        choose: 'Choose photo', // PROPOSED (English)
        change: 'Change photo', // PROPOSED (English)
        remove: 'Remove photo', // PROPOSED (English)
        working: 'Sending the photo...', // PROPOSED (English)
        saved: 'Photo saved. It will show in a moment.', // PROPOSED (English)
        removed: 'Photo removed. The change will show in a moment.', // PROPOSED (English)
        problem: {
            offline: 'No internet. Try again when you are online. Nothing is kept for later.', // PROPOSED (English)
            unreadable: 'This photo could not be opened. Choose another photo.', // PROPOSED (English)
            'too-big': 'This photo could not be made small enough. Choose another photo.', // PROPOSED (English)
            unsupported: 'Only JPEG, PNG or WebP photos work.', // PROPOSED (English)
            empty: 'The photo is empty. Choose another photo.', // PROPOSED (English)
            'too-large': 'The photo is too large. Choose another photo.', // PROPOSED (English)
            'not-allowed': 'You cannot change this photo.', // PROPOSED (English)
            'not-found': 'This schedule was not found. Try again in a moment.', // PROPOSED (English)
            'signed-out': 'Sign in again, then try.', // PROPOSED (English)
            failed: 'The photo could not be saved. Try again in a moment.', // PROPOSED (English)
        },
    },
};

export const pictureWords = (language: PictureLanguage): PictureWords => PICTURE_WORDS[language];
