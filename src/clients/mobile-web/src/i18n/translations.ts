/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Language Translations
 * Marathi (mr) and English (en) translations for entire app
 */

export type Language = 'en' | 'mr';

export interface Translations {
    // Header
    header: {
        profile: string;
        settings: string;
        log: string;
        reflect: string;
        compare: string;
    };

    // Navigation
    nav: {
        procure: string;
        schedule: string;
        income: string;
        tests: string;
    };

    // Log Page
    logPage: {
        selectCrop: string;
        voiceMode: string;
        manualMode: string;
        startRecording: string;
        stopRecording: string;
        listening: string;
        processing: string;
        today: string;
        yesterday: string;
        thisWeek: string;
        noLogs: string;
        noLogsMessage: string;
    };

    // Voice / Audio Recorder
    voice: {
        tapToSpeak: string;
        orTypeHere: string;
        checkInput: string;
        micError: string;
        /**
         * spec: dfes-companion-2026-07-11 (wave-4.3) — shown when the OS DENIES the
         * microphone, in place of the generic error. Refusing a device permission is not
         * a withdrawal of consent and must never read as the end of the road: the typing
         * route is right below and stays enabled, so the message points at it.
         */
        micDeniedTypeInstead: string;
        selectCropFirst: string;
        tapToSelect: string;
        autoStopping: string;
        discardRecording: string;
        tapToStop: string;
        selectPlotAbove: string;
        startLogging: string;
        savedTitle: string;
        savedTranscriptBody: string;
        savedAudioBody: string;
        savedReassure: string;
        /** Label above the editable "what you said" card on the post-voice
         * review screen (spec: dfes-companion-2026-07-11). Always read via
         * forced 'mr' — Sathi's transcript of the farmer's own words is
         * always shown in Marathi regardless of UI language. */
        transcriptHeardLabel: string;
        /** Gentle "please check this" flag next to an AI-extracted item whose
         * sourceText the backend could NOT verify against the voice
         * transcript (spec: dfes-companion-2026-07-11 anti-fabrication
         * guardrail — see AiResponseNormalizer.cs provenanceVerified). This
         * is NOT an error/accusation — the farmer keeps or removes the item
         * via the existing edit/delete controls. Always read via forced
         * 'mr', same as transcriptHeardLabel. */
        unverifiedSourceLabel: string;
    };

    // Reflect Page
    reflectPage: {
        timeline: string;
        selectDate: string;
        totalCost: string;
        noCropSelected: string;
        selectCropMessage: string;
    };

    // Work Summary
    workSummary: {
        totalDailyCost: string;
        workBreakdown: string;
        labour: string;
        irrigation: string;
        machinery: string;
        inputs: string;
        notes: string;
        weather: string;
        maleWorkers: string;
        femaleWorkers: string;
        hoursWorked: string;
        method: string;
        duration: string;
        type: string;
        purpose: string;
        fuelCost: string;
        rentalCost: string;
        itemsUsed: string;
        noLabour: string;
        noIrrigation: string;
        noMachinery: string;
        noInputs: string;
    };

    // Settings
    settings: {
        language: string;
        selectLanguage: string;
        english: string;
        marathi: string;
        labourRates: string;
        maleRate: string;
        femaleRate: string;
        irrigationDefaults: string;
        save: string;
        saved: string;
        general: string;
        demoMode: string;
        demoDescription: string;
        ledgerConfig: string;
        fixedCosts: string;
        dailyWage: string;
        tractorRate: string;
        fuelCostLabel: string;
        labourShifts: string;
        rateMale: string;
        rateFemale: string;
        harvestConfig: string;
        harvestDescription: string;
        noCrops: string;
        notConfigured: string;
        setup: string;
    };

