/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the words of the join door (`JoinByCodeScreen`).
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — LANG-2, round-2 review LANG-strict-EN-join)
 * — ONE language per screen. The Marathi is unchanged, word for word (every Marathi string here was
 * already PROPOSED; `unknown` and `roleNote` follow the approved preview's words). The English is for
 * someone who chose English (स्वागत or सेट-अप केंद्र): before this, "I was invited" on the English
 * first run opened a Marathi-only screen.
 */
import type { Language } from '../../../i18n/language';

/** PROPOSED Marathi (founder review). `unknown` and `roleNote` follow the approved preview's words. */
export const JOIN_BY_CODE_COPY = {
    title: 'शेतात सामील व्हा',
    codeLabel: 'मालकाने दिलेला शेताचा कोड टाका',
    codePlaceholder: '६ अक्षरांचा कोड',
    roleNote: 'तुमची भूमिका मालक ठरवतील.',
    checking: 'तपासत आहे…',
    unknown: 'हा कोड सापडला नाही. मालकाला पुन्हा विचारा.',
    rateLimited: 'थोड्या वेळाने पुन्हा प्रयत्न करा',
    failed: 'आत्ता पाठवता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
    // M5: the sign-in itself is gone (refused even after one refresh) — the internet is not the problem.
    signedOut: 'तुमचं लॉगिन संपलं आहे. पुन्हा लॉग इन करा.',
    badLink: 'ही लिंक ओळखता आली नाही. मालकाला ती पुन्हा पाठवायला सांगा.',
    retry: 'पुन्हा पाठवा',
    qrTitle: 'QR असेल तर',
    qrLine: 'फोनच्या कॅमेऱ्याने QR स्कॅन करा — सामील होण्याचं पान उघडेल. मालकाने लिंक पाठवली असेल तर ती वरच्या चौकटीत टाका.',
    sentTitle: 'विनंती पाठवली',
    sentLine: 'मालक तुमची भूमिका ठरवतील आणि मंजूर करतील — तोपर्यंत वाट पाहा',
    activeTitle: 'तुम्ही आधीच या शेतात आहात',
    pausedTitle: 'या शेतातलं तुमचं काम थांबवलं आहे',
    pausedLine: 'मालकाशी बोला.',
    ok: 'ठीक आहे',
    back: 'मागे',
} as const;

export type JoinByCodeCopy = Record<keyof typeof JOIN_BY_CODE_COPY, string>;

/** The same lines in English, for someone who chose English. */
export const JOIN_BY_CODE_COPY_EN: JoinByCodeCopy = {
    title: 'Join a farm',
    codeLabel: 'Type the farm code the owner gave you',
    codePlaceholder: '6-letter code',
    roleNote: 'The owner will decide your role.',
    checking: 'Checking…',
    unknown: 'This code was not found. Ask the owner again.',
    rateLimited: 'Try again in a little while',
    failed: 'Could not send it now. Check the internet and try again.',
    signedOut: 'Your sign-in has ended. Please sign in again.',
    badLink: 'This link was not recognised. Ask the owner to send it again.',
    retry: 'Send again',
    qrTitle: 'If you have a QR',
    qrLine: 'Scan the QR with the phone camera — the join page will open. If the owner sent a link, paste it in the box above.',
    sentTitle: 'Request sent',
    sentLine: 'The owner will decide your role and approve it — until then, please wait',
    activeTitle: 'You are already on this farm',
    pausedTitle: 'Your work on this farm is paused',
    pausedLine: 'Talk to the owner.',
    ok: 'OK',
    back: 'Back',
};

/** The join door's words in the chosen language (Marathi unless English was chosen). */
export const joinByCodeCopy = (language: Language | null | undefined): JoinByCodeCopy =>
    (language === 'en' ? JOIN_BY_CODE_COPY_EN : JOIN_BY_CODE_COPY);
