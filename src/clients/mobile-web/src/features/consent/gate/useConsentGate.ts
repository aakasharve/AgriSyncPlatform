// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// Whether the first-open gate still has to be shown, and what to do when it is passed.
//
// Two things it deliberately gets right:
//
//   1. It never shows the gate on a "don't know yet". `useUiPref` returns its fallback
//      until the Dexie read settles, so "not loaded" and "never accepted" are the same
//      value — showing the gate on that would flash a full-screen legal notice at every
//      cold start of an accepted farmer. The hook reports `undecided` until the read
//      settles and the caller renders nothing new in that window.
//
//   2. It mints a PRE-REGISTRATION SESSION ID. The gate runs before login, so there is
//      no user id to attach the two legal records to (wave-4.2). Without a stable id the
//      records could never be tied to the account the farmer creates minutes later, and
//      an untied consent record is not a consent record. Minted once, kept.

import { useCallback, useEffect } from 'react';
import { useUiPref } from '../../../shared/hooks/useUiPref';
import { NOTICE_VERSION } from './consentNotice';

/** Bumped alongside NOTICE_VERSION: a materially new notice must be shown again. */
const ACCEPTED_NOTICE_PREF = 'shramsafal_consent_gate_accepted_notice';
const PREREG_SESSION_PREF = 'shramsafal_preregistration_session_id';

export type GateStatus = 'undecided' | 'required' | 'passed';

function mintSessionId(): string {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // Non-secure fallback for environments without randomUUID. Only ever an id — never
    // a secret, never an authorisation.
    return `preauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ConsentGateState {
    status: GateStatus;
    /** Stable id for the pre-login session; minted on first read. */
    preRegistrationSessionId: string;
    /** Call after BOTH legal records are safely written. */
    markPassed: () => void;
}

export function useConsentGate(): ConsentGateState {
    const [acceptedNotice, setAcceptedNotice, acceptedLoaded] =
        useUiPref<string>(ACCEPTED_NOTICE_PREF, '');
    const [sessionId, setSessionId, sessionLoaded] = useUiPref<string>(PREREG_SESSION_PREF, '');

    const loaded = acceptedLoaded && sessionLoaded;

    // Minted lazily, in an effect, and only once the read has SETTLED — so a cold start
    // cannot overwrite the id a previous open already stored, and the mint is never a
    // side effect of rendering.
    useEffect(() => {
        if (loaded && !sessionId) setSessionId(mintSessionId());
        // setSessionId is re-created every render by useUiPref; depending on it would
        // re-run this on every render and mint repeatedly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, sessionId]);

    const markPassed = useCallback(
        () => setAcceptedNotice(NOTICE_VERSION),
        [setAcceptedNotice],
    );

    const status: GateStatus = !loaded
        ? 'undecided'
        : acceptedNotice === NOTICE_VERSION
            ? 'passed'
            : 'required';

    return { status, preRegistrationSessionId: sessionId, markPassed };
}
