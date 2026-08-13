/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guard for the `translations.ts` -> `dfesTranslations.ts` split.
 *
 * WHAT COULD GO WRONG, AND WHY A TEST IS WORTH IT
 * -----------------------------------------------
 * Moving ~120 copy lines between files is exactly the change where a dropped
 * key, a swapped `en`/`mr` block or a mangled Devanagari string goes unnoticed:
 * `tsc` proves the SHAPE survived (every key still exists, still a string) and
 * proves nothing at all about the CONTENT. A farmer would meet the damage as an
 * English word in a Marathi sentence, or as a raw key like `dfes.closeToday`
 * rendered on a button — and `t()` falls back to the key rather than throwing,
 * so a lost key is silent.
 *
 * THE ORACLE IS HAND-TRANSCRIBED, NOT IMPORTED. Asserting `dfesTranslations.mr`
 * against itself would pass no matter what moved. The expectations below were
 * transcribed from `git show 39f4613a:src/i18n/translations.ts` — the shipped
 * bytes BEFORE the split — so this test compares the new arrangement against
 * the old file, which is the only comparison that means anything here.
 *
 * THIRTEEN `mr` STRINGS AND ONE `en` STRING ARE NO LONGER THOSE BYTES, ON
 * PURPOSE. Across his 2026-08-13 review the founder rewrote `closeToday`,
 * `todayClosed`, `closeTodayQuestion`, `todaySummary`, `farmBookUpToDate`,
 * `doesThisMatch`, `updated`, `waitingForConfirmation`, `onboardingWelcome`,
 * `firstLogCelebration`, `reviewAndClose`, `entries` and `clickToClose`;
 * `onboardingWelcome` also changed in `en` because it quoted a time cost his
 * rule forbids. Each was re-transcribed here from his worksheet, character for
 * character, in the same commit that changed the module — the deliberate
 * two-file edit this file exists to force. Everything else below is still the
 * pre-split transcription, so the split guard still holds for the other 25
 * `mr` strings and 37 `en`.
 *
 * It also pins the two properties the split exists to create: `Language` is
 * still reachable from `translations.ts` (40-odd call sites import it there),
 * and `dfesTranslations.ts` does not import `translations.ts` back.
 */
import { describe, it, expect } from 'vitest';

import { translations, t } from '../translations';
import { dfesTranslations } from '../dfesTranslations';
import type { Language } from '../language';

/**
 * The approved DFES copy: the pre-split transcription, with the strings the
 * founder rewrote across his two 2026-08-13 rounds re-transcribed from his
 * worksheet. If a founder revises DFES copy this is where it gets revised —
 * deliberately, and in two places, which is the point.
 */
