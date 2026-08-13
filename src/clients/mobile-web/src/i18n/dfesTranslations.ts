/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DFES Behavioral Layer (Anti-Ego & Habit Loop) copy, lifted out of
 * `translations.ts` VERBATIM.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `check:file-sizes` caps every mobile-web source file at 800 lines and
 * `translations.ts` had been failing it at 831 for some time. The Labour
 * Phase 2 voice work adds copy to that file, so the choice was to split it or
 * to suppress the check. Suppressing a size gate to add lines to the file that
 * broke it is how a 2600-line god-file happened the last time; this is the
 * split.
 *
 * DFES was chosen as the piece to move because it is the one section with a
 * self-contained subject (the closure ritual and its habit loop), the largest
 * single block, and NO overlap with the sync/labour copy this phase touches —
 * so the split cannot collide with the wording work landing beside it.
 *
 * THE SPLIT ITSELF CHANGED NOTHING. Every key and every string arrived here
 * byte-identical to what `translations.ts` shipped at `39f4613a`;
 * `__tests__/translationsSplit.test.ts` pins that against a hand-transcribed
 * oracle rather than against this file.
 *
 * SINCE THEN, ONE DELIBERATE REVISION. The founder ruled on this copy on
 * 2026-08-13 and rewrote 9 of the 38 `mr` strings (`closeToday`, `todayClosed`,
 * `todaySummary`, `farmBookUpToDate`, `doesThisMatch`, `waitingForConfirmation`,
 * `onboardingWelcome`, `firstLogCelebration`, `entries`). The other 29 `mr`
 * strings and all 38 `en` strings are still the pre-split bytes. He is the
 * Marathi authority: these strings are copied verbatim from his worksheet and
 * are not an agent's to spell-correct, reword or re-punctuate. The oracle test
 * was updated in the same commit, which is the two-file edit it exists to force.
 */
import type { Language } from './language';

export interface DfesTranslations {
    // Closure ritual
    closeToday: string;
    todayClosed: string;
    closeTodayQuestion: string;

    // Day summary
    todaySummary: string;
    weekSummary: string;
    farmBookUpToDate: string;

    // Verification (anti-ego)
    doesThisMatch: string;
    allLooksCorrect: string;
    somethingNeedsFixing: string;
    ownerHasQuestion: string;
    updated: string;
    waitingForConfirmation: string;
    confirmed: string;

    // Missed day
    addYesterday: string;
    addPreviousDays: string;
    welcomeBack: string;
    daysLoggedThisWeek: string;

    // No work
    noWorkToday: string;

    // Onboarding
    shramSathi: string;
    onboardingWelcome: string;
    letsStart: string;
    whichCropToday: string;
    whatWorkToday: string;
    firstLogCelebration: string;
    comeBackTomorrow: string;

    // Owner verification trigger
    weeklyReviewPrompt: string;
    reviewAndClose: string;
    farmBookOpen: string;

    // Trust
    trustedTotal: string;
    loggedTotal: string;
    farmBookTrusted: string;

    // New additions for Batch 4
    activitiesLogged: string;
    needsReview: string;
    allVerified: string;
    entries: string;
    unknown: string;
    verify: string;

    // Batch 5
    clickToClose: string;
}

