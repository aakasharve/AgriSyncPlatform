// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// The consent step every phone-number screen shares: login (OTP and password) and the QR
// join page. Before this, consent was a full-screen gate in front of LoginPage only, and a
// QR deep link skipped it entirely — the join page sent the phone number with no consent
// anywhere (defect X1).
//
// THE ORDER IS THE WHOLE POINT. `recordIfNeeded()` is awaited BEFORE the phone number
// leaves the device. If the two legal records cannot be written, it throws, the caller
// does not send, and the farmer stays where he is with the tick still ticked. The one
// outcome consent exists to prevent is the app holding his data with no record of the
// basis for holding it.
//
// CONSENT BELONGS TO THE PERSON LOGGING IN, NOT TO THE PHONE (founder: "tick mark while
// logging in"). The tick is shown on every visit to a phone-number screen, even on a phone
// that accepted before: shared phones are normal here, and a device-level "already
// accepted" let a second person through with no consent and no age declaration of his
// own. Logins are rare (a session lasts until logout), so the cost is one tap.
//
// ONE ACCEPTANCE, ONE SESSION ID. Each acceptance carries a freshly minted
// pre-registration session id. The server links an acceptance to an account by
// (account, session id); re-using the phone's one stored id made a second acceptance on
// the same phone look "already linked" and stay attached to nobody.
//
// ONE TAP, ONE RECORD. A second tap while the first acceptance is still being written
// gets the same in-flight promise — never a second pair of rows in an append-only ledger.

import { useRef, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { recordConsentGateAcceptance } from './consentGateApi';
import { rememberConsentGateAcceptanceForLinking } from './consentGateLinkReconciler';
import { buildConsentAcceptance } from './consentAcceptance';
import { mintPreRegistrationSessionId, useConsentGate, type GateStatus } from './useConsentGate';
import type { NoticeLanguage } from './consentNotice';

export interface ConsentBeforeOtp {
    /** `required` until an acceptance is recorded on this screen visit, then `passed`. */
    status: GateStatus;
    ticked: boolean;
    setTicked: (ticked: boolean) => void;
    /** True while the acceptance is being written — the tick and the send are held. */
    recording: boolean;
    /** True when the phone number may be sent. Never true for an unticked, unrecorded visit. */
    canSend: boolean;
    /** The language the notice is displayed in — what the record will say he read. */
    language: NoticeLanguage;
    noticeOpen: boolean;
    setNoticeOpen: (open: boolean) => void;
    /**
     * Writes both legal records unless this visit already did. Resolves only once they
     * landed; throws (and marks nothing) when they did not, or when the box is not ticked.
     */
    recordIfNeeded: () => Promise<void>;
}

const toNoticeLanguage = (lang: string): NoticeLanguage => (lang === 'mr' ? 'mr' : 'en');

export function useConsentBeforeOtp(): ConsentBeforeOtp {
    // Kept for its device mark only: the voice-clip store reads it (coreConsentGate.ts).
    const gate = useConsentGate();
    const { language } = useLanguage();
    const [ticked, setTicked] = useState(false);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [recorded, setRecorded] = useState(false);
    const [recording, setRecording] = useState(false);
    const inFlight = useRef<Promise<void> | null>(null);

    const displayed = toNoticeLanguage(language);

    const recordIfNeeded = (): Promise<void> => {
        if (recorded) return Promise.resolve();
        if (inFlight.current) return inFlight.current;
        if (!ticked) return Promise.reject(new Error('consent not given'));

        const acceptance = buildConsentAcceptance(displayed);
        const sessionId = mintPreRegistrationSessionId();
        setRecording(true);
        const attempt = (async () => {
            try {
                await recordConsentGateAcceptance(acceptance, sessionId);
                // After the accepting write, never before: a payload kept for an acceptance
                // that never landed would later produce a linking row asserting a consent
                // that does not exist. Not awaited — a wedged IndexedDB must not hold him here.
                void rememberConsentGateAcceptanceForLinking(acceptance, sessionId);
                gate.markPassed();
                setRecorded(true);
            } finally {
                inFlight.current = null;
                setRecording(false);
            }
        })();
        inFlight.current = attempt;
        return attempt;
    };

    return {
        status: recorded ? 'passed' : 'required',
        ticked,
        setTicked,
        recording,
        canSend: recorded || (ticked && !recording),
        language: displayed,
        noticeOpen,
        setNoticeOpen,
        recordIfNeeded,
    };
}
