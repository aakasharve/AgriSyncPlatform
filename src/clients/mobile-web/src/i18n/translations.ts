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

    /**
     * Sync status chip — Labour Phase 2 / Phase 1 (honesty backstop), T1.
     *
     * Exactly three claims, each backed by evidence. See
     * `features/sync/status/syncHonestyState.ts` for what each one means and
     * what proves it. The chip is shared app-wide chrome, so these follow the
     * farmer's language preference rather than being hardcoded Marathi.
     */
    sync: {
        /** Captured on the handset. Claims nothing about the server. */
        onPhone: string;
        /** The server acknowledged it (`applied` or `duplicate`). */
        onServer: string;
        /** Rejected, past the retry cap, or never queued at all. */
        needsFix: string;

        /*
         * ── The TAILS ────────────────────────────────────────────────────────
         *
         * PROPOSED COPY, PENDING FOUNDER CONFIRMATION. Wording taken from the
         * CTO ruling of 2026-08-13 (`cto-rulings.md` §1.3). The founder is the
         * Marathi authority; nothing here is a string any agent invented.
         *
         * These exist because the app was speaking half a sentence in each
         * language. `useLogCommands` composed a Marathi `sync.onPhone` with a
         * HARDCODED English tail — a farmer on the Marathi preference read
         * `फोनवर सेव्ह ✓ — 3 of 3 cannot be sent.`, one sentence, two scripts.
         * The claim was honest and the presentation was not.
         *
         * They are TAILS rather than whole sentences on purpose: the reassuring
         * half must come FIRST and must be the SAME string the chip uses
         * (T2/B4 — a farmer scanning a red toast who reads "gone" re-records,
         * and now the ledger holds the day twice). Composing
         * `${t(sync.onPhone)} — ${tail}` keeps `startsWith(onPhone)` true and
         * keeps ONE definition of the phone claim.
         */

        /**
         * "…of the records in this save, N will never reach the server."
         *
         * `{skipped}` and `{handled}` are read off the enqueue RESULT, never
         * off the submitted set, so the sentence cannot round a dropped record
         * up into a saved one.
         *
         * WORD ORDER IS NOT A TRANSLATION OF THE ENGLISH. Marathi `X पैकी Y`
         * means "Y out of X", so the TOTAL binds before `पैकी` and the SUBSET
         * after — the mirror of the English order. Verified against this file's
         * own precedent, `dfes.daysLoggedThisWeek`, which is
         * `'{logged} of {count} days'` in English and
         * `'{count} पैकी {logged} दिवस'` in Marathi. Getting this backwards
         * would report the wrong number in the language most farmers read.
         */
        notFiledCountTail: string;
        /**
         * The same fact with no counts, for the per-record badge on the
         * success card, where the count is already implied by the card itself.
         */
        notFiledBadgeTail: string;

        /**
         * "N labour corrections reached your farm records." — the ONE
         * server-evidenced claim the edit path is allowed to make
         * (`persistedLabourCorrections`, and `postLabourCorrection` throws on
         * any non-2xx).
         *
         * MARATHI HAS ONE FORM HERE, NOT TWO. The CTO's approved clause is the
         * plural `{count} दुरुस्त्या शेतनोंदीत गेल्या.`; no singular was
         * supplied and no agent may inflect one, so the approved plural is used
         * at every count and is listed for the founder. English keeps the
         * singular/plural split the shipped code already had.
         */
        correctionsFiledTailOne: string;
        correctionsFiledTailMany: string;
    };
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
        sync: {
            onPhone: 'Saved on phone',
            onServer: 'Sent',
            needsFix: 'Stuck — check',
            notFiledCountTail: '{skipped} of {handled} will not reach your farm records.',
            notFiledBadgeTail: 'will not reach your farm records',
            correctionsFiledTailOne: '{count} labour correction reached your farm records.',
            correctionsFiledTailMany: '{count} labour corrections reached your farm records.',
        },
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
        sync: {
            onPhone: 'फोनवर सेव्ह ✓',
            onServer: 'पाठवलं ✓',
            needsFix: 'अडकलं — तपासा',
            notFiledCountTail: '{handled} पैकी {skipped} शेतनोंदीत जाणार नाहीत.',
            notFiledBadgeTail: 'शेतनोंदीत जाणार नाही',
            correctionsFiledTailOne: '{count} दुरुस्त्या शेतनोंदीत गेल्या.',
            correctionsFiledTailMany: '{count} दुरुस्त्या शेतनोंदीत गेल्या.',
        },
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