    // Profile
    profile: {
        setupHub: string;
        farmerIdentity: string;
        cropsAndPlots: string;
        waterAndPower: string;
        machinery: string;
        intelligence: string;
        primaryOwner: string;
        verified: string;
        pendingIntegration: string;
        linkNow: string;
        myFarmTeam: string;
        manageAccess: string;
        addMember: string;
        partner: string;
        worker: string;
        allowLog: string;
        noTeamMembers: string;
        addFamilyOrWorkers: string;
        addNewCrop: string;
        saveCrop: string;
        plots: string;
        addPlot: string;
        mapped: string;
        addPlotTo: string;
        step: string;
        plotName: string;
        area: string;
        unit: string;
        acre: string;
        guntha: string;
        variety: string;
        whatDidYouPlant: string;
        seeds: string;
        saplings: string;
        companyName: string;
        quantityPerAcre: string;
        nurseryName: string;
        plantAgeDays: string;
        irrigationMethod: string;
        drip: string;
        flood: string;
        sprinkler: string;
        none: string;
        linkedMotor: string;
        selectMotor: string;
        dripDetails: string;
        pipeSize: string;
        filter: string;
        flowRate: string;
        selectTools: string;
        back: string;
        nextStep: string;
        finishSetup: string;
        waterSources: string;
        pumpsAndPower: string;
        sourceName: string;
        noWaterSources: string;
        newMachine: string;
        saveMachine: string;
        addMachine: string;
        owned: string;
        rented: string;
        tankCapacity: string;
        noMachinery: string;
        saveSource: string;
        saveMotor: string;
        noPlots: string;
        saveSetup: string;
        saveAndFinish: string;
    };

    // Confirmation
    confirmation: {
        confirm: string;
        edit: string;
        cancel: string;
        save: string;
        looksGood: string;
    };

    // Common
    common: {
        yes: string;
        no: string;
        ok: string;
        cancel: string;
        close: string;
        loading: string;
        error: string;
        add: string;
        /** "Today". DailySummaryCard already referenced `common.today`; the key
         *  never existed, so the card rendered the literal string
         *  "COMMON.TODAY" (uppercased) at the head of the farmer's day. */
        today: string;
        /** Universal "go back" affordance label. `profile.back` already carried
         *  the same word for the setup wizard; this is its home for surfaces
         *  outside Profile (e.g. the post-save screen's back control). */
        back: string;
    };
    /**
     * spec: dfes-companion-2026-07-11 (wave-4.1) — first-open consent gate CHROME ONLY.
     *
     * The notice itself deliberately does NOT live here. It lives in
     * `features/consent/gate/consentNotice.ts` as one addressable, versioned document,
     * because wave-4.2 stores a cryptographic hash of the exact notice displayed and a
     * hash is only worth something if the thing hashed is the thing rendered. Scattering
     * legal sentences across translation keys makes that impossible to guarantee.
     *
     * Everything below is an affordance label or an error — nothing here makes a legal
     * statement, and nothing here is part of the hashed notice.
     */
    consentGate: {
        /** Accessible name for the मराठी | English switcher. */
        languageGroupLabel: string;
        legalLinksLabel: string;
        /** Shown when the two legal records could not be written. Never a silent pass. */
        saveFailed: string;
    };
    // DFES Behavioral Layer (Anti-Ego & Habit Loop)
    dfes: {
        // Closure ritual
        /**
         * Sathi's own first-person sentence, founder-locked 2026-08-14. It is a
         * SENTENCE, not a control label — it heads the confirm panel. The pill
         * that opens that panel uses `closeTodayAction`.
         */
        closeToday: string;
        /** SHORT label for the control that opens the closeToday panel. */
        closeTodayAction: string;
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
    };
}

