// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25; replaced by the permissions page in
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02).
//
// The consent step every phone-number screen shares: login (OTP and password), the QR join page and the joining
// flow's own number screen. Until 27 Nov it was one tick beside the number; it is now the ONE long permissions and
// privacy page (`features/consent/permissionsPage/PermissionsPage.tsx`), opened when he taps send.
//
// THE ORDER IS STILL THE WHOLE POINT. `recordIfNeeded()` is awaited BEFORE the phone number leaves the device. It opens
// the page and settles only after his DELIBERATE tap at the end ("मी वाचलं, पुढे चला") and after the two legal records
// landed. If they cannot be written it rejects, the caller does not send, and the farmer stays on his number. "नको"
// rejects with `PermissionsDeclinedError`: nothing was sent, nothing was saved, and the screen says nothing.
//
// CONSENT BELONGS TO THE PERSON LOGGING IN, NOT TO THE PHONE (founder): the page opens on every visit to a
// phone-number screen, even on a phone that accepted before. Logins are rare (a session lasts until logout).
//
// ONE ACCEPTANCE, ONE SESSION ID; ONE TAP, ONE RECORD; THE DEVICE MARK ON DISK BEFORE THE NUMBER IS SENT (bounded to
// 2 s); AN ACCEPTANCE BELONGS TO THE NUMBER IT WAS GIVEN FOR - all exactly as the tick had them. A second tap on send
// while the page is open gets the same pending promise.
//
// THE TWO SWITCHES are held on the phone with the acceptance (`HeldSwitchChoicesStore`) and written after sign-in,
// each to its own record and never over an earlier choice (`permissionsPage/heldSwitchChoices.ts`). They are not part
// of the two records written here.

import { useRef, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { recordConsentGateAcceptance } from './consentGateApi';
import { rememberConsentGateAcceptanceForLinking } from './consentGateLinkReconciler';
import { mintPreRegistrationSessionId } from './consentAcceptance';
import { markCoreConsentOnThisDevice } from '../separation/coreConsentGate';
import { PAGE_NOTICE_VERSION, type NoticeLanguage } from './consentNotice';
import { buildPermissionsPageAcceptance } from '../permissionsPage/permissionsPageNotice';
import type { SwitchChoices } from '../permissionsPage/PermissionsPage';
import { saveHeldSwitchChoices } from '../../../infrastructure/storage/HeldSwitchChoicesStore';

/** He tapped "नको" on the permissions page: nothing was sent or saved. Not a failure to report. */
export class PermissionsDeclinedError extends Error {
    constructor() {
        super('The permissions page was declined; nothing was sent or saved.');
        this.name = 'PermissionsDeclinedError';
    }
}

export const isPermissionsDeclined = (error: unknown): boolean =>
    error instanceof PermissionsDeclinedError
    || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'PermissionsDeclinedError');

export interface ConsentBeforeOtp {
    /** `required` until an acceptance is recorded for the number on screen, then `passed`. */
    status: 'required' | 'passed';
    /** True while the acceptance is being written - the page's button and the send are held. */
    recording: boolean;
    /** True when the send may be tapped (the page opens from it). False only while an acceptance is being written. */
    canSend: boolean;
    /** The language the page is displayed in - what the record will say he read. */
    language: NoticeLanguage;
    /** The page is on screen. */
    pageOpen: boolean;
    /**
     * Opens the page unless this number already accepted on this visit. Resolves once his deliberate tap's two records
     * landed; rejects with `PermissionsDeclinedError` on "नको", or with the write's error when they did not land.
     */
    recordIfNeeded: () => Promise<void>;
    /** The page's green button. */
    accept: (choices: SwitchChoices) => void;
    /** The page's "नको" (and the phone's Back on the page). */
    decline: () => void;
    /** The page's मराठी / English switch: the app's language, so the whole screen follows it. */
    setLanguage: (language: NoticeLanguage) => void;
}

const toNoticeLanguage = (lang: string): NoticeLanguage => (lang === 'mr' ? 'mr' : 'en');

const MARK_WRITE_LIMIT_MS = 2000;
const normalizePhone = (phone: string): string => phone.replace(/\D+/g, '');

interface PendingAsk {
    number: string;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

/** `phone` is the number on screen; an acceptance counts only for the number it was given for. */
export function useConsentBeforeOtp(phone = ''): ConsentBeforeOtp {
    const { language, setLanguage } = useLanguage();
    const [pageOpen, setPageOpen] = useState(false);
    const [recordedFor, setRecordedFor] = useState<string | null>(null);
    const [recording, setRecording] = useState(false);
    const pending = useRef<PendingAsk | null>(null);
    const writing = useRef(false);

    const displayed = toNoticeLanguage(language);
    const number = normalizePhone(phone);
    const passed = recordedFor !== null && recordedFor === number;

    const settle = (outcome: { ok: true } | { ok: false; error: unknown }) => {
        const ask = pending.current;
        pending.current = null;
        setPageOpen(false);
        if (!ask) return;
        if (outcome.ok) ask.resolve();
        else ask.reject(outcome.error);
    };

    const recordIfNeeded = (): Promise<void> => {
        if (passed) return Promise.resolve();
        if (pending.current) return pending.current.promise;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
        pending.current = { number, promise, resolve, reject };
        setPageOpen(true);
        return promise;
    };

    const accept = (choices: SwitchChoices) => {
        const ask = pending.current;
        if (!ask || writing.current) return;
        writing.current = true;
        setRecording(true);
        const acceptance = buildPermissionsPageAcceptance(displayed);
        const sessionId = mintPreRegistrationSessionId();
        void (async () => {
            try {
                await recordConsentGateAcceptance(acceptance, sessionId);
                // After the accepting write, never before (a payload kept for an acceptance that never landed would later
                // assert a consent that does not exist). Not awaited - a wedged IndexedDB must not hold him here.
                void rememberConsentGateAcceptanceForLinking(acceptance, sessionId);
                void saveHeldSwitchChoices({ ...choices, language: displayed, preRegistrationSessionId: sessionId });
                await Promise.race([
                    markCoreConsentOnThisDevice(PAGE_NOTICE_VERSION),
                    new Promise<void>((resolve) => setTimeout(resolve, MARK_WRITE_LIMIT_MS)),
                ]);
                setRecordedFor(ask.number);
                settle({ ok: true });
            } catch (error) {
                settle({ ok: false, error });
            } finally {
                writing.current = false;
                setRecording(false);
            }
        })();
    };

    const decline = () => {
        if (writing.current) return;
        settle({ ok: false, error: new PermissionsDeclinedError() });
    };

    return {
        status: passed ? 'passed' : 'required',
        recording,
        canSend: !recording,
        language: displayed,
        pageOpen,
        recordIfNeeded,
        accept,
        decline,
        setLanguage: (next: NoticeLanguage) => setLanguage(next),
    };
}
