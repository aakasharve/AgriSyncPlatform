/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - every word of the owner's farm-QR sheet, one language at a time
 * (Marathi mode Marathi only, English mode English only; it used to print both, and "Share", "Copy link", "Generate new QR" were English only).
 * Marathi: the words the sheet already had, the drawing's (V2-A sheet: "शेताचा ओळख क्रमांक", "पाठवा"), the contract's proposals ("लिंक कॉपी करा",
 * "नवीन QR बनवा", "पुन्हा दाबा — जुना QR बंद होईल"), and PROPOSED ones. English: the sheet's existing English where it was true, else PROPOSED.
 */
import { JOIN_DOOR_LABEL } from './farmCodeEntry';

export interface InviteQrWords {
    badge: string;
    caption: string;
    codeLabel: string;
    copyCode: string;
    typeCodeLine: string;
    oldAppLine: string;
    share: string;
    copyLink: string;
    copied: string;
    rotate: string;
    rotateConfirm: string;
    footer: string;
    close: string;
    qrAlt: (farmName: string) => string;
    unreachable: string;
    refused: (serverMessage: string) => string;
    rotateFailed: string;
    qrFailed: string;
    shareTitle: (farmName: string) => string;
    shareText: (farmName: string) => string;
}

const MR: InviteQrWords = {
    badge: 'शेतात सामील करा', // PROPOSED (Marathi)
    caption: 'कामाला येणाऱ्यांना ही QR दाखवा', // the sheet's own
    codeLabel: 'शेताचा ओळख क्रमांक', // DRAWN (V2-A sheet)
    copyCode: 'कोड कॉपी करा', // PROPOSED (Marathi)
    typeCodeLine: `QR स्कॅन करता येत नसेल तर: त्यांनी ॲपमध्ये "${JOIN_DOOR_LABEL}" दाबून हा कोड टाकावा.`, // the sheet's own
    oldAppLine: 'हे बटण नवीन ॲपमध्ये आहे — जुने ॲप असेल तर आधी ॲप अपडेट करायला सांगा.', // the sheet's own
    share: 'पाठवा', // DRAWN
    copyLink: 'लिंक कॉपी करा', // CONTRACT
    copied: 'कॉपी केलं', // PROPOSED (Marathi)
    rotate: 'नवीन QR बनवा', // CONTRACT
    rotateConfirm: 'पुन्हा दाबा — जुना QR बंद होईल', // CONTRACT
    footer: 'समोरच्याने ही QR स्कॅन केल्यावर त्याला त्याचा फोन नंबर आणि OTP द्यावा लागेल.', // the sheet's own
    close: 'बंद करा', // PROPOSED (Marathi)
    qrAlt: farmName => `${farmName} मध्ये सामील होण्याचा QR`, // PROPOSED (Marathi)
    unreachable: 'सर्व्हरशी जोडता आलं नाही. थोड्या वेळाने पुन्हा उघडा.', // PROPOSED (Marathi)
    // The server's words are English: Marathi mode says its own.
    refused: () => 'QR मिळाला नाही. थोड्या वेळाने पुन्हा उघडा.', // PROPOSED (Marathi)
    rotateFailed: 'नवीन QR बनवता आला नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
    qrFailed: 'QR बनवता आला नाही.', // PROPOSED (Marathi)
    shareTitle: farmName => `${farmName} — श्रम सफल`, // PROPOSED (Marathi)
    shareText: farmName => `${farmName} मध्ये सामील व्हा`, // the sheet's own
};

const EN: InviteQrWords = {
    badge: 'Invite to farm',
    caption: 'Show this QR to your workers.',
    codeLabel: 'Farm code',
    copyCode: 'Copy farm code',
    typeCodeLine: 'If they cannot scan the QR: in the app they tap "Join with a code or QR" and type this code.', // PROPOSED (English)
    oldAppLine: 'This button is in the new app — if they have the old app, ask them to update it first.', // PROPOSED (English)
    share: 'Share',
    copyLink: 'Copy link',
    copied: 'Copied',
    rotate: 'Generate new QR',
    rotateConfirm: 'Tap again — the old QR will stop working', // PROPOSED (English)
    // "That's it." went: since MU-2 a scan asks to join and the owner says yes (P5).
    footer: 'After they scan, they enter their phone number and the OTP.', // PROPOSED (English)
    close: 'Close',
    qrAlt: farmName => `QR code to join ${farmName}`,
    unreachable: 'Could not reach the server. Open it again in a while.', // PROPOSED (English)
    refused: serverMessage => serverMessage,
    rotateFailed: 'Rotation failed.',
    qrFailed: 'QR generation failed.',
    shareTitle: farmName => `Join ${farmName} on ShramSafal`,
    shareText: farmName => `Join ${farmName}`,
};

export function inviteQrWords(language: string | null | undefined): InviteQrWords {
    return language === 'en' ? EN : MR;
}
