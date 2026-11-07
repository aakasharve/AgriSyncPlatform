/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12). The words a bill's मंजूर is said in, one
 * language at a time: Marathi in Marathi mode, the English twin in English mode. Every line here is PROPOSED copy (founder
 * review). A day is shown on the farm's calendar (IST); a name only when the server sent it (MU-3), never a guess.
 */
import { DISPLAY_TIME_ZONE } from '../../shared/utils/displayTime';
import type { MoneyApproval } from './finance.types';
import { BILL_VERSION_CONFLICT_CODE } from './billApproval';

export type BillLang = 'mr' | 'en';

const said = (mr: string, en: string) => ({ mr, en });

const WORDS = {
    approve: said('मंजूर करा', 'Approve'),
    approved: said('मंजूर', 'Approved'),
    approvedOlder: said('आधीच्या रूपाला मंजूर', 'Approved for an earlier version'),
    olderHint: said('नंतर रक्कम बदलली — पुन्हा पाहून मंजूर करा', 'The amount changed later — look again and approve'),
    pending: said('मंजुरी पाठवायची आहे', 'Approval waiting to be sent'),
    changed: said('हे बिल बदललं आहे — नवीन रक्कम पाहून पुन्हा मंजूर करा', 'This bill changed — look at the new amount and approve again'),
    changedNotHereYet: said(
        'नवीन रूप अजून या फोनवर आलं नाही — थोड्या वेळाने पुन्हा पाहा',
        'The new version has not reached this phone yet — check again in a while'),
    refused: said(
        'मंजुरी झाली नाही — श्रमसफलच्या नियमानुसार हे बिल तुम्ही मंजूर करू शकत नाही',
        'Not approved — by ShramSafal rules you cannot approve this bill'),
    failed: said('मंजुरी पाठवता आली नाही — पुन्हा प्रयत्न करा', 'Could not send the approval — try again'),
    newAmount: said('नवीन रक्कम', 'New amount'),
    meaning: said(
        'बिल मंजूर म्हणजे हा खर्च तपासला. पैसे दिल्याची नोंद वेगळी आहे.',
        'Approving a bill means this expense was checked. A payment record is separate.'),
    whoApproves: said(
        'श्रमसफलच्या नियमानुसार बिल मालक किंवा त्यांनी परवानगी दिलेली व्यक्ती मंजूर करते.',
        'By ShramSafal rules a bill is approved by the owner or someone they allowed.'),
    withheld: said('—', '—'),
} as const;

export type BillWord = keyof typeof WORDS;

export function billWord(key: BillWord, language: BillLang): string {
    return WORDS[key][language];
}

/** The stamp's day on the farm's calendar, in his language's month names; nothing when it cannot be read. */
export function stampDay(atUtc: string, language: BillLang): string {
    const d = new Date(atUtc);
    if (Number.isNaN(d.getTime())) return '';
    const locale = language === 'en' ? 'en-IN' : 'mr-IN-u-nu-latn';
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(d);
}

/**
 * "मंजूर · ‹नाव› · ‹दिवस›" — or, for a stamp on an older version, "आधीच्या रूपाला मंजूर · ‹नाव› · ‹दिवस›". A name the
 * server did not send is left out (never "unknown"), and so is a day it could not say.
 */
export function stampLine(approval: MoneyApproval, older: boolean, language: BillLang): string {
    const head = billWord(older ? 'approvedOlder' : 'approved', language);
    return [head, approval.approvedByName, stampDay(approval.approvedAtUtc, language)].filter(Boolean).join(' · ');
}

/** What a parked refusal is said as, by the server's code — never its English sentence in Marathi mode. */
export function refusalLine(errorCode: string | undefined, language: BillLang): string {
    if (errorCode === BILL_VERSION_CONFLICT_CODE) return billWord('changed', language);
    if (errorCode && (errorCode.endsWith('Forbidden') || errorCode.endsWith('NotFound'))) return billWord('refused', language);
    return billWord('failed', language);
}
