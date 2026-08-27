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
 * TWO OF THE SIX OPEN STRINGS ARE NOW RULED. FOUR REMAIN OPEN.
 *
 * Founder, 2026-08-27: `closeToday` and `weeklyReviewPrompt` take the कामे
 * (work) wording, and of the नोंदी (records) wording he said "remove that".
 * Both are applied and the rejected wordings are deleted, not parked.
 *
 * He ruled on TWO. The other four of the six named below are STILL OPEN and
 * must not be inferred from this ruling — a first-person Sathi line and a piece
 * of UI chrome can honestly fall on different sides, which is the whole reason
 * the set was split rather than answered at once.
 *
 * THE ORIGINAL NOTE, kept because the reasoning still governs the other four:
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

    // ---------------------------------------------------------------------
    // dfes-companion (spec: dfes-companion-2026-07-11) — keys this branch ADDS.
    //
    // Merged in from `translations.ts`, where they lived inline before
    // LABOUR_PHASE2 moved the DFES block into this file. Lifted VERBATIM: not
    // one string was rewritten, reordered or re-translated in the move. The 38
    // keys above keep the founder-revised values from the authority document.
    // ---------------------------------------------------------------------
    /** SHORT label for the control that opens the closeToday panel. */
    closeTodayAction: string;

    // wave-3.10, founder decision 8 — the optional reason chips offered when he
    // declares a no-work day. Skipping them saves the day anyway (doctrine P9).
    noWorkReasonPrompt: string;

    noWorkSkipReason: string;

    noWorkReason: {
        weather: string;
        electricity: string;
        water: string;
        machinery: string;
        labour: string;
        other: string;
    };

    // Day Understanding Score (dfes-companion Slice 3b) — Sathi's framing of
    // its OWN understanding of the farmer's day (X/10). NOT a grade of the farmer.
    dayUnderstandingIntro: string;

    dayUnderstandingPending: string;

    /**
     * wave-3.9, founder decision 10 (2026-08-16) — the HONEST provenance label for
     * Sathi's question copy. It is "reviewed by Shram Safal", never "approved by an
     * agronomist": no agronomist has seen any of the twelve reviewed bank entries.
     *
     * DISPLAY ONLY. The wire field `agronomistApproved` is deliberately NOT renamed —
     * RecordQuestionEventHandler.cs:28 hard-rejects any event whose
     * `agronomistApproved` is not true, so a rename would turn every question event
     * into a 400. See dfesQuestionBank.SHRAM_SAFAL_REVIEWED.
     *
     * NOT rendered anywhere yet: no farmer-facing surface makes an approval claim
     * today, so there was no dishonest label to correct. This exists so the FIRST
     * surface that needs one reaches for the truthful string instead of inventing
     * "Agronomist approved". Do NOT reuse it for LogVerificationStatus.APPROVED —
     * that is an OWNER approving a worker's log, an unrelated claim.
     */
    shramSafalReviewed: string;

    // Post-save surface redesign (founder, 2026-08-13). The character SPEAKS
    // instead of the system announcing "Saved to Ledger", and each zone of the
    // surface names itself so the screen reads as one clear reply.
    sathiSaidLine: string;

    sectionWork: string;

    sectionGrasp: string;

    sectionAsk: string;

    sectionStreak: string;

    dayUnderstandingMeaning: string;

    // Semi-literate redesign (founder, 2026-08-13). A bare "७ / १०" reads as a
    // SCHOOL MARK to a tier-3/4 farmer — "I lost 3 marks" — which is the exact
    // opposite of the intended meaning. The band word leads; the numeral is
    // demoted to a quiet secondary.
    graspBandLow: string;

    graspBandSome: string;

    graspBandGood: string;

    graspBandFull: string;

    streakDaysUnit: string;

    streakTomorrow: string;

    graspTarget: string;

    graspTargetHit: string;

    askRaisesScore: string;

    // A day the farmer HONESTLY declared as no-work (founder ruling 2,
    // 2026-08-14: "Reward honesty and mark its consistency — no score needed
    // for such days"). No number is shown at all — a 0 would punish the very
    // honesty the product is built to earn. consistencyKept carries a {days}
    // placeholder = his current streak, which the server already advances
    // across a declared no-work day (StreakRules.AdvanceOnDeclaredNoWork).
    // spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (Task 6).
    noWorkDayAcknowledged: string;

    consistencyKept: string;

    // Understanding-Meter arrival/transition line (dfes-companion Slice 5b) —
    // Sathi's progress toward "knowing" the farm (rich-days milestone).
    // Founder-confirmable copy on a flag-gated placeholder surface.
    // meterArrivalProgress carries {count}/{target} placeholders; the
    // arrived line is appended (leading " — ") only once the milestone lands.
    meterArrivalProgress: string;

    meterArrivalArrived: string;

    // Daily Clarity Loop v1 (dfes-companion-2026-07-11) — the morning
    // "trigger" hero at the top of home, answering "काय राहिलं" in one calm
    // line. Reuses todayDayState.pendingCount. Reward = clarity/control,
    // never points, never scolding. {count} = a plain task count.
    dailyLoopTasksLeft: string;      // N > 0: today's remaining work

    dailyLoopDayFree: string;        // N === 0 AND nothing recorded: invite to record

    // Wave 2.4: N === 0 but the day HAS been recorded/completed. Splitting
    // this out is the whole point — dailyLoopDayFree ("आज काहीच सांगितलं
    // नाही", you told me nothing today) used to render for BOTH states, so
    // a farmer who had recorded and confirmed their day was told they had
    // said nothing, next to a full ring. Nothing left ≠ nothing told.
    dailyLoopDaySettled: string;

    // Carried-over qualifier of the SAME N (its overdue subset, k ≤ N):
    dailyLoopCarriedOne: string;     // exactly 1 carried → names it ("काल पासून: {title}")

    dailyLoopCarriedMany: string;    // k > 1 carried → soft count ("(यातील {count} काल पासून)")

    // Daily Clarity Loop v1 REWARD line (dfes-companion-2026-07-11) — the
    // calm "you're in control" line on the "Saved to Ledger" success card,
    // sitting directly ABOVE Sathi's one gentle question. Plain fact
    // (done / left), never a grade, never points, never scolding.
    // {done} = todayDayState.completedCount, {left} = .pendingCount.
    dailyLoopClarity: string;

    // Task 7 (spec: dfes-companion-2026-07-11) — daily 7am native local
    // notification title ("see today's tasks"). Static text only, no
    // dynamic count (pendingCount isn't persisted; a stale number in a
    // scheduled notification would be worse than none). Flag-gated by
    // VITE_MORNING_NOTIFICATION, default OFF.
    morningNotificationTitle: string;

    // Task 8 (spec: dfes-companion-2026-07-11) — "Sathi talks back":
    // the one warm celebration line spoken (web speechSynthesis) once
    // ever per farm at the 25-rich-days unlock. Sathi's SPOKEN persona
    // is always Marathi regardless of the UI language, so the `mr`
    // value is what's actually read aloud — the `en` value here exists
    // only as a readable reference for non-Marathi-speaking reviewers.
    // CONTENT GATE: final line is founder+agronomist-approved; this is
    // a reasonable draft.
    unlockSpokenLine: string;
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

        // --- dfes-companion additions (see the interface) --------------------
        closeTodayAction: 'Check today',

        noWorkReasonPrompt: 'Why? (optional)',

        noWorkSkipReason: 'Save the day',

        noWorkReason: {
            weather: 'Rain / weather',
            electricity: 'No electricity',
            water: 'No water',
            machinery: 'Machine trouble',
            labour: 'No labour',
            other: 'Something else',
        },

        // Day Understanding Score (dfes-companion Slice 3b)
        dayUnderstandingIntro: 'I understood your day today',

        dayUnderstandingPending: 'Still understanding…',

        // wave-3.9, decision 10 — honest provenance, display only. See the
        // interface docstring for why the wire field keeps its old name.
        shramSafalReviewed: 'Shram Safal Reviewed',

        // Post-save surface redesign (2026-08-13)
        sathiSaidLine: 'Shram Safal is understanding the work you did today',

        sectionWork: 'WHAT YOU DID TODAY',

        sectionGrasp: 'HOW MUCH I UNDERSTOOD',

        sectionAsk: 'SATHI STILL NEEDS',

        sectionStreak: 'YOUR CONSISTENCY',

        dayUnderstandingMeaning: 'Tell me more and I understand more.',

        graspBandLow: 'I understood a little',

        graspBandSome: 'I understood a fair amount',

        graspBandGood: 'I understood a lot',

        graspBandFull: 'I understood everything',

        streakDaysUnit: 'days in a row',

        streakTomorrow: 'Come again tomorrow — keep it going',

        graspTarget: 'Aim for {target}',

        graspTargetHit: 'You reached the mark',

        askRaisesScore: 'Tell me this and the number goes up',

        // Declared no-work day (founder ruling 2, 2026-08-14). The Marathi is
        // the founder's own register and ships verbatim; these two English
        // lines are a working translation of it and are NOT founder-reviewed.
        noWorkDayAcknowledged: 'No work today — you said so, and I recorded it.',

        consistencyKept: 'You have told me without fail for {days} days running.',

        // Understanding-Meter arrival/transition line (dfes-companion Slice 5b)
        meterArrivalProgress: 'Understood days: {count}/{target}',

        meterArrivalArrived: ' — now I have come to know your farm',

        // Daily Clarity Loop v1 (dfes-companion-2026-07-11)
        dailyLoopTasksLeft: '{count} tasks left today',

        dailyLoopDayFree: 'Nothing told today yet — just speak to record',

        dailyLoopDaySettled: 'Today is told — nothing left',

        dailyLoopCarriedOne: 'From yesterday: {title}',

        dailyLoopCarriedMany: '({count} of these carried over)',

        // Daily Clarity Loop v1 REWARD line (dfes-companion-2026-07-11)
        dailyLoopClarity: '{done} done, {left} left',

        // Task 7 (spec: dfes-companion-2026-07-11) — morning notification title
        morningNotificationTitle: 'See today\'s tasks',

        // Task 8 (spec: dfes-companion-2026-07-11) — reference translation
        // only; the spoken utterance always uses the `mr` value below.
        // CONTENT GATE: founder+agronomist-approved final copy pending.
        unlockSpokenLine: 'Well done! Now I have truly come to know your farm.',
    },

    mr: {
        // Closure ritual
          // ✅ RULED BY THE FOUNDER, 2026-08-27. Settled, not open.
          //
          // Both branches rewrote this key from the same base. The founder chose the
          // कामे (work) wording and said of the नोंदी (records) wording:
          // "remove that". It is removed, not parked — keeping a rejected string in a
          // comment invites someone to "restore" it later.
          //
          // The नोंदी/कामे question this file's header called DELIBERATELY
          // UNSETTLED is now settled for these two keys. Do not reopen it by reasoning.
        closeToday: 'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा',
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
        //
        // ✅ RULED BY THE FOUNDER, 2026-08-27. Settled, not open.
        //
        // Both branches rewrote this key from the same base. The founder chose the
        // कामे (work) wording and said of the नोंदी (records) wording:
        // "remove that". It is removed, not parked — keeping a rejected string in a
        // comment invites someone to "restore" it later.
        //
        // The नोंदी/कामे question this file's header called DELIBERATELY
        // UNSETTLED is now settled for these two keys. Do not reopen it by reasoning.
        weeklyReviewPrompt: 'तुमच्या शेतीत नवीन कामे आहेत. तपासा.',
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

        // --- dfes-companion additions (see the interface) --------------------
        // AGENT-DRAFTED 2026-08-14 — needs founder approval. Lifted verbatim
        // from the closing verb phrase of the founder's own closeToday
        // sentence above, so the pill and the panel it opens speak the same
        // words. No new vocabulary was invented.
        closeTodayAction: 'खात्री करा',

        noWorkReasonPrompt: 'का? (ऐच्छिक)',

        noWorkSkipReason: 'दिवस नोंदवा',

        noWorkReason: {
            weather: 'पाऊस / हवामान',
            electricity: 'वीज नव्हती',
            water: 'पाणी नव्हतं',
            machinery: 'यंत्र बिघडलं',
            labour: 'माणसं नव्हती',
            other: 'दुसरं काही',
        },

        // Day Understanding Score (dfes-companion Slice 3b) — Sathi's own
        // understanding of the day, never a grade of the farmer.
        dayUnderstandingIntro: 'मी तुमचा आजचा दिवस समजून घेतला',

        dayUnderstandingPending: 'अजून समजतंय…',

        // AGENT-DRAFTED 2026-08-16 (wave-3.9, decision 10) — NEEDS FOUNDER APPROVAL
        // before it is rendered anywhere. Built only from words already shipping:
        // 'श्रम सफल' is the founder's own brand wording from sathiSaidLine below,
        // and 'तपासलेलं' is the plain Marathi for "checked/reviewed". No new brand
        // vocabulary was invented, and nothing renders this string yet.
        shramSafalReviewed: 'श्रम सफल ने तपासलेलं',

        // Post-save surface redesign (2026-08-13). sathiSaidLine is the
        // FOUNDER'S OWN wording, used verbatim — do not paraphrase it.
        sathiSaidLine: 'श्रम सफल मध्ये तुम्ही आज केलेले काम समजून घेत आहे',

        sectionWork: 'आज तुम्ही काय केलं',

        sectionGrasp: 'मला किती समजलं',

        sectionAsk: 'साथीला अजून हवं आहे',

        sectionStreak: 'तुमचं सातत्य',

        // Shortened for a semi-literate reader — one short clause, no fraction.
        dayUnderstandingMeaning: 'जेवढं सांगाल, तेवढं मला समजतं.',

        // The BAND is what the farmer reads; the numeral is secondary.
        graspBandLow: 'थोडं समजलं',

        graspBandSome: 'बऱ्यापैकी समजलं',

        graspBandGood: 'बरंच समजलं',

        graspBandFull: 'सगळं समजलं',

        streakDaysUnit: 'दिवस सलग',

        streakTomorrow: 'उद्या पण सांगा — दररोज बोलत रहा.',

        // The number is a TARGET to chase, never a mark. {target} is the notch
        // drawn on the bar, so the goal is visible as well as stated.
        graspTarget: '{target} पर्यंत पोहोचायचंय',

        graspTargetHit: 'तुम्ही खूण गाठली!',

        askRaisesScore: 'हे सांगितलं तर आकडा वाढेल',

        // A day he honestly said had no work. FOUNDER-SUPPLIED register, used
        // verbatim — do not paraphrase. No number appears beside these lines:
        // his honesty is acknowledged and his consistency named instead.
        noWorkDayAcknowledged: 'आज काम नाही — तुम्ही सांगितलं, मी नोंदवलं.',

        consistencyKept: 'सलग {days} दिवस तुम्ही न चुकता सांगताय.',

        // Understanding-Meter arrival/transition line (dfes-companion Slice 5b) —
        // founder-reviewed 2026-08-13, no longer a placeholder. Not a grade of
        // the farmer — Sathi's own growing familiarity. meterArrivalArrived is
        // CONCATENATED onto the progress line, so its leading space is load-
        // bearing (MeterDisplay.tsx) — do not trim it.
        meterArrivalProgress: '{count}/{target} दिवसांची कामे समजली',

        meterArrivalArrived: ' — आता मी तुमचं शेत ओळखू लागलो',

        // Daily Clarity Loop v1 (dfes-companion-2026-07-11) — FOUNDER-CONFIRM:
        // calm morning trigger. Dignity, no scolding, no points. The count
        // is a plain fact ("what's left"), not a grade of the farmer.
        dailyLoopTasksLeft: 'आज {count} कामं बाकी',

        dailyLoopDayFree: 'आज काहीच सांगितलं नाही. काम झालं नसेल तर कारण सांगा — किंवा "आज काम नाही" एवढं सांगा.',

        dailyLoopDaySettled: 'आज सगळं सांगून झालं — काही बाकी नाही.',

        dailyLoopCarriedOne: 'काल पासून: {title}',

        dailyLoopCarriedMany: '(यातील {count} काल पासून)',

        // Daily Clarity Loop v1 REWARD line (dfes-companion-2026-07-11) —
        // FOUNDER-CONFIRM: the "you're in control" reward on the saved card.
        // Plain fact ({done} done, {left} left), no adjectives, no score.
        dailyLoopClarity: '{done} पूर्ण, {left} बाकी',

        // Task 7 (spec: dfes-companion-2026-07-11) — morning notification title.
        // Static Marathi copy: "see today's tasks".
        morningNotificationTitle: 'आजची कामे पाहा',

        // Task 8 (spec: dfes-companion-2026-07-11) — the line Sathi
        // actually SPEAKS (web speechSynthesis, lang='mr-IN') once ever
        // per farm at the 25-rich-days unlock. Warm, celebratory,
        // dignity — never a grade of the farmer.
        // No longer a draft: this is the founder's own FINAL wording from
        // the 2026-08-13 reviewed string set (two review rounds closed).
        unlockSpokenLine: 'शाब्बास !!! आता मला तुमचं शेत आणि तुमची काम करण्याची पद्धत सविस्तर समजू लागली आहे',
    },
};
