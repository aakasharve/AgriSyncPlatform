/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1b (founder Q5, 27 Nov; CTO ruling 3). Does
 * this saved screen offer the setup hub ("तुमच्या शेताची माहिती पूर्ण करा…")? Only:
 *   - on a phone that went through the first-record card (its row exists, R1-g 1a). A phone with no row passed the first run
 *     before the card existed and sees the screen exactly as today (P11);
 *   - for an owner or co-owner seat (the line speaks to the farm owner);
 *   - for the farm's FIRST record on this phone (`firstRecordVerdict`), ONCE: a per-farm mark holds the first record's
 *     recording key while its screen shows the offer, and "done" once it was answered or a later record was seen.
 * Read-only about the records: nothing about when or how a record is saved changes here.
 */
import { useEffect, useRef } from 'react';
import type { DailyLog } from '../../../../types';
import { useUiPref } from '../../../../shared/hooks/useUiPref';
import {
    FIRST_RECORD_CARD_KEY, FIRST_RECORD_OFFER_DONE, FIRST_RECORD_SAVED, firstRecordOfferKey, firstRecordVerdict, mayOfferFirstRecord,
} from '../../../onboarding/firstRun/firstRecord';

export interface FirstRecordOfferInput {
    farmId: string | null;
    farmRole: string | null | undefined;
    /** The recording on screen (`VoiceResultState.key`). */
    recordingKey: string;
    logIds: readonly string[];
    history: readonly DailyLog[];
    /** False = the screen has no setup-hub door to offer: nothing is read as an answer and nothing is written. */
    enabled: boolean;
}

export interface FirstRecordOffer {
    show: boolean;
    /** Answered ("शेताची माहिती भरा" or "नंतर"): never shown again on this farm. */
    close: () => void;
}

export function useFirstRecordOffer({ farmId, farmRole, recordingKey, logIds, history, enabled }: FirstRecordOfferInput): FirstRecordOffer {
    // `null` = no row: the phone never went through the first-record card.
    const [cardRow, , cardLoaded] = useUiPref<boolean | null>(FIRST_RECORD_CARD_KEY, null);
    const [mark, setMark, markLoaded] = useUiPref<string>(firstRecordOfferKey(farmId), '');
    const eligible = enabled && !!farmId && cardLoaded && cardRow !== null && mayOfferFirstRecord(farmRole) && markLoaded;
    // R1-g 1d — "saved" (the first record was saved on his "बरोबर") is still undecided here: the line follows that record.
    const undecided = mark === '' || mark === FIRST_RECORD_SAVED;
    const verdict = eligible && undecided ? firstRecordVerdict(logIds, history, farmId) : 'unknown';
    const decided = verdict === 'first' ? recordingKey : verdict === 'notFirst' ? FIRST_RECORD_OFFER_DONE : null;
    // An answer can come before React has run the effect of the render that drew the offer (a tap in the same frame). That
    // effect still holds "mark this recording" and would land AFTER "done", bringing the offer back: the answer is kept here,
    // for this farm and recording, and the late effect writes nothing.
    const answeredFor = useRef<string | null>(null);
    const answerId = `${farmId ?? ''}|${recordingKey}`;
    useEffect(() => {
        if (decided !== null && answeredFor.current !== answerId) setMark(decided);
    }, [decided, answerId, setMark]);
    const answered = answeredFor.current === answerId;
    return {
        show: eligible && !answered && (mark === recordingKey || decided === recordingKey),
        close: () => { answeredFor.current = answerId; setMark(FIRST_RECORD_OFFER_DONE); },
    };
}
