/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2) — the login screens' words in ONE
 * language at a time. They used to print Marathi and English side by side ("पासवर्डने लॉग इन करा / Use
 * password", "मोबाईल नंबर · Phone", "पडताळा / Verify"…) or English alone ("Sign In", "Sign in with your
 * phone number", "Enter the 6-digit code…"). PLR-D9 T1/T2: no English and no doubled labels on a farmer
 * screen. English is shown only to someone who chose English on स्वागत or in सेट-अप केंद्र.
 *
 * Marathi the app already showed is kept word for word; words taken from the founder-approved preview
 * (plr-d1a `postVoiceResult/app/FirstRunFlow.tsx`) carry a `// approved preview` note with the line;
 * new Marathi is marked `// PROPOSED (Marathi)`.
 * The consent tick's words are NOT here: they are the hashed notice's (`consentNotice.ts`).
 *
 * Round-1 review (LANG-2-a / F4, LANG-2-b): a wrong password used to print AuthProvider's English
 * "Login failed. Check phone/password and try again." on this screen, and the logo's alt text and the
 * password eye's screen-reader name were English. All three are here now, in the chosen language.
 */
import type { Language } from '../../i18n/language';
import { JOIN_DOOR_LABEL } from '../onboarding/qr/farmCodeEntry';

export interface AuthCopy {
    back: string;
    /** The logo's alt text (read aloud by a screen reader). */
    logoAlt: string;
    usePassword: string;
    joinSeparator: string;
    joinLabel: string;
    joinAfterSignInHint: string;
    trustSecure: string;
    trustReliable: string;
    trustForFarmers: string;
    password: {
        intro: string;
        backToOtp: string;
        phone: string;
        password: string;
        remember: string;
        signIn: string;
        signingIn: string;
        /** Shown when the sign-in was refused (AuthProvider's own text is English). */
        failed: string;
        /** Screen-reader names of the password eye. */
        showPassword: string;
        hidePassword: string;
        workerSeparator: string;
        workerNote: string;
        version: string;
    };
    otp: {
        title: string;
        line: string;
        phone: string;
        phonePlaceholder: string;
        send: string;
        sending: string;
        saveFailed: string;
        tooMany: string;
        sendFailed: string;
    };
    verify: {
        title: string;
        sentTo: (maskedPhone: string) => string;
        name: string;
        namePlaceholder: string;
        nameHint: string;
        code: string;
        waitToResend: (seconds: number) => string;
        remember: string;
        verify: string;
        verifying: string;
        wrongCode: string;
        expired: string;
        tooMany: string;
        failed: string;
    };
}

const MR: AuthCopy = {
    back: 'मागे',
    logoAlt: 'श्रम सफल', // the brand as the app already writes it (consentNotice.ts, attendanceCopy.ts)
    usePassword: 'पासवर्डने लॉग इन करा',
    joinSeparator: 'कामाला येता?',
    joinLabel: JOIN_DOOR_LABEL,
    joinAfterSignInHint:
        'आधी तुमच्या फोन नंबरने आत या. आत आल्यावर शेताचा कोड टाकायचं पान लगेच उघडेल. QR असेल तर तो फोनच्या कॅमेऱ्याने स्कॅन करा.',
    trustSecure: 'सुरक्षित',
    trustReliable: 'विश्वसनीय',
    trustForFarmers: 'शेतकऱ्यांसाठी तयार',
    password: {
        intro: 'फोन नंबर आणि पासवर्डने लॉग इन करा.', // PROPOSED (Marathi)
        backToOtp: 'OTP ने लॉग इन करा',
        phone: 'मोबाईल नंबर',
        password: 'पासवर्ड', // PROPOSED (Marathi)
        remember: 'हे डिव्हाइस लक्षात ठेवा',
        signIn: 'लॉग इन करा',
        signingIn: 'लॉग इन होत आहे…', // PROPOSED (Marathi)
        failed: 'लॉग इन झालं नाही. फोन नंबर आणि पासवर्ड तपासून पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        showPassword: 'पासवर्ड दाखवा', // PROPOSED (Marathi)
        hidePassword: 'पासवर्ड लपवा', // PROPOSED (Marathi)
        workerSeparator: 'मी कामाला येतो',
        workerNote: 'कामगारांना फक्त फोन नंबर आणि OTP लागतो. पासवर्ड लागत नाही.', // PROPOSED (Marathi)
        version: 'आवृत्ती', // PROPOSED (Marathi)
    },
    otp: {
        title: 'लॉग इन करा',
        line: 'यावर एक कोड (OTP) येईल', // approved preview — FirstRunFlow.tsx:233 (phone step)
        phone: 'मोबाईल नंबर',
        phonePlaceholder: '10 अंकी नंबर', // approved preview — FirstRunFlow.tsx:240 (placeholder)
        send: 'OTP पाठवा',
        sending: 'OTP पाठवत आहे…',
        saveFailed: 'हे साठवता आलं नाही.',
        tooMany: 'खूप जास्त विनंत्या. काही वेळाने प्रयत्न करा.',
        sendFailed: 'OTP पाठवणे अयशस्वी.',
    },
    verify: {
        title: 'OTP टाका',
        sentTo: (masked) => `${masked} वर पाठवला`, // approved preview — FirstRunFlow.tsx:233 (OTP step; its sample-code hint dropped)
        name: 'तुमचं नाव',
        namePlaceholder: 'उदा. पुरुषोत्तम आरवे',
        nameHint: 'पहिल्यांदा येत असाल तरच लागेल',
        code: '६-अंकी कोड',
        waitToResend: (s) => `पुन्हा OTP मागवायला ${s} सेकंद थांबा`, // PROPOSED (Marathi)
        remember: 'हे डिव्हाइस लक्षात ठेवा',
        verify: 'पडताळा',
        verifying: 'पडताळत आहे…',
        wrongCode: 'चुकीचा OTP. परत प्रयत्न करा.',
        expired: 'OTP कालबाह्य झाला. मागे जाऊन नवीन OTP मागवा.', // PROPOSED (Marathi) — second sentence
        tooMany: 'खूप जास्त प्रयत्न. थोडं थांबून पुन्हा प्रयत्न करा.', // PROPOSED (Marathi) — second sentence
        failed: 'OTP पडताळणी अयशस्वी.',
    },
};

const EN: AuthCopy = {
    back: 'Back',
    logoAlt: 'ShramSafal',
    usePassword: 'Sign in with password',
    joinSeparator: 'Coming to work?',
    joinLabel: 'Join with a code or QR',
    joinAfterSignInHint:
        'First sign in with your phone number. The page to type the farm code opens right after. If you have a QR, scan it with the phone camera.',
    trustSecure: 'Secure',
    trustReliable: 'Reliable',
    trustForFarmers: 'Built for farmers',
    password: {
        intro: 'Sign in with phone and password.',
        backToOtp: 'Sign in with OTP (recommended)',
        phone: 'Phone',
        password: 'Password',
        remember: 'Remember this device',
        signIn: 'Sign in',
        signingIn: 'Signing in…',
        failed: 'Login failed. Check phone/password and try again.',
        showPassword: 'Show password',
        hidePassword: 'Hide password',
        workerSeparator: 'I am a worker',
        workerNote: 'Workers only need their phone number and the OTP. No password.',
        version: 'Version',
    },
    otp: {
        title: 'Sign in',
        line: 'A code (OTP) will come to this number',
        phone: 'Mobile number',
        phonePlaceholder: '10-digit number',
        send: 'Send OTP',
        sending: 'Sending OTP…',
        saveFailed: 'Could not save this.',
        tooMany: 'Too many requests. Try again later.',
        sendFailed: 'Failed to send OTP.',
    },
    verify: {
        title: 'Enter the OTP',
        sentTo: (masked) => `Sent to ${masked}`,
        name: 'Your name',
        namePlaceholder: 'e.g. Purushottam Arve',
        nameHint: 'Only needed the first time',
        code: '6-digit code',
        waitToResend: (s) => `Wait ${s}s to ask for a new OTP`,
        remember: 'Remember this device',
        verify: 'Verify',
        verifying: 'Verifying…',
        wrongCode: 'Wrong OTP. Try again.',
        expired: 'OTP expired. Go back and request a new one.',
        tooMany: 'Too many attempts. Wait and try again.',
        failed: 'Verification failed.',
    },
};

export const authCopy = (language: Language | null | undefined): AuthCopy => (language === 'en' ? EN : MR);
