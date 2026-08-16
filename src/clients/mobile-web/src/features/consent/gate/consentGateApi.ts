// spec: dfes-companion-2026-07-11 (wave-4.2)
//
// The gate's only network call: POST /shramsafal/consent-gate/accept → two rows.
//
// Anonymous by necessity — consent has to precede the account, so there is no token to
// send. It follows dfesQuestionApi's shape (bare fetch, resolved base URL) rather than
// AgriSyncClient's, because AgriSyncClient's interceptors assume a session.
//
// The NOTICE TEXT is sent, not a hash. The server hashes it, because a digest the client
// both computes and asserts proves only that the client agrees with itself.
//
// A failure THROWS. The screen catches it, stays on the gate, and says so — the one
// outcome that must never happen is a farmer walking into the app believing a consent
// record exists when it does not.

import { APP_VERSION } from '../../../infrastructure/api/transport';
import type { ConsentGateAcceptance } from './ConsentGateScreen';

interface ViteImportMeta { env?: { VITE_AGRISYNC_API_URL?: unknown } }

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) return raw.trim().replace(/\/+$/, '');
    return 'http://localhost:5048';
};

/** `app` for the installed APK, `web` for the browser. A fact about where the acceptance
 *  happened — the server refuses anything else rather than defaulting one. */
export function resolveConsentSource(): 'app' | 'web' {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    try {
        return cap?.isNativePlatform?.() ? 'app' : 'web';
    } catch {
        return 'web';
    }
}

export interface ConsentGateRecordIds {
    termsAcceptanceEventId: string;
    consentGrantEventId: string;
}

export async function recordConsentGateAcceptance(
    acceptance: ConsentGateAcceptance,
    preRegistrationSessionId: string,
): Promise<ConsentGateRecordIds> {
    const res = await fetch(`${resolveBaseUrl()}/shramsafal/consent-gate/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            preRegistrationSessionId,
            noticeVersion: acceptance.noticeVersion,
            privacyPolicyVersion: acceptance.privacyPolicyVersion,
            termsVersion: acceptance.termsVersion,
            displayedLanguage: acceptance.displayedLanguage,
            acceptedPurposeCodes: [...acceptance.purposeCodes],
            dataCategoryCodes: [...acceptance.dataCategoryCodes],
            source: resolveConsentSource(),
            appVersion: APP_VERSION,
            displayedNoticeText: acceptance.canonicalNotice,
            ageDeclaredAdult: acceptance.ageDeclaredAdult,
        }),
    });

    if (!res.ok) {
        throw new Error(`consent-gate accept failed: ${res.status}`);
    }

    const body = (await res.json()) as Partial<ConsentGateRecordIds>;
    // BOTH ids or nothing. A response naming one record is a half-written acceptance and
    // must not be treated as a pass.
    if (!body.termsAcceptanceEventId || !body.consentGrantEventId) {
        throw new Error('consent-gate accept returned an incomplete pair of record ids');
    }

    return {
        termsAcceptanceEventId: body.termsAcceptanceEventId,
        consentGrantEventId: body.consentGrantEventId,
    };
}
