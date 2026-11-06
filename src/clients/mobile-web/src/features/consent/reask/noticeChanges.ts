// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 1: H4).
//
// What the one-time notice sheet shows as "the main changes" is taken from the version it ASKS FOR, not from a fixed pair:
// each MATERIAL version has its own line(s), and a farmer is shown every line of every version AFTER the one he last
// accepted. Without this the sheet showed the D-36 and D-71 lines to someone who had already accepted them and left out the one
// material change (D-50) he was being asked about, so the ledger would have recorded his acceptance of a change he never saw.
//
// Versions compare as strings: they are `notice-YYYY-MM-DD.n`, which sorts by date then number.
//
// When a new MATERIAL notice version ships, add its line here (and nowhere else).
import { CONSENT_NOTICE, type NoticeLanguage } from '../gate/consentNotice';
import { OFF_CONSEQUENCE_EN, OFF_CONSEQUENCE_MR, PROOF_KEPT_EN, PROOF_KEPT_MR } from '../../../i18n/voiceSwitchWords';

export interface NoticeChangeLine {
    /** The notice version that introduced this change: a farmer who accepted an OLDER version has not seen it. */
    since: string;
    /** Stable id for tests. */
    id: 'improvement' | 'erasure' | 'proof';
    text: (language: NoticeLanguage) => string;
}

export const NOTICE_CHANGE_LINES: readonly NoticeChangeLine[] = [
    // D-36: the voice promise became "not without your separate permission" (the notice's own sentence).
    { since: 'notice-2026-10-30.1', id: 'improvement', text: (l) => CONSENT_NOTICE[l].willNotDo.items[2] },
    // D-71: the 30-day erasure wait and the cancel (the notice's own sentence).
    { since: 'notice-2026-11-02.2', id: 'erasure', text: (l) => CONSENT_NOTICE[l].rights.items[2] },
    // D-50 (CTO call D-101), PROPOSED words: the founder's own sentence, then the one consequence of turning the switch off.
    {
        since: 'notice-2026-11-06.1',
        id: 'proof',
        text: (l) => (l === 'en' ? `${PROOF_KEPT_EN} ${OFF_CONSEQUENCE_EN}` : `${PROOF_KEPT_MR} ${OFF_CONSEQUENCE_MR}`),
    },
];

/**
 * The lines to show a farmer whose last accepted notice was `acceptedVersion` (null or unknown: all of them). A line is shown
 * when its version is NEWER than the one he accepted.
 */
export function changesSince(acceptedVersion: string | null | undefined): NoticeChangeLine[] {
    if (typeof acceptedVersion !== 'string' || acceptedVersion.length === 0) return [...NOTICE_CHANGE_LINES];
    return NOTICE_CHANGE_LINES.filter((line) => line.since > acceptedVersion);
}
