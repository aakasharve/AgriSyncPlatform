/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b — carried from the L6 review; founder rule "names follow the language STRICTLY") — the
 * sync sheet's words, one language at a time. In Marathi it never shows the server's English `lastError`: a refused
 * row is explained by its error CODE (`reasonForCode`), and a code this phone does not know gets a plain Marathi
 * sentence. The English twins are the sheet's existing words. Every Marathi line is PROPOSED (wording review),
 * except "पाठवणे बाकी" (founder D-40) and "पुन्हा पाठवा" (already the app's retry word).
 */
import type { Language } from '../../../i18n/language';
import { numberIn } from '../../approval/approvalWords';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface SyncDrawerWords {
    title: string;
    close: string;
    online: string;
    offline: string;
    waiting: (n: number) => string;
    changes: (n: number) => string;
    uploads: (n: number) => string;
    needYou: (n: number) => string;
    canBeSent: (n: number) => string;
    canBeSentAndNeedYou: (sendable: number, needYou: number) => string;
    retryAll: string;
    retrying: string;
    refusedHint: string;
    review: string;
    retry: string;
    sending: string;
    showFewer: string;
    more: (n: number) => string;
    photosStopped: (n: number) => string;
    uploading: (n: number) => string;
    uploadFailed: (n: number) => string;
    recordingsPending: (n: number) => string;
    recordingsProcessing: (n: number) => string;
    unqueueable: (n: number) => string;
    unqueueableHint: (n: number) => string;
    allSynced: string;
    lastSynced: string;
    applied: (n: number) => string;
    syncNow: string;
    syncing: string;
    never: string;
    justNow: string;
    secondsAgo: (n: number) => string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    unknownError: string;
    /** lane L4b fix round 1 (L-5) — a row with no refusal code only failed to SEND: never "refused". */
    sendFailed: string;
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

const EN: SyncDrawerWords = {
    title: 'Sync Status',
    close: 'Close',
    online: 'Connected',
    offline: 'Offline — changes saved locally',
    waiting: (n) => `${n} ${plural(n, 'record', 'records')} not sent yet`,
    changes: (n) => `${n} changes`,
    uploads: (n) => `${n} uploads`,
    needYou: (n) => `${n} need you`,
    canBeSent: (n) => `${n} can be sent again`,
    canBeSentAndNeedYou: (s, n) => `${s} can be sent · ${n} need you`,
    retryAll: 'Retry All',
    retrying: 'Retrying...',
    refusedHint: 'The server would not accept this. Open it to fix, resend or discard.',
    review: 'Review',
    retry: 'Retry',
    sending: 'Sending...',
    showFewer: 'Show fewer',
    more: (n) => `+${n} more`,
    photosStopped: (n) => `${n} photo ${plural(n, 'upload', 'uploads')} also stopped. "Retry All" sends ${plural(n, 'it', 'them')} again.`,
    uploading: (n) => `${n} uploading`,
    uploadFailed: (n) => `${n} failed`,
    recordingsPending: (n) => `${n} voice ${plural(n, 'recording', 'recordings')} pending`,
    recordingsProcessing: (n) => `${n} voice ${plural(n, 'recording', 'recordings')} processing`,
    unqueueable: (n) => `${n} ${plural(n, 'record', 'records')} will not reach your farm records`,
    unqueueableHint: (n) => `Saved on this phone. Nothing will send ${plural(n, 'it', 'them')}.`,
    allSynced: 'All synced',
    lastSynced: 'Last synced:',
    applied: (n) => `${n} applied`,
    syncNow: 'Sync Now',
    syncing: 'Syncing...',
    never: 'Never',
    justNow: 'Just now',
    secondsAgo: (n) => `${n}s ago`,
    minutesAgo: (n) => `${n}m ago`,
    hoursAgo: (n) => `${n}h ago`,
    unknownError: 'Unknown error',
    sendFailed: 'Could not send — it goes again when you have internet', // PROPOSED
};

const m = (n: number) => numberIn(n, 'mr');

const MR: SyncDrawerWords = {
    title: 'पाठवण्याची स्थिती', // PROPOSED
    close: 'बंद करा',
    online: 'नेट चालू आहे', // PROPOSED
    offline: 'नेट नाही — बदल या फोनवर जतन आहेत', // PROPOSED
    waiting: (n) => `पाठवणे बाकी ${m(n)}`, // founder D-40
    changes: (n) => `${m(n)} बदल`, // PROPOSED
    uploads: (n) => `${m(n)} फोटो`, // PROPOSED
    needYou: (n) => `${m(n)} तुम्ही पाहायचे`, // PROPOSED
    canBeSent: (n) => `${m(n)} पुन्हा पाठवता येतील`, // PROPOSED
    canBeSentAndNeedYou: (s, n) => `${m(s)} पाठवता येतील · ${m(n)} तुम्ही पाहायचे`, // PROPOSED
    retryAll: 'पुन्हा पाठवा',
    retrying: 'पाठवत आहे…', // PROPOSED
    refusedHint: 'श्रमसफलने हे स्वीकारलं नाही. उघडून दुरुस्त करा, पुन्हा पाठवा किंवा काढून टाका.', // PROPOSED (brand as the founder writes it, D-36)
    review: 'उघडा', // PROPOSED
    retry: 'पुन्हा पाठवा',
    sending: 'पाठवत आहे…', // PROPOSED
    showFewer: 'कमी दाखवा', // PROPOSED
    more: (n) => `आणखी ${m(n)}`, // PROPOSED
    photosStopped: (n) => `${m(n)} फोटो पाठवणंही थांबलं आहे. "पुन्हा पाठवा" ने ते परत जातील.`, // PROPOSED
    uploading: (n) => `${m(n)} फोटो जात आहेत`, // PROPOSED
    uploadFailed: (n) => `${m(n)} फोटो गेले नाहीत`, // PROPOSED
    recordingsPending: (n) => `${m(n)} आवाज नोंदी पाठवणे बाकी`, // PROPOSED
    recordingsProcessing: (n) => `${m(n)} आवाज नोंदी समजून घेत आहे`, // PROPOSED
    unqueueable: (n) => `${m(n)} नोंदी शेतनोंदीत पोहोचणार नाहीत`, // PROPOSED
    unqueueableHint: () => 'या फोनवर जतन आहेत. त्या कोणीही पाठवणार नाही.', // PROPOSED
    allSynced: 'सगळं पाठवलं', // PROPOSED
    lastSynced: 'शेवटचं पाठवलं:', // PROPOSED
    applied: (n) => `${m(n)} पोहोचले`, // PROPOSED
    syncNow: 'आत्ता पाठवा', // PROPOSED
    syncing: 'पाठवत आहे…', // PROPOSED
    never: 'अजून नाही', // PROPOSED
    justNow: 'आत्ताच', // PROPOSED
    secondsAgo: (n) => `${m(n)} सेकंदांपूर्वी`, // PROPOSED
    minutesAgo: (n) => `${m(n)} मिनिटांपूर्वी`, // PROPOSED
    hoursAgo: (n) => `${m(n)} तासांपूर्वी`, // PROPOSED
    unknownError: 'श्रमसफलने हे स्वीकारलं नाही', // PROPOSED (brand as the founder writes it, D-36)
    sendFailed: 'पाठवता आलं नाही — नेट आल्यावर पुन्हा पाठवा', // PROPOSED
};

export function syncDrawerWords(language: Language | null | undefined): SyncDrawerWords {
    return language === 'en' ? EN : MR;
}

/** What a queue row IS, in his words (never the wire name `verify_log_v2`). */
const MUTATION_LABEL: Record<string, { mr: string; en: string }> = {
    [SyncMutationName.CreateDailyLog]: { mr: 'कामाची नोंद', en: 'Work record' },
    [SyncMutationName.AddLogTask]: { mr: 'नोंदीत जोडलेलं काम', en: 'Work added to a record' },
    [SyncMutationName.ReviseLogContent]: { mr: 'नोंदीतील दुरुस्ती', en: 'Record correction' },
    [SyncMutationName.MoveDailyLog]: { mr: 'नोंदीचा दिवस / प्लॉट बदल', en: 'Record moved' },
    [SyncMutationName.VerifyLog]: { mr: 'मंजुरी', en: 'Approval' },
    [SyncMutationName.VerifyLogV2]: { mr: 'मंजुरी', en: 'Approval' },
    [SyncMutationName.AddCostEntry]: { mr: 'खर्च', en: 'Expense' },
    // lane BILL-1 (founder D-12) — a bill's मंजूर stamp; its "this bill changed" refusal reads the L4b line above. PROPOSED.
    [SyncMutationName.ApproveCostEntry]: { mr: 'बिलाची मंजुरी', en: 'Bill approval' },
    [SyncMutationName.AttendanceMark]: { mr: 'हजेरी', en: 'Attendance' },
    [SyncMutationName.CorrectLabourAssignment]: { mr: 'मजुरांची दुरुस्ती', en: 'Labour correction' },
    [SyncMutationName.CreateAttachment]: { mr: 'फोटो', en: 'Photo' },
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 fix 1, F7) - his हो / नाही / फोटो answer about a product. PROPOSED.
    [SyncMutationName.AssertInputIdentity]: { mr: 'औषधाबद्दलचं उत्तर', en: 'Answer about a product' },
};

export function mutationLabel(mutationType: string, language: Language | null | undefined): string {
    const label = MUTATION_LABEL[mutationType];
    if (label) return language === 'en' ? label.en : label.mr;
    return language === 'en' ? mutationType : 'नोंद'; // PROPOSED (mr)
}

/** The reason a row was refused, by the server's error CODE. PROPOSED (both languages). */
const REASON_BY_CODE: Record<string, { mr: string; en: string }> = {
    'ShramSafal.LogVersion.Conflict': {
        mr: 'ही नोंद बदलली आहे — नवीन नोंद पाहून मंजूर करा',
        en: 'This record changed — look at the new version and approve it',
    },
    // lane BILL-1b (founder D-105 (b)) — a price change on an APPROVED bill from anyone but the main owner. The same words as
    // `billApprovalWords.priceLocked` (a test holds the two together). PROPOSED.
    'ShramSafal.BillPrice.Conflict': {
        mr: 'बिल मंजूर झाल्यावर त्याची किंमत फक्त मुख्य मालक बदलू शकतात — तुमचा बदल घेतला गेला नाही',
        en: 'Once a bill is approved only the main owner can change its price — your change was not taken',
    },
    'ShramSafal.Forbidden': { mr: 'हे करण्याची परवानगी तुम्हाला नाही', en: 'You do not have permission for this' },
    // lane L4b fix round 1 — the server's code is `ShramSafal.RecordAudience.Forbidden` (`RecordAudienceClosed` is its
    // C# name); the old key never matched.
    'ShramSafal.RecordAudience.Forbidden': { mr: 'ही नोंद तुम्हाला दाखवली जात नाही', en: 'This record is not shown to you' },
    'ShramSafal.InvalidVerificationReason': { mr: 'शंकेचं कारण सांगावं लागतं', en: 'A doubt needs a reason' },
    'ShramSafal.VerificationTransitionNotAllowedForRole': { mr: 'या नोंदीवर आता हे करता येत नाही', en: 'This cannot be done on this record now' },
    'ShramSafal.DailyLogNotFound': { mr: 'ही नोंद सापडली नाही', en: 'This record was not found' },
    'ShramSafal.SyncInvalidPayload': { mr: 'ही नोंद ॲपच्या जुन्या रूपात आहे — ॲप अपडेट करा', en: 'This record is in an old app format — update the app' },
};

/**
 * The row's reason in his language. Marathi: by code, or a plain sentence — NEVER the server's English text.
 * English: by code, else the server's own (English) message, else "Unknown error".
 * Lane L4b fix round 1 (L-5): a row that carries NO code was never refused by the server — it only failed to send (no
 * network, a timeout, past the retry cap) — so it gets the send-failure line in both languages, never "refused".
 */
export function reasonForRow(row: { errorCode?: string; lastError?: string }, language: Language | null | undefined): string {
    if (!row.errorCode) return language === 'en' ? EN.sendFailed : MR.sendFailed;
    const known = REASON_BY_CODE[row.errorCode];
    if (language === 'en') return known?.en ?? (row.lastError || EN.unknownError);
    return known?.mr ?? MR.unknownError;
}
