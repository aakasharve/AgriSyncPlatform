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
        selectCropFirst: string;
        tapToSelect: string;
        autoStopping: string;
        discardRecording: string;
        tapToStop: string;
        selectPlotAbove: string;
        startLogging: string;
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
    };
    // DFES Behavioral Layer (Anti-Ego & Habit Loop)
    dfes: {
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
            selectCropFirst: 'First Choose the crop or plot where you worked today',
            tapToSelect: 'Tap to Select',
            autoStopping: 'Auto-stopping in {seconds}s...',
            discardRecording: 'Discard',
            tapToStop: 'Tap icon to stop',
            selectPlotAbove: 'Select a plot using the pills above',
            startLogging: 'Start Logging',
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
        },
        // DFES Behavioral Layer
        dfes: {
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
            selectCropFirst: 'प्रथम आज काम केलेले पीक किंवा प्लॉट निवडा',
            tapToSelect: 'निवडण्यासाठी दाबा',
            autoStopping: '{seconds} सेकंदात आपोआप थांबेल...',
            discardRecording: 'रद्द करा',
            tapToStop: 'थांबवण्यासाठी दाबा',
            selectPlotAbove: 'वरील गोळ्या वापरून प्लॉट निवडा',
            startLogging: 'नोंद सुरू करा',
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
        },
        // DFES Behavioral Layer
        dfes: {
            // Closure ritual
            closeToday: 'आज बंद करा',
            todayClosed: 'आज बंद. सगळं नोंद झालं.',
            closeTodayQuestion: 'आजचं शेत बंद करायचं?',

            // Day summary
            todaySummary: 'आज: {activities} कामं, Rs. {cost} खर्च.',
            weekSummary: 'या आठवड्यात: {entries} नोंदी, Rs. {cost} खर्च.',
            farmBookUpToDate: 'शेतनोंद अद्ययावत आहे.',

            // Verification (anti-ego)
            doesThisMatch: 'हे जुळतं का?',
            allLooksCorrect: 'सगळं बरोबर दिसतंय',
            somethingNeedsFixing: 'काहीतरी सुधारायला हवं',
            ownerHasQuestion: '{owner} यांना या नोंदीबद्दल शंका आहे',
            updated: 'सुधारणा: {field} {oldValue} होतं, {newValue} आहे',
            waitingForConfirmation: 'खात्रीची वाट पाहत आहे',
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
            onboardingWelcome: 'शेताची रोजची नोंद ठेवा. फक्त 30 सेकंद.',
            letsStart: 'चला सुरू करूया',
            whichCropToday: 'आज कोणत्या पिकावर काम?',
            whatWorkToday: 'आज काय काम झालं?',
            firstLogCelebration: 'झालं! तुमची पहिली शेतनोंद जतन झाली.',
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
            entries: 'नोंदी',
            unknown: 'अज्ञात',
            verify: 'खात्री करा',

            // Batch 5
            clickToClose: 'दिवस बंद करण्यासाठी क्लिक करा',
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
        if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[k];
        } else {
            value = undefined;
        }
    }

    return typeof value === 'string' ? value : key;
}