const DFES_APPROVED_COPY = {
    en: {
        closeToday: 'Close today',
        todayClosed: 'Today closed. Everything recorded.',
        closeTodayQuestion: 'Want to close today\'s farm?',
        todaySummary: 'Today: {activities} activities, Rs. {cost} cost.',
        weekSummary: 'This week: {entries} entries, Rs. {cost} cost.',
        farmBookUpToDate: 'Farm book is up to date.',
        doesThisMatch: 'Does this match?',
        allLooksCorrect: 'All looks correct',
        somethingNeedsFixing: 'Something needs fixing',
        ownerHasQuestion: '{owner} has a question about this entry',
        updated: 'Updated: {field} was {oldValue}, now {newValue}',
        waitingForConfirmation: 'Waiting for confirmation',
        confirmed: 'Confirmed',
        addYesterday: 'Add yesterday\'s work',
        addPreviousDays: 'Add previous days',
        welcomeBack: 'Welcome back! What\'s been happening?',
        daysLoggedThisWeek: 'You logged {logged} of {count} days this week',
        noWorkToday: 'No work today',
        shramSathi: 'Shram Sathi',
        onboardingWelcome: 'Tell Shram Sathi about the work on your farm. He will come to understand your farm and how you work.',
        letsStart: 'Let\'s start',
        whichCropToday: 'Which crop today?',
        whatWorkToday: 'What work happened today?',
        firstLogCelebration: 'Done! Your first farm record is saved.',
        comeBackTomorrow: 'Come back tomorrow evening.',
        weeklyReviewPrompt: 'Your farm book has new entries to review.',
        reviewAndClose: 'Review and close',
        farmBookOpen: 'This week\'s farm book is open.',
        trustedTotal: 'Trusted total',
        loggedTotal: 'Logged total',
        farmBookTrusted: 'Farm book {percent}% trusted',
        activitiesLogged: 'activities logged',
        needsReview: 'needs review',
        allVerified: 'All verified',
        entries: 'entries',
        unknown: 'Unknown',
        verify: 'Verify',
        clickToClose: 'Click to close the day',
    },
    mr: {
        closeToday: 'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा',
        todayClosed: 'आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या',
        closeTodayQuestion: 'आजचं सगळं सांगून झालं का?',
        todaySummary: 'आजची {activities} कामे, खर्च रु. {cost}',
        weekSummary: 'या आठवड्यात: {entries} नोंदी, Rs. {cost} खर्च.',
        farmBookUpToDate: 'शेतातील कामे आणि मी समजून घेतलेले कामे बरोबर आहेत',
        doesThisMatch: 'हे बरोबर आहे ना?',
        allLooksCorrect: 'सगळं बरोबर दिसतंय',
        somethingNeedsFixing: 'काहीतरी सुधारायला हवं',
        ownerHasQuestion: '{owner} यांना या नोंदीबद्दल शंका आहे',
        updated: 'बदल: {field} — आधी {oldValue}, आता {newValue}',
        waitingForConfirmation: 'तपासणी बाकी आहे',
        confirmed: 'खात्री झाली',
        addYesterday: 'कालचं काम नोंदवा',
        addPreviousDays: 'मागील दिवस नोंदवा',
        welcomeBack: 'पुन्हा स्वागत! शेतात काय चाललं?',
        daysLoggedThisWeek: 'या आठवड्यात {count} पैकी {logged} दिवस नोंद',
        noWorkToday: 'आज काम नाही',
        shramSathi: 'श्रम साथी',
        onboardingWelcome: 'शेतातली कामं श्रम साथीला सांगा — तो तुमची शेती आणि तुमच्या कामाची पद्धत समजून घेईल.',
        letsStart: 'चला सुरू करूया',
        whichCropToday: 'आज कोणत्या पिकावर काम?',
        whatWorkToday: 'आज काय काम झालं?',
        firstLogCelebration: 'तुमचे पहिले काम मला समजले',
        comeBackTomorrow: 'उद्या संध्याकाळी या.',
        weeklyReviewPrompt: 'तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.',
        reviewAndClose: 'तपासा आणि खात्री करा',
        farmBookOpen: 'या आठवड्याची शेतनोंद उघडी आहे.',
        trustedTotal: 'खात्रीशीर एकूण',
        loggedTotal: 'नोंदवलेला एकूण',
        farmBookTrusted: 'शेतनोंद {percent}% खात्रीशीर',
        activitiesLogged: 'कामे नोंदवली',
        needsReview: 'तपासायचे आहे',
        allVerified: 'सर्व खात्री झाली',
        entries: 'कामे',
        unknown: 'अज्ञात',
        verify: 'खात्री करा',
        clickToClose: 'दिवस पूर्ण करण्यासाठी क्लिक करा',
    },
} as const;

const LANGUAGES: Language[] = ['en', 'mr'];

describe('translations.ts split — the copy moved, and only the copy', () => {
    for (const language of LANGUAGES) {
        it(`${language}: every DFES string is byte-identical to the approved copy`, () => {
            expect(dfesTranslations[language]).toEqual(DFES_APPROVED_COPY[language]);
        });

        it(`${language}: nothing was lost or invented in the move`, () => {
            // `toEqual` above already implies this, but stated separately so a
            // key ADDED to both the oracle and the module (the easy way to make
            // a failing test pass) still has to be a deliberate two-file edit.
            expect(Object.keys(dfesTranslations[language]).sort())
                .toEqual(Object.keys(DFES_APPROVED_COPY[language]).sort());
        });
    }

    it('the composed `translations` object still carries DFES at the same path', () => {
        // The section is consumed as `t('dfes.<key>')` by 40-odd call sites.
        // Composition must be invisible to them.
        for (const language of LANGUAGES) {
            expect(translations[language].dfes).toBe(dfesTranslations[language]);
        }
    });

    it('`t()` still resolves a DFES key rather than echoing it back', () => {
        // `t()` returns the KEY when a lookup misses, so a broken composition
        // would render `dfes.closeToday` on a button instead of throwing.
        expect(t('dfes.closeToday', 'mr')).toBe('आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा');
        expect(t('dfes.closeToday', 'en')).toBe('Close today');
        expect(t('dfes.clickToClose', 'mr')).not.toBe('dfes.clickToClose');
    });

    it('the two languages did not get swapped in the move', () => {
        // The failure mode a shape check cannot see: both blocks present, both
        // complete, both in the wrong slot.
        expect(t('dfes.closeToday', 'mr')).not.toBe(t('dfes.closeToday', 'en'));
        expect(/[ऀ-ॿ]/.test(t('dfes.closeToday', 'mr'))).toBe(true);
        expect(/[ऀ-ॿ]/.test(t('dfes.closeToday', 'en'))).toBe(false);
    });

    it('every Marathi DFES string is still in Devanagari', () => {
        // One `mr` entry silently holding an English string is the quietest way
        // this split could have gone wrong. `shramSathi` is the name and is
        // legitimately transliterated, so it is checked by value above rather
        // than by script here.
        const latinOnly = Object.entries(dfesTranslations.mr)
            .filter(([, value]) => !/[ऀ-ॿ]/.test(value));

        expect(latinOnly).toEqual([]);
    });
});
