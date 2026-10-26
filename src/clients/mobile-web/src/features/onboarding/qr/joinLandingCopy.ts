/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, round-2 review LANG-2-QR) — the QR
 * join page's words (`pages/JoinFarmLandingPage.tsx`) in ONE language at a time. The page used to print
 * Marathi and English side by side ("तपासत आहे… / Checking…", "फोन नंबर बदला / Change phone number",
 * "शेती उघडा / Open my farm"), English alone ("Step 1", "Enter your phone number", "Send OTP", "You're
 * in.", "QR is not valid", "Go back") and the server's English errors. PLR-D9 T1/T2: no English and no
 * doubled labels on a farmer screen. This page is on the first run of anyone who scans the owner's QR
 * (App.tsx sends a QR link straight here) and of the "मला बोलावलं आहे" door's QR line.
 *
 * English is shown only to someone who chose English — on स्वागत, in सेट-अप केंद्र, or with the मराठी /
 * English switch in the consent tick's notice on this very page (ConsentNoticeSheet → setLanguage).
 *
 * Marathi the page already showed is kept word for word. Lines shared with the login screens come from
 * `authCopy` (one source). New Marathi is marked `// PROPOSED (Marathi)`.
 */
import type { Language } from '../../../i18n/language';
import { authCopy } from '../../auth/authCopy';

/** What went wrong, said in the screen's language when it is drawn (not when it happened). */
export type JoinProblemKey =
    | 'phoneLength'
    | 'otpLength'
    | 'unreachable'
    | 'sendTooMany'
    | 'sendFailed'
    | 'wrongCode'
    | 'otpStale'
    | 'tooManyTries'
    | 'verifyFailed'
    | 'claimFailed'
    /** The consent records could not be written: the hashed notice's own words (`consentGate.saveFailed`). */
    | 'consentSave';

export interface JoinProblem {
    key: JoinProblemKey;
    /** The server's own message. It is English, so it is shown only to someone who chose English. */
    server?: string;
}

export interface JoinLandingCopy {
    /** The brand, as the app writes it in that language. */
    brand: string;
    back: string;
    intro: string;
    checking: string;
    invalidTitle: string;
    invalidLine: string;
    step1: string;
    phoneTitle: string;
    phoneLine: string;
    send: string;
    sending: string;
    step2: string;
    otpTitle: string;
    sentTo: (phone: string) => string;
    remember: string;
    join: string;
    joining: string;
    changePhone: string;
    waitingTitle: string;
    waitingLine: string;
    ok: string;
    doneTitle: string;
    openFarm: string;
    errors: Record<Exclude<JoinProblemKey, 'consentSave'>, string>;
}

const AUTH_MR = authCopy('mr');
const AUTH_EN = authCopy('en');

const MR: JoinLandingCopy = {
    brand: AUTH_MR.logoAlt, // 'श्रम सफल' — the brand as the app already writes it in Marathi
    back: AUTH_MR.back,
    intro: 'तुम्ही शेतात सामील होत आहात.',
    checking: 'तपासत आहे…',
    invalidTitle: 'हा QR चालत नाही', // PROPOSED (Marathi) — replaces the English "QR is not valid"
    invalidLine: 'तुमच्या मालकाला नवीन QR मागा.',
    step1: 'पायरी १', // PROPOSED (Marathi) — replaces the English "Step 1"
    phoneTitle: 'तुमचा फोन नंबर',
    phoneLine: AUTH_MR.otp.line, // approved preview — FirstRunFlow.tsx:233 (phone step)
    send: 'OTP मिळवा',
    sending: 'पाठवत आहे…',
    step2: 'पायरी २', // PROPOSED (Marathi) — replaces the English "Step 2"
    otpTitle: 'OTP टाका',
    sentTo: (phone) => AUTH_MR.verify.sentTo(`+91 ${phone}`), // approved preview — FirstRunFlow.tsx:233 (OTP step)
    remember: 'हे डिव्हाइस लक्षात ठेवा',
    join: 'सामील व्हा',
    joining: 'तपासत आहे…',
    changePhone: 'फोन नंबर बदला',
    waitingTitle: 'विनंती आधीच पाठवली आहे',
    waitingLine: 'मालक तुमची भूमिका ठरवतील आणि मंजूर करतील — तोपर्यंत वाट पाहा.',
    ok: 'ठीक आहे',
    doneTitle: 'तुम्ही जोडले गेलात!',
    openFarm: 'शेती उघडा',
    errors: {
        phoneLength: '१० अंकी फोन नंबर टाका.', // PROPOSED (Marathi)
        otpLength: '६ अंकी OTP टाका.', // PROPOSED (Marathi)
        unreachable: 'सर्व्हरशी संपर्क झाला नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        sendTooMany: AUTH_MR.otp.tooMany,
        sendFailed: AUTH_MR.otp.sendFailed,
        wrongCode: AUTH_MR.verify.wrongCode,
        otpStale: 'हा OTP आता चालणार नाही. नवीन OTP मागवा.', // PROPOSED (Marathi) — expired / used / none asked
        tooManyTries: AUTH_MR.verify.tooMany,
        verifyFailed: AUTH_MR.verify.failed,
        claimFailed: 'आत्ता शेतात सामील होता आलं नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
    },
};

const EN: JoinLandingCopy = {
    brand: AUTH_EN.logoAlt,
    back: AUTH_EN.back,
    intro: 'You are joining a farm.',
    checking: 'Checking…',
    invalidTitle: 'This QR does not work',
    invalidLine: 'Ask your farm owner for a new QR.',
    step1: 'Step 1',
    phoneTitle: 'Your phone number',
    phoneLine: AUTH_EN.otp.line,
    send: 'Get OTP',
    sending: 'Sending…',
    step2: 'Step 2',
    otpTitle: 'Enter the OTP',
    sentTo: (phone) => AUTH_EN.verify.sentTo(`+91 ${phone}`),
    remember: 'Remember this device',
    join: 'Join the farm',
    joining: 'Verifying…',
    changePhone: 'Change phone number',
    waitingTitle: 'Request already sent',
    waitingLine: 'The owner will decide your role and approve it — until then, please wait.',
    ok: 'OK',
    doneTitle: "You're in!",
    openFarm: 'Open my farm',
    errors: {
        phoneLength: 'Please enter your 10-digit phone number.',
        otpLength: 'OTP should be 6 digits.',
        unreachable: 'Could not reach the server. Check your connection and try again.',
        sendTooMany: AUTH_EN.otp.tooMany,
        sendFailed: AUTH_EN.otp.sendFailed,
        wrongCode: AUTH_EN.verify.wrongCode,
        otpStale: 'This OTP no longer works. Ask for a new one.',
        tooManyTries: AUTH_EN.verify.tooMany,
        verifyFailed: AUTH_EN.verify.failed,
        claimFailed: 'Could not join the farm right now. Try again.',
    },
};

export const joinLandingCopy = (language: Language | null | undefined): JoinLandingCopy => (language === 'en' ? EN : MR);

/**
 * A verify-otp refusal, by the server's code first and its status second (AuthEndpoints maps
 * mismatch 401, expired 410, locked_out 429, no_pending_challenge 404). Only the catch-all keeps the
 * server's own message — the same split `OtpVerifyForm` makes.
 */
export const otpVerifyProblem = (err: { error: string; message?: string; status?: number }): JoinProblem => {
    if (err.error === 'otp.mismatch') return { key: 'wrongCode' };
    if (err.error === 'otp.expired' || err.error === 'otp.no_pending_challenge' || err.error === 'otp.already_consumed') {
        return { key: 'otpStale' };
    }
    if (err.error === 'otp.locked_out') return { key: 'tooManyTries' };
    if (err.status === 401) return { key: 'wrongCode' };
    if (err.status === 410) return { key: 'otpStale' };
    if (err.status === 429) return { key: 'tooManyTries' };
    return { key: 'verifyFailed', server: err.message };
};
