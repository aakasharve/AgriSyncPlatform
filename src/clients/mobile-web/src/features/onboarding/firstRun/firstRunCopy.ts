/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16) — the words of the first run, in the ONE
 * language the person chose on स्वागत (never Marathi and English side by side — PLR-D9 T1/T2).
 *
 * Where the Marathi comes from:
 *   - the founder-approved preview `postVoiceResult/app/FirstRunFlow.tsx` (plr-d1a): the स्वागत words,
 *     the two doors, the three phone permissions and the role welcomes — copied word for word;
 *   - words the real app already showed (the permission page's "ask at the moment of use" line, the
 *     create-farm form's labels);
 *   - anything else is marked `// PROPOSED (Marathi)` for the founder's review.
 * The preview's sample farm, people and plots are NOT here: every name on these screens is real.
 */
import type { Language } from '../../../i18n/language';

export interface FirstRunCopy {
    back: string;
    /** While the first run cannot yet tell its next step (the phone's prefs, or /farms/mine, still answering). */
    waiting: string;
    welcome: {
        hello: string;
        tagline: string;
        sathiLead: string;
        sathiName: string;
        sathiTail: string;
        languageLabel: string;
        start: string;
    };
    doors: {
        title: string;
        hint: string;
        ownTitle: string;
        ownLine: string;
        joinTitle: string;
        joinLine: string;
        /** The doors' back signs out — asked first, so one mis-tap does not cost a new OTP. */
        leaveTitle: string;
        leaveLine: string;
        leaveYes: string;
        leaveNo: string;
    };
    create: {
        title: string;
        line: string;
        farmerName: string;
        farmerNamePlaceholder: string;
        farmName: string;
        farmNamePlaceholder: string;
        submit: string;
        submitting: string;
        /** The request never reached the server (no internet). */
        failed: string;
        /** The server answered with a refusal this screen has no own words for. */
        failedServer: string;
        /** bootstrap.phone_not_verified (403). */
        failedPhone: string;
        /** 401 — the sign-in is no longer valid. */
        failedSignIn: string;
    };
    permissions: {
        title: string;
        line: string;
        micTitle: string;
        micLine: string;
        locationTitle: string;
        locationLine: string;
        cameraTitle: string;
        cameraLine: string;
        given: string;
        askLater: string;
        /** The phone has refused it: the OS will not ask again, so say where to turn it on. */
        offInSettings: string;
        next: string;
        typeInstead: string;
        safe: string;
    };
    hello: {
        heading: string;
        jobsHeading: string;
        go: string;
    };
}

const MR: FirstRunCopy = {
    back: 'मागे',
    waiting: 'उघडत आहे…', // the app's own word for a page still opening (translations.ts `documentLoading`)
    welcome: {
        hello: 'नमस्कार!',
        tagline: 'तुमचं शेत, तुमच्या आवाजात',
        sathiLead: 'मी ',
        sathiName: 'श्रम साथी',
        sathiTail: '. रोज शेतात काय झालं ते मला बोलून सांगा — बाकी हिशोब मी ठेवतो.',
        languageLabel: 'भाषा', // PROPOSED (Marathi) — screen-reader name of the language choice
        start: 'सुरू करूया',
    },
    doors: {
        title: 'तुम्ही इथे कसे आलात?',
        hint: 'एक निवडा',
        ownTitle: 'माझं शेत सुरू करायचं',
        ownLine: 'तुम्ही शेताचे मालक',
        joinTitle: 'मला बोलावलं आहे',
        joinLine: 'QR स्कॅन करा किंवा शेत कोड टाका — भूमिका मालक ठरवतो',
        leaveTitle: 'बाहेर पडायचं?', // PROPOSED (Marathi)
        leaveLine: 'पुन्हा आत येताना फोन नंबर आणि OTP लागेल.', // PROPOSED (Marathi)
        leaveYes: 'बाहेर पडा', // the सेट-अप केंद्र sign-out's own words (SetupHubMenu.tsx)
        leaveNo: 'इथेच राहा', // PROPOSED (Marathi)
    },
    create: {
        title: 'माझं शेत सुरू करायचं',
        line: 'तुम्ही शेताचे मालक',
        farmerName: 'तुमचे नाव',
        farmerNamePlaceholder: 'उदा. पुरुषोत्तम पाटील',
        farmName: 'शेताचे नाव',
        farmNamePlaceholder: 'उदा. रामू पाटील शेत',
        submit: 'शेत तयार करा',
        submitting: 'सुरू होत आहे…',
        failed: 'शेत तयार करता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        failedServer: 'शेत तयार करता आलं नाही. थोड्या वेळाने पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        failedPhone: 'शेत तयार करता आलं नाही. आधी फोन नंबर OTP ने पडताळा.', // PROPOSED (Marathi)
        failedSignIn: 'शेत तयार करता आलं नाही. मागे जाऊन पुन्हा लॉग इन करा.', // PROPOSED (Marathi)
    },
    permissions: {
        title: 'फोनच्या परवानग्या',
        line: 'ज्या वेळी लागेल त्याच वेळी विचारू — आत्ता काहीच मागत नाही',
        micTitle: 'मायक्रोफोन',
        micLine: 'बोलून काम सांगण्यासाठी — सगळ्यात महत्त्वाचं',
        locationTitle: 'स्थान',
        locationLine: 'तुमच्या गावाचं हवामान दाखवण्यासाठी',
        cameraTitle: 'कॅमेरा',
        cameraLine: 'बिल, पिकाचे फोटो आणि QR साठी',
        given: 'दिली',
        askLater: 'वापरताना विचारू', // PROPOSED (Marathi) — the row is not a button; the OS asks at first use
        offInSettings: 'फोनच्या सेटिंगमधून चालू करा', // PROPOSED (Marathi) — the phone refused it; it will not ask again
        next: 'समजलं, पुढे चला',
        typeInstead: 'मायक्रोफोन नको असेल तरी हाताने लिहून सगळं करता येतं',
        safe: 'तुमची माहिती सुरक्षित आहे — फक्त गरजेपुरतीच वापरतो.',
    },
    hello: {
        heading: 'अभिनंदन!',
        jobsHeading: 'तुम्ही इथे हे कराल',
        go: 'चला, सुरुवात करूया',
    },
};

/** English — shown only when the person chose English on स्वागत or in सेट-अप केंद्र. */
const EN: FirstRunCopy = {
    back: 'Back',
    waiting: 'Opening…',
    welcome: {
        hello: 'Namaskar!',
        tagline: 'Your farm, in your voice',
        sathiLead: 'I am ',
        sathiName: 'Shram Sathi',
        sathiTail: '. Tell me by voice what happened on the farm each day — I keep the accounts.',
        languageLabel: 'Language',
        start: "Let's start",
    },
    doors: {
        title: 'How did you come here?',
        hint: 'Choose one',
        ownTitle: 'I want to start my farm',
        ownLine: 'You are the farm owner',
        joinTitle: 'I was invited',
        joinLine: 'Scan the QR or type the farm code — the owner decides your role',
        leaveTitle: 'Sign out?',
        leaveLine: 'To come back in you will need your phone number and the OTP.',
        leaveYes: 'Sign out',
        leaveNo: 'Stay here',
    },
    create: {
        title: 'I want to start my farm',
        line: 'You are the farm owner',
        farmerName: 'Your name',
        farmerNamePlaceholder: 'e.g. Purushottam Patil',
        farmName: 'Farm name',
        farmNamePlaceholder: 'e.g. Ramu Patil farm',
        submit: 'Create the farm',
        submitting: 'Starting…',
        failed: 'Could not create the farm. Check the internet and try again.',
        failedServer: 'Could not create the farm. Try again in a little while.',
        failedPhone: 'Could not create the farm. First verify your phone number with the OTP.',
        failedSignIn: 'Could not create the farm. Go back and sign in again.',
    },
    permissions: {
        title: 'Phone permissions',
        line: 'We ask only at the moment it is needed — nothing is asked now',
        micTitle: 'Microphone',
        micLine: 'To tell your work by voice — the most important one',
        locationTitle: 'Location',
        locationLine: "To show your village's weather",
        cameraTitle: 'Camera',
        cameraLine: 'For bills, crop photos and the QR',
        given: 'Given',
        askLater: 'Asked when used',
        offInSettings: 'Turn on in phone settings',
        next: 'Got it, continue',
        typeInstead: 'Without the microphone you can still type everything',
        safe: 'Your information is safe — used only as needed.',
    },
    hello: {
        heading: 'Congratulations!',
        jobsHeading: 'What you will do here',
        go: "Let's begin",
    },
};

export const FIRST_RUN_COPY: Record<Language, FirstRunCopy> = { mr: MR, en: EN };

/** The copy for a language; anything unknown reads as Marathi (the app's default). */
export const firstRunCopy = (language: Language | null | undefined): FirstRunCopy =>
    language === 'en' ? EN : MR;
