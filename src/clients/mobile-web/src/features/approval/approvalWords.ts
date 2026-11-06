/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-3 / D-40 / D-45 / D-46) — every word
 * of the ONE approval path, as Marathi / English twins, one language at a time.
 *
 * Provenance of each line:
 *  - FOUNDER (verbatim, D-40): `explanation`, `empty`, the chip words "मंजुरीसाठी N" / "पाठवणे बाकी N".
 *  - EXISTING (already on the review sheet, kept exactly): `title`, `countLine`, `approve`, `dispute`, `undo`,
 *    `approvedMark`, `disputedMark`, `listUnknown*`, the help note, the failure toasts.
 *  - PROPOSED (new in lane L4b, awaiting the founder's wording review): every English twin, and the Marathi of the
 *    bulk, शंका-reason and "this record changed" lines. Marked `// PROPOSED` below.
 * No "AI" anywhere and no emoji (founder rules).
 */
import type { Language } from '../../i18n/language';
import { parseReviewDetailDate, formatReviewDetail } from '../labour/reviewDetailDate';
import { toMarathiDigits } from '../labour/marathiDate';

/**
 * A count in the reader's own digits: Devanagari in Marathi (the founder's D-1 example "२"; the app's existing
 * `toMarathiDigits`), plain in English.
 */
export function numberIn(n: number, language: Language): string {
    return language === 'mr' ? toMarathiDigits(n) : String(n);
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The work date on a card: आज / काल / "५ नोव्हें." in Marathi (the existing helper), Today / Yesterday / "5 Nov". */
export function workDateIn(detail: string, language: Language, now: Date = new Date()): string {
    if (language === 'mr') return formatReviewDetail(detail, now);
    const parsed = parseReviewDetailDate(detail);
    if (!parsed) return detail;
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOf(now) - startOf(parsed)) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${parsed.getDate()} ${EN_MONTHS[parsed.getMonth()]}`;
}

export interface ApprovalWords {
    title: string;
    countLine: (n: number) => string;
    /** FOUNDER D-40 §5 — said once, in the sheet. */
    explanation: string;
    /** FOUNDER D-40 §6 — the empty list; never "सर्व कामे पूर्ण". */
    empty: string;
    listUnknown: string;
    listUnknownTitle: string;
    listUnknownHint: string;
    close: string;
    approve: string;
    dispute: string;
    undo: string;
    approvedMark: string;
    disputedMark: string;
    approvedMany: (n: number) => string;
    toastApproved: (onPhone: string) => string;
    toastDisputed: (onPhone: string) => string;
    toastApprovedMany: (onPhone: string) => string;
    failedOne: string;
    failedDispute: string;
    failedMany: (n: number) => string;
    peopleUnit: string;
    unknownMark: string;
    helpWhat: string;
    helpAct: string;
    helpWhy: string;
    helpLabel: string;
    // ── bulk (D-40 §4) ──
    select: string;
    selected: string;
    approveSelected: (n: number) => string;
    confirmSelected: (n: number) => string;
    confirmYes: string;
    confirmNo: string;
    lookAlone: string;
    // ── शंका needs a reason (D-40 §3) ──
    reasonPrompt: string;
    reasonPlaceholder: string;
    reasonSpeak: string;
    reasonListening: string;
    reasonNoMic: string;
    reasonSend: string;
    cancel: string;
    // ── the record changed (D-46 §3) ──
    changedTitle: string;
    changedReason: string;
    whatChanged: string;
    factPeople: string;
    factWork: string;
    factPlot: string;
    factCost: string;
    // ── the doors ──
    /** FOUNDER D-40 §2 — the approval signal. */
    approvalChip: (n: number) => string;
    /** FOUNDER D-40 §2 — this phone's unsent records only. */
    unsentChip: (n: number) => string;
    jobCardPending: string;
    // ── lane L4b fix round 1 ──
    /** H-2 — the list's only records are his own decisions still on this phone: never "nothing left". */
    listSending: string;
    /** M-3 (D-40 "trial expiry explained with a working action") — a मंजूर held for the farm's subscription. */
    heldApprovals: string;
    /** M-3 — the way to the subscription screen. */
    heldApprovalsOpen: string;
}

const MR: ApprovalWords = {
    title: 'तपासणी',
    countLine: (n) => `${numberIn(n, 'mr')} नोंदी — मंजूर करा`, // EXISTING words; Devanagari digits (L4b fix round 1, L-6)
    explanation: 'मंजुरी म्हणजे कामाच्या नोंदीची खात्री. पैसे दिल्याची नोंद वेगळी आहे.',
    empty: 'मंजुरीसाठी नोंदी बाकी नाहीत',
    listUnknown: 'यादी आत्ता दिसत नाही',
    listUnknownTitle: 'तपासायची यादी आत्ता आणता आली नाही',
    listUnknownHint: 'नेट आल्यावर पुन्हा उघडा.',
    close: 'बंद करा',
    approve: 'मंजूर',
    dispute: 'शंका',
    undo: 'मागे घ्या',
    approvedMark: 'मंजूर केलं',
    disputedMark: 'शंका नोंदवली',
    approvedMany: (n) => `${numberIn(n, 'mr')} नोंदी मंजूर केल्या`, // PROPOSED
    toastApproved: (onPhone) => `मंजूर केलं — ${onPhone}`,
    toastDisputed: (onPhone) => `शंका नोंदवली — ${onPhone}`,
    toastApprovedMany: (onPhone) => `निवडलेल्या नोंदी मंजूर केल्या — ${onPhone}`, // PROPOSED
    failedOne: 'मंजूर करता आलं नाही — पुन्हा प्रयत्न करा',
    failedDispute: 'शंका नोंदवता आली नाही — पुन्हा प्रयत्न करा',
    failedMany: (n) => `${numberIn(n, 'mr')} नोंदी मंजूर करता आल्या नाहीत — पुन्हा प्रयत्न करा`,
    peopleUnit: 'जण',
    unknownMark: '—',
    helpWhat: 'रोजच्या नोंदी इथे तुम्ही मंजूर करता — स्वतःच्या किंवा तुमच्या माणसांच्या.',
    helpAct: "बरोबर असेल तर 'मंजूर', काही चुकलं असेल तर 'शंका' — नंतर विचारता येतं.",
    helpWhy: 'चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो.',
    helpLabel: 'तपासणी म्हणजे काय?',
    select: 'निवडा', // PROPOSED
    selected: 'निवडली', // PROPOSED
    approveSelected: (n) => `निवडलेल्या ${numberIn(n, 'mr')} नोंदी मंजूर करा`, // PROPOSED
    confirmSelected: (n) => `${numberIn(n, 'mr')} नोंदी मंजूर करायच्या?`, // PROPOSED
    confirmYes: 'हो, मंजूर करा', // PROPOSED
    confirmNo: 'नाही', // PROPOSED
    lookAlone: 'हिचा तपशील अपूर्ण आहे — एक-एक पाहून मंजूर करा', // PROPOSED
    reasonPrompt: 'शंका कशाबद्दल आहे? बोलून किंवा लिहून सांगा.', // PROPOSED
    reasonPlaceholder: 'उदा. मजूर ५ नव्हते, ४ होते', // PROPOSED
    reasonSpeak: 'बोलून सांगा', // PROPOSED
    reasonListening: 'ऐकत आहे…', // PROPOSED
    reasonNoMic: 'बोलणं ऐकता आलं नाही — लिहून सांगा', // PROPOSED
    reasonSend: 'शंका नोंदवा', // PROPOSED
    cancel: 'रद्द करा', // PROPOSED
    changedTitle: 'ही नोंद बदलली आहे', // PROPOSED
    changedReason: 'तुम्ही पाहिल्यानंतर ही नोंद दुरुस्त झाली, म्हणून तुमची मंजुरी जुन्या नोंदीवर लागली नाही. नवीन नोंद खाली आहे — पाहून मंजूर करा.', // PROPOSED
    whatChanged: 'काय बदललं:', // PROPOSED
    factPeople: 'माणसं', // PROPOSED
    factWork: 'काम', // PROPOSED
    factPlot: 'प्लॉट', // PROPOSED
    factCost: 'खर्च', // PROPOSED
    approvalChip: (n) => `मंजुरीसाठी ${numberIn(n, 'mr')}`,
    unsentChip: (n) => `पाठवणे बाकी ${numberIn(n, 'mr')}`,
    jobCardPending: 'मंजुरी बाकी — पाहा', // PROPOSED
    listSending: 'तुमचे निर्णय या फोनवर आहेत — पाठवले जात आहेत', // PROPOSED
    heldApprovals: 'मंजुरीसाठी सदस्यता सुरू असावी लागते', // PROPOSED
    heldApprovalsOpen: 'सदस्यता पाहा', // PROPOSED
};

const EN: ApprovalWords = {
    title: 'Review', // PROPOSED
    countLine: (n) => `${n} records — approve`, // PROPOSED
    explanation: 'Approval confirms the work record. A record of payment is separate.', // PROPOSED
    empty: 'No records waiting for approval', // PROPOSED
    listUnknown: 'The list cannot be seen right now', // PROPOSED
    listUnknownTitle: 'Could not fetch the list to review', // PROPOSED
    listUnknownHint: 'Open it again when you have internet.', // PROPOSED
    close: 'Close', // PROPOSED
    approve: 'Approve', // PROPOSED
    dispute: 'Doubt', // PROPOSED
    undo: 'Undo', // PROPOSED
    approvedMark: 'Approved', // PROPOSED
    disputedMark: 'Doubt noted', // PROPOSED
    approvedMany: (n) => `${n} records approved`, // PROPOSED
    toastApproved: (onPhone) => `Approved — ${onPhone}`, // PROPOSED
    toastDisputed: (onPhone) => `Doubt noted — ${onPhone}`, // PROPOSED
    toastApprovedMany: (onPhone) => `Selected records approved — ${onPhone}`, // PROPOSED
    failedOne: 'Could not approve — try again', // PROPOSED
    failedDispute: 'Could not note the doubt — try again', // PROPOSED
    failedMany: (n) => `${n} records could not be approved — try again`, // PROPOSED
    peopleUnit: 'people', // PROPOSED
    unknownMark: '—',
    helpWhat: 'You approve daily records here — your own or your people’s.', // PROPOSED
    helpAct: "If it is right, 'Approve'; if something is wrong, 'Doubt' — it can be asked about later.", // PROPOSED
    helpWhy: 'Mistakes are caught early and the accounts stay right.', // PROPOSED
    helpLabel: 'What is review?', // PROPOSED
    select: 'Select', // PROPOSED
    selected: 'Selected', // PROPOSED
    approveSelected: (n) => `Approve ${n} selected records`, // PROPOSED
    confirmSelected: (n) => `Approve ${n} records?`, // PROPOSED
    confirmYes: 'Yes, approve', // PROPOSED
    confirmNo: 'No', // PROPOSED
    lookAlone: 'Details are incomplete — look at this one on its own', // PROPOSED
    reasonPrompt: 'What is the doubt about? Say it or write it.', // PROPOSED
    reasonPlaceholder: 'e.g. there were 4 workers, not 5', // PROPOSED
    reasonSpeak: 'Speak', // PROPOSED
    reasonListening: 'Listening…', // PROPOSED
    reasonNoMic: 'Could not hear it — please write it', // PROPOSED
    reasonSend: 'Note the doubt', // PROPOSED
    cancel: 'Cancel', // PROPOSED
    changedTitle: 'This record has changed', // PROPOSED
    changedReason: 'It was corrected after you saw it, so your approval was not applied to the old version. The new version is below — look and approve.', // PROPOSED
    whatChanged: 'What changed:', // PROPOSED
    factPeople: 'People', // PROPOSED
    factWork: 'Work', // PROPOSED
    factPlot: 'Plot', // PROPOSED
    factCost: 'Cost', // PROPOSED
    approvalChip: (n) => `For approval ${n}`, // PROPOSED
    unsentChip: (n) => `Not sent yet ${n}`, // PROPOSED
    jobCardPending: 'Approval pending — look', // PROPOSED
    listSending: 'Your decisions are on this phone — being sent', // PROPOSED
    heldApprovals: 'Approvals need an active subscription', // PROPOSED
    heldApprovalsOpen: 'See subscription', // PROPOSED
};

export function approvalWords(language: Language | null | undefined): ApprovalWords {
    return language === 'en' ? EN : MR;
}