export const translations: Record<Language, Translations> = {
    en: {
        header: {
            profile: 'Profile',
            settings: 'Settings',
            log: 'LOG',
            reflect: 'REFLECT',
            compare: 'COMPARE',
        },
        nav: {
            procure: 'Procure',
            schedule: 'Schedule',
            income: 'Income',
            tests: 'Tests',
        },
        logPage: {
            selectCrop: 'Select Crop',
            voiceMode: 'Voice',
            manualMode: 'Manual',
            startRecording: 'Tap to Record',
            stopRecording: 'Recording...',
            listening: 'Listening...',
            processing: 'Processing...',
            today: 'Today',
            yesterday: 'Yesterday',
            thisWeek: 'This Week',
            noLogs: 'No logs yet',
            noLogsMessage: 'Start logging your farm activities',
        },
        voice: {
            tapToSpeak: 'Tap microphone to speak',
            orTypeHere: 'Or type here...',
            checkInput: 'Check Input',
            micError: 'Could not access microphone. Please ensure permissions are granted.',
            micDeniedTypeInstead: 'The microphone is off. That is fine — type below and everything still works.',
            selectCropFirst: 'First Choose the crop or plot where you worked today',
            tapToSelect: 'Tap to Select',
            autoStopping: 'Auto-stopping in {seconds}s...',
            discardRecording: 'Discard',
            tapToStop: 'Tap icon to stop',
            selectPlotAbove: 'Select a plot using the pills above',
            startLogging: 'Start Logging',
            savedTitle: 'Your voice is saved',
            savedTranscriptBody: 'I heard your words and kept them safely. I will finish understanding them soon.',
            savedAudioBody: 'I saved your recording safely. I will listen again and understand it soon.',
            savedReassure: 'Your day is counted. Nothing is lost.',
            transcriptHeardLabel: 'You said:',
            unverifiedSourceLabel: "I'm not sure I heard this — is it right?",
        },
        reflectPage: {
            timeline: 'Timeline',
            selectDate: 'Select Date',
            totalCost: 'Total Cost',
            noCropSelected: 'No Crop Selected',
            selectCropMessage: 'Select a crop to view work summary',
        },
        workSummary: {
            totalDailyCost: 'Total Daily Cost',
            workBreakdown: 'Work Breakdown',
            labour: 'Labour',
            irrigation: 'Irrigation',
            machinery: 'Machinery',
            inputs: 'Inputs & Fertilizers',
            notes: 'Notes',
            weather: 'Weather',
            maleWorkers: 'Male Workers',
            femaleWorkers: 'Female Workers',
            hoursWorked: 'Hours Worked',
            method: 'Method',
            duration: 'Duration',
            type: 'Type',
            purpose: 'Purpose',
            fuelCost: 'Fuel Cost',
            rentalCost: 'Rental Cost',
            itemsUsed: 'items used',
            noLabour: 'No labour used today',
            noIrrigation: 'No irrigation today',
            noMachinery: 'Not used today',
            noInputs: 'No inputs used today',
        },
        settings: {
            language: 'Language',
            selectLanguage: 'Select Language',
            english: 'English',
            marathi: 'मराठी (Marathi)',
            labourRates: 'Labour Rates',
            maleRate: 'Male Rate',
            femaleRate: 'Female Rate',
            irrigationDefaults: 'Irrigation Defaults',
            save: 'Save Settings',
            saved: 'Saved!',
            general: 'General',
            demoMode: 'Demo Mode',
            demoDescription: 'Use sample data for testing',
            ledgerConfig: 'Ledger Configuration',
            fixedCosts: 'Fixed Costs & Rates',
            dailyWage: 'Standard Daily Wage',
            tractorRate: 'Tractor Rental Rate',
            fuelCostLabel: 'Fuel Cost',
            labourShifts: 'Labour Shifts',
            rateMale: 'Rate (M)',
            rateFemale: 'Rate (F)',
            harvestConfig: 'Harvest Configuration',
            harvestDescription: 'Pattern & units per plot',
            noCrops: 'No crops configured yet.',
            notConfigured: 'Not configured',
            setup: 'Setup',
        },
        profile: {
            setupHub: 'Setup Hub',
            farmerIdentity: 'Farmer Identity',
            cropsAndPlots: 'Crops & Plots',
            waterAndPower: 'Water & Power',
            machinery: 'Machinery',
            intelligence: 'Intelligence',
            primaryOwner: 'Primary Owner (Malak)',
            verified: 'Verified',
            pendingIntegration: 'Pending Integration',
            linkNow: 'Link Now',
            myFarmTeam: 'My Farm Team',
            manageAccess: 'Manage access for family & workers',
            addMember: 'Add Member',
            partner: 'Partner',
            worker: 'Worker',
            allowLog: 'Allow Log',
            noTeamMembers: 'No team members yet',
            addFamilyOrWorkers: 'Add family or workers to help manage the farm.',
            addNewCrop: 'Add New Crop',
            saveCrop: 'Save Crop',
            plots: 'Plots',
            addPlot: 'Add Plot',
            mapped: 'Mapped',
            addPlotTo: 'Add Plot to',
            step: 'Step',
            plotName: 'Plot Name',
            area: 'Area',
            unit: 'Unit',
            acre: 'Acre',
            guntha: 'Guntha',
            variety: 'Variety',
            whatDidYouPlant: 'What did you plant?',
            seeds: 'Seeds',
            saplings: 'Saplings',
            companyName: 'Company Name',
            quantityPerAcre: 'Quantity / Acre',
            nurseryName: 'Nursery Name',
            plantAgeDays: 'Plant Age (Days)',
            irrigationMethod: 'Irrigation Method',
            drip: 'Drip',
            flood: 'Flood',
            sprinkler: 'Sprinkler',
            none: 'None',
            linkedMotor: 'Linked Motor',
            selectMotor: 'Select Motor...',
            dripDetails: 'Drip Details',
            pipeSize: 'Pipe Size',
            filter: 'Filter?',
            flowRate: 'Flow Rate (L/Hour)',
            selectTools: 'Select Tools used on this plot',
            back: 'Back',
            nextStep: 'Next Step',
            finishSetup: 'Finish Setup',
            waterSources: 'Water Sources',
            pumpsAndPower: 'Pumps & Power',
            sourceName: 'Source Name',
            noWaterSources: 'No water sources yet.',
            newMachine: 'New Machine',
            saveMachine: 'Save Machine',
            addMachine: 'Add Machine',
            owned: 'Owned',
            rented: 'Rented',
            tankCapacity: 'Tank Capacity (Liters)',
            noMachinery: 'No machinery added yet.',
            saveSource: 'Save Source',
            saveMotor: 'Save Motor',
            noPlots: 'No plots',
            saveSetup: 'Save Setup',
            saveAndFinish: 'Save & Finish',
        },
        confirmation: {
            confirm: 'Confirm',
            edit: 'Edit',
            cancel: 'Cancel',
            save: 'Save',
            looksGood: 'Looks Good',
        },
        common: {
            yes: 'Yes',
            no: 'No',
            ok: 'OK',
            cancel: 'Cancel',
            close: 'Close',
            loading: 'Loading...',
            error: 'Error',
            add: 'Add',
            today: 'Today',
            back: 'Back',
        },
        // First-open consent gate — chrome only (wave-4.1). The notice text is in
        // features/consent/gate/consentNotice.ts.
        consentGate: {
            languageGroupLabel: 'Choose language',
            legalLinksLabel: 'Legal documents',
            saveFailed: 'We could not save this. Please check your connection and try again.',
        },
        // DFES Behavioral Layer
        dfes: {
            // Closure ritual
            closeToday: 'Close today',
            closeTodayAction: 'Check today',
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
    },

    mr: {
        header: {
            profile: 'प्रोफाइल',
            settings: 'सेटिंग्ज',
            log: 'नोंद',
            reflect: 'विश्लेषण',
            compare: 'तुलना',
        },
        nav: {
            procure: 'खरेदी',
            schedule: 'वेळापत्रक',
            income: 'उत्पन्न',
            tests: 'चाचण्या',
        },
        logPage: {
            selectCrop: 'पीक निवडा',
            voiceMode: 'आवाज',
            manualMode: 'हाताने',
            startRecording: 'रेकॉर्ड करण्यासाठी दाबा',
            stopRecording: 'रेकॉर्डिंग...',
            listening: 'ऐकत आहे...',
            processing: 'प्रक्रिया चालू आहे...',
            today: 'आज',
            yesterday: 'काल',
            thisWeek: 'हा आठवडा',
            noLogs: 'अजून नोंदी नाहीत',
            noLogsMessage: 'शेतातील कामांची नोंद सुरू करा',
        },
        voice: {
            tapToSpeak: 'बोलण्यासाठी माइक दाबा',
            orTypeHere: 'किंवा इथे टाइप करा...',
            checkInput: 'इनपुट तपासा',
            micError: 'माइक वापरता आला नाही. कृपया परवानगी द्या.',
            micDeniedTypeInstead: 'माइक बंद आहे. हरकत नाही — खाली लिहून सगळं तसंच करता येतं.',
            selectCropFirst: 'प्रथम आज काम केलेले पीक किंवा प्लॉट निवडा',
            tapToSelect: 'निवडण्यासाठी दाबा',
            autoStopping: '{seconds} सेकंदात आपोआप थांबेल...',
            discardRecording: 'रद्द करा',
            tapToStop: 'थांबवण्यासाठी दाबा',
            selectPlotAbove: 'वरील गोळ्या वापरून प्लॉट निवडा',
            startLogging: 'नोंद सुरू करा',
            savedTitle: 'तुमचा आवाज जपून ठेवला आहे',
            savedTranscriptBody: 'तुमचे शब्द मी ऐकले आणि सुरक्षित ठेवले. लवकरच ते पूर्णपणे समजून घेईन.',
            savedAudioBody: 'तुमची नोंद मी सुरक्षित ठेवली आहे. पुन्हा ऐकून लवकरच समजून घेईन.',
            savedReassure: 'तुमचा आजचा दिवस मोजला गेला आहे. काहीही हरवलेले नाही.',
            transcriptHeardLabel: 'तुम्ही सांगितलं:',
            unverifiedSourceLabel: 'हे मी नक्की ऐकलं नाही — बरोबर आहे का?',
        },
        reflectPage: {
            timeline: 'टाइमलाइन',
            selectDate: 'तारीख निवडा',
            totalCost: 'एकूण खर्च',
            noCropSelected: 'पीक निवडलेले नाही',
            selectCropMessage: 'काम पाहण्यासाठी पीक निवडा',
        },
        workSummary: {
            totalDailyCost: 'आजचा एकूण खर्च',
            workBreakdown: 'कामाचा तपशील',
            labour: 'कामगार',
            irrigation: 'सिंचन',
            machinery: 'यंत्रसामग्री',
            inputs: 'खत आणि औषधे',
            notes: 'टिप्पण्या',
            weather: 'हवामान',
            maleWorkers: 'पुरुष कामगार',
            femaleWorkers: 'महिला कामगार',
            hoursWorked: 'काम केलेले तास',
            method: 'पद्धत',
            duration: 'कालावधी',
            type: 'प्रकार',
            purpose: 'उद्देश',
            fuelCost: 'इंधन खर्च',
            rentalCost: 'भाडे खर्च',
            itemsUsed: 'वस्तू वापरल्या',
            noLabour: 'आज कामगार वापरलेले नाहीत',
            noIrrigation: 'आज सिंचन केले नाही',
            noMachinery: 'आज वापरले नाही',
            noInputs: 'आज खत/औषध वापरले नाही',
        },
        settings: {
            language: 'भाषा',
            selectLanguage: 'भाषा निवडा',
            english: 'English (इंग्रजी)',
            marathi: 'मराठी',
            labourRates: 'कामगार दर',
            maleRate: 'पुरुष दर',
            femaleRate: 'महिला दर',
            irrigationDefaults: 'सिंचन डिफॉल्ट',
            save: 'जतन करा',
            saved: 'जतन झाले!',
            general: 'सामान्य',
            demoMode: 'डेमो मोड',
            demoDescription: 'चाचणीसाठी नमुना डेटा वापरा',
            ledgerConfig: 'खातेवही सेटिंग्ज',
            fixedCosts: 'निश्चित खर्च आणि दर',
            dailyWage: 'दैनंदिन मजुरी',
            tractorRate: 'ट्रॅक्टर भाडे दर',
            fuelCostLabel: 'इंधन खर्च',
            labourShifts: 'कामगार पाळ्या',
            rateMale: 'दर (पु)',
            rateFemale: 'दर (स्त्री)',
            harvestConfig: 'कापणी सेटिंग्ज',
            harvestDescription: 'प्रत्येक प्लॉटसाठी पद्धत आणि एकके',
            noCrops: 'अजून पिके सेट केलेली नाहीत.',
            notConfigured: 'सेट केलेले नाही',
            setup: 'सेटअप',
        },
        profile: {
            setupHub: 'सेटअप केंद्र',
            farmerIdentity: 'शेतकरी ओळख',
            cropsAndPlots: 'पिके आणि प्लॉट',
            waterAndPower: 'पाणी आणि वीज',
            machinery: 'यंत्रसामग्री',
            intelligence: 'बुद्धिमत्ता',
            primaryOwner: 'मुख्य मालक',
            verified: 'सत्यापित',
            pendingIntegration: 'प्रलंबित जोडणी',
            linkNow: 'आता जोडा',
            myFarmTeam: 'माझा शेत संघ',
            manageAccess: 'कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा',
            addMember: 'सदस्य जोडा',
            partner: 'भागीदार',
            worker: 'कामगार',
            allowLog: 'नोंद करू द्या',
            noTeamMembers: 'अजून संघ सदस्य नाहीत',
            addFamilyOrWorkers: 'शेत व्यवस्थापनासाठी कुटुंब किंवा कामगार जोडा.',
            addNewCrop: 'नवीन पीक जोडा',
            saveCrop: 'पीक जतन करा',
            plots: 'प्लॉट',
            addPlot: 'प्लॉट जोडा',
            mapped: 'मॅप केलेले',
            addPlotTo: 'प्लॉट जोडा -',
            step: 'पायरी',
            plotName: 'प्लॉटचे नाव',
            area: 'क्षेत्रफळ',
            unit: 'एकक',
            acre: 'एकर',
            guntha: 'गुंठा',
            variety: 'वाण',
            whatDidYouPlant: 'तुम्ही काय लावलं?',
            seeds: 'बियाणं',
            saplings: 'रोपं',
            companyName: 'कंपनीचे नाव',
            quantityPerAcre: 'प्रमाण / एकर',
            nurseryName: 'रोपवाटिकेचे नाव',
            plantAgeDays: 'रोपाचे वय (दिवस)',
            irrigationMethod: 'सिंचन पद्धत',
            drip: 'ठिबक',
            flood: 'पूर',
            sprinkler: 'तुषार',
            none: 'नाही',
            linkedMotor: 'जोडलेला मोटर',
            selectMotor: 'मोटर निवडा...',
            dripDetails: 'ठिबक तपशील',
            pipeSize: 'पाइप आकार',
            filter: 'फिल्टर?',
            flowRate: 'प्रवाह दर (ली/तास)',
            selectTools: 'या प्लॉटवर वापरलेली साधने निवडा',
            back: 'मागे',
            nextStep: 'पुढची पायरी',
            finishSetup: 'सेटअप पूर्ण करा',
            waterSources: 'पाण्याचे स्रोत',
            pumpsAndPower: 'पंप आणि वीज',
            sourceName: 'स्रोताचे नाव',
            noWaterSources: 'अजून पाण्याचे स्रोत नाहीत.',
            newMachine: 'नवीन यंत्र',
            saveMachine: 'यंत्र जतन करा',
            addMachine: 'यंत्र जोडा',
            owned: 'स्वतःचे',
            rented: 'भाड्याचे',
            tankCapacity: 'टाकी क्षमता (लिटर)',
            noMachinery: 'अजून यंत्रसामग्री जोडलेली नाही.',
            saveSource: 'स्रोत जतन करा',
            saveMotor: 'मोटर जतन करा',
            noPlots: 'प्लॉट नाहीत',
            saveSetup: 'सेटअप जतन करा',
            saveAndFinish: 'जतन करा आणि पूर्ण करा',
        },
        confirmation: {
            confirm: 'पुष्टी करा',
            edit: 'बदला',
            cancel: 'रद्द करा',
            save: 'जतन करा',
            looksGood: 'ठीक आहे',
        },
        common: {
            yes: 'हो',
            no: 'नाही',
            ok: 'ठीक आहे',
            cancel: 'रद्द करा',
            close: 'बंद करा',
            loading: 'लोड होत आहे...',
            error: 'चूक',
            add: 'जोडा',
            // AGENT-DRAFTED 2026-08-14 — needs founder approval. One word, and
            // it is the same आज the founder's own dfes strings already open with
            // ("आजची सगळी कामे…", "आजचं सगळं सांगून झालं का?").
            today: 'आज',
            // Same word already shipping at profile.back and rendered today by
            // ProfilePage / SetupHubMenu / FirstFarmWizard — not a new phrasing.
            back: 'मागे',
        },
        // First-open consent gate — chrome only (wave-4.1). The notice text is in
        // features/consent/gate/consentNotice.ts.
        consentGate: {
            languageGroupLabel: 'भाषा निवडा',
            legalLinksLabel: 'कायदेशीर कागदपत्रं',
            saveFailed: 'हे साठवता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
        },
        // DFES Behavioral Layer
        dfes: {
            // Closure ritual
            closeToday: 'आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा',
            // AGENT-DRAFTED 2026-08-14 — needs founder approval. Lifted verbatim
            // from the closing verb phrase of the founder's own closeToday
            // sentence above, so the pill and the panel it opens speak the same
            // words. No new vocabulary was invented.
            closeTodayAction: 'खात्री करा',
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

            // Onboarding
            shramSathi: 'श्रम साथी',
            onboardingWelcome: 'शेतातली कामं श्रम साथीला सांगा — तो तुमची शेती आणि तुमच्या कामाची पद्धत समजून घेईल.',
            letsStart: 'चला सुरू करूया',
            whichCropToday: 'आज कोणत्या पिकावर काम?',
            whatWorkToday: 'आज काय काम झालं?',
            firstLogCelebration: 'तुमचे पहिले काम मला समजले',
            comeBackTomorrow: 'उद्या संध्याकाळी या.',

            // Owner verification trigger
            weeklyReviewPrompt: 'तुमच्या शेतात नवीन कामे आहेत. तपासा.',
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
    },
};

/**
 * Get translation text for current language
 */
export function t(key: string, lang: Language = 'en'): string {
    const keys = key.split('.');
    let value: unknown = translations[lang];

    for (const k of keys) {
        value = (value as Record<string, unknown> | undefined)?.[k];
    }

    return (value as string) || key;
}