export const dfesTranslations: Record<Language, DfesTranslations> = {
    en: {
        // Closure ritual
        closeToday: 'Close today',
        todayClosed: 'Today closed. Everything recorded.',
        closeTodayQuestion: 'Want to close today\'s farm?',

        // Day summary
        todaySummary: 'Today: {activities} activities, Rs. {cost} cost.',
        weekSummary: 'This week: {entries} entries, Rs. {cost} cost.',
        farmBookUpToDate: 'Farm book is up to date.',

        // Verification (anti-ego)
        doesThisMatch: 'Does this match?',
        allLooksCorrect: 'All looks correct',
        somethingNeedsFixing: 'Something needs fixing',
        ownerHasQuestion: '{owner} has a question about this entry',
        updated: 'Updated: {field} was {oldValue}, now {newValue}',
        waitingForConfirmation: 'Waiting for confirmation',
        confirmed: 'Confirmed',

        // Missed day
        addYesterday: 'Add yesterday\'s work',
        addPreviousDays: 'Add previous days',
        welcomeBack: 'Welcome back! What\'s been happening?',
        daysLoggedThisWeek: 'You logged {logged} of {count} days this week',

        // No work
        noWorkToday: 'No work today',

        // Onboarding
        shramSathi: 'Shram Sathi',
        onboardingWelcome: 'Keep a daily farm record. Just 30 seconds.',
        letsStart: 'Let\'s start',
        whichCropToday: 'Which crop today?',
        whatWorkToday: 'What work happened today?',
        firstLogCelebration: 'Done! Your first farm record is saved.',
        comeBackTomorrow: 'Come back tomorrow evening.',

        // Owner verification trigger
        weeklyReviewPrompt: 'Your farm book has new entries to review.',
        reviewAndClose: 'Review and close',
        farmBookOpen: 'This week\'s farm book is open.',

        // Trust
        trustedTotal: 'Trusted total',
        loggedTotal: 'Logged total',
        farmBookTrusted: 'Farm book {percent}% trusted',

        // New additions for Batch 4
        activitiesLogged: 'activities logged',
        needsReview: 'needs review',
        allVerified: 'All verified',
        entries: 'entries',
        unknown: 'Unknown',
        verify: 'Verify',

        // Batch 5
        clickToClose: 'Click to close the day',
    },

    mr: {
        // Closure ritual
        closeToday: 'आजच्या सर्व नोंदी माझ्या पर्यन्त पोहोचल्या का याची खात्री करा',
        todayClosed: 'आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या',
        closeTodayQuestion: 'आजचं शेत बंद करायचं?',

        // Day summary
        todaySummary: 'आजची कामे आणि त्याचा खर्च',
        weekSummary: 'या आठवड्यात: {entries} नोंदी, Rs. {cost} खर्च.',
        farmBookUpToDate: 'शेतातील कामे आणि मी समजून घेतलेले कामे बरोबर आहेत',

        // Verification (anti-ego)
        doesThisMatch: 'हे बरोबर आहे ना?',
        allLooksCorrect: 'सगळं बरोबर दिसतंय',
        somethingNeedsFixing: 'काहीतरी सुधारायला हवं',
        ownerHasQuestion: '{owner} यांना या नोंदीबद्दल शंका आहे',
        updated: 'सुधारणा: {field} {oldValue} होतं, {newValue} आहे',
        waitingForConfirmation: 'तपसणी बाकी आहे',
        confirmed: 'खात्री झाली',

        // Missed day
        addYesterday: 'कालचं काम नोंदवा',
        addPreviousDays: 'मागील दिवस नोंदवा',
        welcomeBack: 'पुन्हा स्वागत! शेतात काय चाललं?',
        daysLoggedThisWeek: 'या आठवड्यात {count} पैकी {logged} दिवस नोंद',

        // No work
        noWorkToday: 'आज काम नाही',

        // Onboarding
        shramSathi: 'श्रम साथी',
        onboardingWelcome: 'शेतातली कामे श्रम साथी ला सांगा तो तुमची शेती ओ तुमची कामाची पद्धत समजून घेत आहे',
        letsStart: 'चला सुरू करूया',
        whichCropToday: 'आज कोणत्या पिकावर काम?',
        whatWorkToday: 'आज काय काम झालं?',
        firstLogCelebration: 'तुमचे पहिले काम मला समजले',
        comeBackTomorrow: 'उद्या संध्याकाळी या.',

        // Owner verification trigger
        weeklyReviewPrompt: 'तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.',
        reviewAndClose: 'तपासा आणि बंद करा',
        farmBookOpen: 'या आठवड्याची शेतनोंद उघडी आहे.',

        // Trust
        trustedTotal: 'खात्रीशीर एकूण',
        loggedTotal: 'नोंदवलेला एकूण',
        farmBookTrusted: 'शेतनोंद {percent}% खात्रीशीर',

        // New additions for Batch 4
        activitiesLogged: 'कामे नोंदवली',
        needsReview: 'तपासायचे आहे',
        allVerified: 'सर्व खात्री झाली',
        entries: 'कामे',
        unknown: 'अज्ञात',
        verify: 'खात्री करा',

        // Batch 5
        clickToClose: 'दिवस बंद करण्यासाठी क्लिक करा',
    },
};
