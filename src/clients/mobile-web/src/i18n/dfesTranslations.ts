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
 * SINCE THEN, FOUNDER REVISION (2026-08-13). 13 of the 38 `mr` strings are now
 * his rather than the pre-split bytes: `closeToday`, `todayClosed`,
 * `closeTodayQuestion`, `todaySummary`, `farmBookUpToDate`, `doesThisMatch`,
 * `updated`, `waitingForConfirmation`, `onboardingWelcome`,
 * `firstLogCelebration`, `reviewAndClose`, `entries`, `clickToClose`. The
 * other 25 are untouched.
 *
 * THE SINGLE AUTHORITY IS `G:\VALIDATION\shram-sathi-FINAL-strings.md`. Every
 * `mr` string in this file equals that document's main table byte for byte —
 * `✏️` changed, `🔒` locked and `🐛` bug-fix alike. Two earlier worksheets fed
 * revisions in before it existed and BOTH CARRIED ERRORS the founder has since
 * corrected, so that document supersedes them and anything derived from them.
 * Reconcile against it, not against a message or a memory of a ruling.
 *
 * ONE RULING IS SETTLED AND EASY TO UNDO BY ACCIDENT: `बंद` ("close the day")
 * is REMOVED EVERYWHERE. A day is finished by telling Sathi everything, not by
 * closing a book — which is why `closeTodayQuestion`, `reviewAndClose` and
 * `clickToClose` no longer say it. Putting it back undoes a founder decision.
 *
 * ONE RULING IS DELIBERATELY UNSETTLED, AND `closeToday` IS WHERE IT SHOWS.
 * `नोंद`/`नोंदी` is banned from Shram Sathi's own voice and stays legitimate in
 * UI chrome (`sathi-only`) — hence `weekSummary`, `daysLoggedThisWeek` and
 * `ownerHasQuestion` keep it. What has NOT been answered is which side of that
 * line six strings fall on, `closeToday` and `weeklyReviewPrompt` among them:
 * `closeToday` speaks in the first person (`माझ्यापर्यंत`) and still says
 * `नोंदी`. It is marked open in the authority document and it stays exactly as
 * that document's main table has it until the founder answers. Do not resolve
 * this by reasoning about it — it was closed that way once and reverted.
 *
 * ONE `en` STRING CHANGED, AND ONLY BECAUSE THE MARATHI FORCED IT.
 * `onboardingWelcome` promised "Just 30 seconds", and the founder's standing
 * rule is that no string quotes a time cost — so the English kept making a
 * promise the Marathi had stopped making. It now mirrors his sentence. Every
 * other `en` string is the pre-split byte; where an `mr` rewrite moved a
 * string's meaning, the English was left alone deliberately, because he ruled
 * on Marathi and English is a separate pass.
 *
 * The oracle test is updated in the same commit, which is the two-file edit it
 * exists to force.
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
        onboardingWelcome: 'Tell Shram Sathi about the work on your farm. He will come to understand your farm and how you work.',
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
        closeToday: 'आजच्या सर्व नोंदी माझ्यापर्यंत पोहोचल्या का याची खात्री करा',
        todayClosed: 'आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या',
        closeTodayQuestion: 'आजचं सगळं सांगून झालं का?',

        // Day summary
        todaySummary: 'आजची {activities} कामे, खर्च रु. {cost}',
        weekSummary: 'या आठवड्यात: {entries} नोंदी, Rs. {cost} खर्च.',
        farmBookUpToDate: 'शेतातील कामे आणि मी समजून घेतलेले कामे बरोबर आहेत',

        // Verification (anti-ego)
        doesThisMatch: 'हे बरोबर आहे ना?',
        allLooksCorrect: 'सगळं बरोबर दिसतंय',
        somethingNeedsFixing: 'काहीतरी सुधारायला हवं',
        ownerHasQuestion: '{owner} यांना या नोंदीबद्दल शंका आहे',
        updated: 'बदल: {field} — आधी {oldValue}, आता {newValue}',
        waitingForConfirmation: 'तपासणी बाकी आहे',
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
        onboardingWelcome: 'शेतातली कामं श्रम साथीला सांगा — तो तुमची शेती आणि तुमच्या कामाची पद्धत समजून घेईल.',
        letsStart: 'चला सुरू करूया',
        whichCropToday: 'आज कोणत्या पिकावर काम?',
        whatWorkToday: 'आज काय काम झालं?',
        firstLogCelebration: 'तुमचे पहिले काम मला समजले',
        comeBackTomorrow: 'उद्या संध्याकाळी या.',

        // Owner verification trigger
        weeklyReviewPrompt: 'तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.',
        reviewAndClose: 'तपासा आणि खात्री करा',
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
        clickToClose: 'दिवस पूर्ण करण्यासाठी क्लिक करा',
    },
};
