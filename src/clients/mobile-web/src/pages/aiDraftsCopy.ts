/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, PLR-D9 T1-T3) — everything the offline-notes
 * page says to the farmer, in plain Marathi only. It used to be English ("AI Drafts", "Review",
 * "All caught up!", "Discard this voice note?…"). The honesty rules the 2026-08-14 fix rounds pinned on
 * the English lines carry over unchanged (see AiDraftsPage.test.tsx).
 *
 * The page lists every unreviewed offline AI result: voice notes AND bill / sale-slip photos. So its name
 * says "made without internet", not "voice notes" (a waiting bill photo was counted as a voice note), and
 * it avoids "तपासायच्या", which the redesign uses for the owner approving other people's logs.
 *
 * Every Marathi line here is new wording → PROPOSED (Marathi), except the approved phone claim
 * (`onPhoneClaim`, "लक्षात ठेवलं ✓") and "शेतनोंदीत" (the approved sync.notFiledBadgeTail word).
 */
import type { UnreviewedAiResult } from '../infrastructure/sync/PendingAiResultsReader';
import { getDateKey } from '../core/domain/services/DateKeyService';
import { formatFarmerTime } from '../shared/utils/displayTime';
import { onPhoneClaim } from '../app/helpers/saveToastMessages';
import { OFFLINE_NOTES_TITLE } from '../features/profile/settingsItems';

/** The page and its setup-hub row share this one name (PROPOSED Marathi, defined with the row). */
export const DRAFTS_TITLE = OFFLINE_NOTES_TITLE;
// PROPOSED (Marathi)
export const DRAFTS_LINE = 'प्रत्येक नोंद उघडून जतन करा, किंवा काढून टाका.';
// PROPOSED (Marathi)
export const DRAFTS_LOADING = 'उघडत आहे…';
// PROPOSED (Marathi)
export const DRAFTS_EMPTY_TITLE = 'सगळ्या नोंदी पाहून झाल्या';
// PROPOSED (Marathi)
export const DRAFTS_EMPTY_LINE = 'नेट नसताना केलेली एकही नोंद बाकी नाही.';
// PROPOSED (Marathi): "open" — the note opens in the same form he saves a log with.
export const DRAFTS_OPEN = 'उघडा';
// existing Marathi (the not-synced page's button)
export const DRAFTS_DISCARD = 'काढून टाका';
// PROPOSED (Marathi): a bill / sale-slip photo cannot be opened here; say so, and that it is kept.
export const DRAFTS_NOT_OPENABLE = 'हा फोटो इथे अजून उघडता येत नाही. काढून टाका, किंवा इथेच राहू द्या.';
// PROPOSED (Marathi)
export const DRAFTS_CANNOT_OPEN = 'ही नोंद इथे उघडता येत नाही.';
// PROPOSED (Marathi): nothing was written, so asking him to try again is honest.
export const DRAFTS_NOT_SAVED = 'ही नोंद जतन झाली नाही. पुन्हा प्रयत्न करा.';

/**
 * The 'saved_with_warning' sentence (round 4, N1): the phone claim FIRST, then that a step after the save
 * failed, then the present-perfect fact that it has not reached the farm records. No promise of a later
 * send, no blame on the internet, no request to save again (the record exists).
 */
// PROPOSED (Marathi): the tail after the approved phone claim.
export const savedWithWarningMessage = (): string =>
    `${onPhoneClaim('mr')} — जतन झाल्यानंतरची एक पायरी चुकली; ही नोंद शेतनोंदीत पोचलेली नाही.`;

type Kind = 'voice' | 'bill' | 'slip';

const kindOf = (job: UnreviewedAiResult): Kind => {
    if (job.operationType === 'receipt_extract') return 'bill';
    if (job.operationType === 'patti_extract') return 'slip';
    return 'voice';
};

// PROPOSED (Marathi): "बिलाचा फोटो" is the founder's own word (PLR-D9 §6, खरेदी); the others follow it.
const KIND_LABEL: Record<Kind, string> = { voice: 'आवाज नोंद', bill: 'बिलाचा फोटो', slip: 'पट्टीचा फोटो' };

/** The confirm before a discard — the right noun and gender for what is being thrown away. */
// PROPOSED (Marathi)
export function discardConfirmMessage(job: UnreviewedAiResult): string {
    const kind = kindOf(job);
    return kind === 'voice'
        ? `ही ${KIND_LABEL.voice} काढून टाकायची? ती शेतनोंदीत जाणार नाही.`
        : `हा ${KIND_LABEL[kind]} काढून टाकायचा? तो शेतनोंदीत जाणार नाही.`;
}

/** The row's line: what he said (summary or transcript) for a voice note, else what kind of thing it is. */
export function previewLabel(job: UnreviewedAiResult): string {
    const kind = kindOf(job);
    if (kind !== 'voice') return KIND_LABEL[kind];
    const payload = job.result.payload as { parsedLog?: Record<string, unknown> } | undefined;
    const parsedLog = payload?.parsedLog;
    const summary = parsedLog && typeof parsedLog.summary === 'string' ? parsedLog.summary : undefined;
    const transcript = parsedLog && typeof parsedLog.fullTranscript === 'string' ? parsedLog.fullTranscript : undefined;
    return summary || transcript || job.context.textTranscript || KIND_LABEL.voice;
}

/** Marathi month names with ordinary digits (the money pages' own tag); date parts only. */
const MR_DAY = new Intl.DateTimeFormat('mr-IN-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * When the note was made, as the farmer reads it: "13 ऑग, रात्री 8:30" — the farm's (IST) day and the
 * part-of-day clock, not "13 Aug, 8:30 PM". Same instant the review screen dates the log from
 * (`resolveRecordedInstant`). Nothing is invented for an unreadable value: it reads "—" (P4).
 */
export function formatRecordedAt(iso: string): string {
    const time = formatFarmerTime(iso);
    if (!time) return '—';
    // A zone-less literal is a wall clock (displayTime renders it as written): its day is as written too.
    const dayKey = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim()) ? getDateKey(iso) : iso.trim().slice(0, 10);
    const [y, m, d] = dayKey.split('-').map(Number);
    return `${MR_DAY.format(new Date(Date.UTC(y, m - 1, d)))}, ${time}`;
}
