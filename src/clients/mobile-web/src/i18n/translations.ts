/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Language Translations
 * Marathi (mr) and English (en) translations for entire app
 *
 * COMPOSED, NOT MONOLITHIC. The DFES behavioural-layer copy lives in
 * `dfesTranslations.ts` — see that file for why the split happened and what it
 * is NOT allowed to change. Add the next large section the same way rather than
 * growing this file back past the 800-line cap.
 */

import type { Language } from './language';
import { dfesTranslations, type DfesTranslations } from './dfesTranslations';
import {
    shramSathiTranslations,
    syncTranslations,
    type ShramSathiTranslations,
    type SyncTranslations,
} from './syncTranslations';

export type { Language };

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
        /** Shown when the two legal records could not be written. Never a silent pass. */
        saveFailed: string;
    };

    /**
     * The Shram Sathi voice — the claims the app may make about a farmer's
     * records, and the sentences it says while making them. See
     * `syncTranslations.ts`, which carries the reasoning for every string.
     */
    sync: SyncTranslations;
    shramSathi: ShramSathiTranslations;

    // DFES Behavioral Layer (Anti-Ego & Habit Loop) — see `dfesTranslations.ts`
    dfes: DfesTranslations;
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
            saveFailed: 'We could not save this. Please check your connection and try again.',
        },
        sync: syncTranslations.en,
        shramSathi: shramSathiTranslations.en,
        // DFES Behavioral Layer
        dfes: dfesTranslations.en,
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
            labour: 'मजुरी',
            irrigation: 'सिंचन',
            machinery: 'यंत्रसामग्री',
            inputs: 'खत आणि औषधे',
            notes: 'टिप्पण्या',
            weather: 'हवामान',
            maleWorkers: 'पुरुष',
            femaleWorkers: 'महिला',
            method: 'पद्धत',
            duration: 'कालावधी',
            type: 'प्रकार',
            purpose: 'उद्देश',
            fuelCost: 'इंधन खर्च',
            rentalCost: 'भाडे खर्च',
            itemsUsed: 'वस्तू वापरल्या',
            noLabour: 'आज कोणी कामावर नव्हतं',
            noIrrigation: 'आज सिंचन केले नाही',
            noMachinery: 'आज वापरले नाही',
            noInputs: 'आज खत/औषध वापरले नाही',
        },
        settings: {
            language: 'भाषा',
            selectLanguage: 'भाषा निवडा',
            english: 'English (इंग्रजी)',
            marathi: 'मराठी',
            labourRates: 'मजुरीचे दर',
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
            dailyWage: 'रोजची मजुरी',
            tractorRate: 'ट्रॅक्टर भाडे दर',
            fuelCostLabel: 'इंधन खर्च',
            labourShifts: 'कामाच्या पाळ्या',
            rateMale: 'दर (पु)',
            rateFemale: 'दर (स्त्री)',
            harvestConfig: 'कापणी सेटिंग्ज',
            harvestDescription: 'प्रत्येक प्लॉटसाठी पद्धत आणि एकके',
            noCrops: 'अजून पिके सेट केलेली नाहीत.',
            notConfigured: 'सेट केलेले नाही',
            setup: 'सेटअप',
        },
        profile: {
            setupHub: 'सेट-अप केंद्र',
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
            manageAccess: 'कोणाला काय जबाबदारी, ते इथे ठरवा.',
            addMember: 'सदस्य जोडा',
            partner: 'भागीदार',
            worker: 'कामगार',
            allowLog: 'नोंद करण्याची जबाबदारी',
            noTeamMembers: 'अजून कोणी संघात नाही',
            addFamilyOrWorkers: 'शेतात मदत करणाऱ्यांची नावं जोडा — घरातली किंवा बाहेरची.',
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
            saveFailed: 'हे साठवता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
        },
        sync: syncTranslations.mr,
        shramSathi: shramSathiTranslations.mr,
        // DFES Behavioral Layer
        dfes: dfesTranslations.mr,
    },
};

/**
 * Get translation text for current language
 */
export function t(key: string, lang: Language = 'en'): string {
    const keys = key.split('.');
    // FORCED SCOPE (Labour V1 Task 8.6): this was `any`, the file's only ESLint
    // warning, and the pre-commit gate runs `--max-warnings 0` — so removing the
    // three dead `hoursWorked` entries above could not be committed until this
    // was resolved. Narrowed rather than suppressed. Behaviour for a resolved
    // string key is byte-identical (`value || key`); a key that resolves to a
    // non-string — a namespace object, which the old code returned AS the
    // "string" — now falls back to the key instead of leaking `[object Object]`
    // into the UI.
    let value: unknown = translations[lang];

    for (const k of keys) {
        value = typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)[k]
            : undefined;
    }

    return typeof value === 'string' ? (value || key) : key;
}

/**
 * `t()` plus `{placeholder}` substitution.
 *
 * WHY IT EXISTS. Counted sentences were being built by concatenation in the
 * caller — `` `${t('sync.onPhone', lang)} — ${skipped} of ${handled} cannot be
 * sent.` `` — which forced the numbers' POSITION to be English word order in
 * every language. Marathi puts the total before `पैकी` and the subset after,
 * the mirror of English, so a concatenated sentence is not translatable at all:
 * it is English grammar wearing Marathi words. A template per language is the
 * only shape that lets the two orders differ.
 *
 * This file already shipped ~8 `{placeholder}` strings (`dfes.todaySummary`,
 * `dfes.daysLoggedThisWeek`, `dfes.ownerHasQuestion`, …) with NO substituter
 * anywhere in the client, so every one of them could only ever have rendered
 * its braces raw. This is the missing half of a convention that was already
 * here, not a new one.
 *
 * AN UNKNOWN PLACEHOLDER IS LEFT STANDING, deliberately. Replacing it with an
 * empty string would turn "3 of 5 will not reach…" into "3 of will not reach…"
 * — a sentence that still reads like a sentence while having lost a number.
 * A visible `{handled}` is a bug report; a silent gap is a wrong statement to a
 * farmer (`P4`).
 */
export function tf(
    key: string,
    lang: Language = 'en',
    vars: Record<string, string | number> = {},
): string {
    return t(key, lang).replace(
        /\{(\w+)\}/g,
        (placeholder, name: string) =>
            Object.prototype.hasOwnProperty.call(vars, name)
                ? String(vars[name])
                : placeholder,
    );
}
