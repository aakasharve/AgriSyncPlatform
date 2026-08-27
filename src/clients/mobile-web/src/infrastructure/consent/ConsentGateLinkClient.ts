// spec: 2026-08-25-prod-cutover-waves (B1)
//
//   POST /shramsafal/consent-gate/link  →  one linking row in EACH consent ledger
//
// The AUTHENTICATED half of the consent gate's two calls. Its sibling —
// `features/consent/gate/consentGateApi.ts` — is anonymous by necessity and uses a bare
// `fetch` with a hand-resolved base URL, because consent has to precede the account and
// there is no session to lean on. This one is the opposite: it ASSERTS an identity, so it
// goes through `agriSyncClient.http`, which is the app's authenticated transport and
// already attaches the bearer token, `X-App-Version`, `X-Device-Id`, and the 401
// refresh-and-retry. That is why the two live in different layers rather than one file.
// (Same shape as `infrastructure/voiceDiary/voiceDiaryApiClient.ts`, which reaches for
// `agriSyncClient.http` directly for exactly this reason.)
//
// THE USER ID IS NOT SENT. The server takes it from the JWT subject and never from the
// body — a body-supplied id would let any signed-in caller claim another farmer's
// acceptance. Postgres is the final arbiter: the ledgers' RLS `WITH CHECK` reads
// `user_id IS NULL OR user_id = <GUC>`, so a linking row naming anyone but the caller
// cannot be written at all.
//
// THE NOTICE TEXT IS RE-SENT, not a row id and not a hash. The orphaned accepting row is
// readable by no role, so a pointer would name something nothing can dereference; and a
// digest the client both computes and asserts proves only that the client agrees with
// itself. The server re-hashes what it is told was displayed, with the same function the
// accepting write used.
//
// THIS FUNCTION THROWS on any refusal, and that is deliberate — the caller
// (`consentGateLinkReconciler`) is the single place that decides a throw means "not linked
// yet, try again", and it is the only place allowed to clear the stored payload. Two
// layers both deciding that would eventually disagree.
//
// @module infrastructure/consent/ConsentGateLinkClient

import { agriSyncClient } from '../api/AgriSyncClient';
import type { PendingConsentGateLink } from '../storage/ConsentGateLinkStore';

export interface ConsentGateLinkResult {
    termsAcceptanceEventId: string;
    consentGrantEventId: string;
    /**
     * True when the server found both linking rows already present and wrote nothing.
     * A replay is a 200 either way — which is precisely what lets the client retry
     * forever without ever appending duplicates to an append-only ledger.
     */
    alreadyLinked: boolean;
}

export async function linkConsentGateToUser(
    pending: PendingConsentGateLink,
): Promise<ConsentGateLinkResult> {
    const response = await agriSyncClient.http.post<Partial<ConsentGateLinkResult>>(
        '/shramsafal/consent-gate/link',
        {
            preRegistrationSessionId: pending.preRegistrationSessionId,
            noticeVersion: pending.noticeVersion,
            privacyPolicyVersion: pending.privacyPolicyVersion,
            termsVersion: pending.termsVersion,
            displayedLanguage: pending.displayedLanguage,
            acceptedPurposeCodes: [...pending.acceptedPurposeCodes],
            dataCategoryCodes: [...pending.dataCategoryCodes],
            source: pending.source,
            appVersion: pending.appVersion,
            displayedNoticeText: pending.displayedNoticeText,
        },
    );

    const body = response.data ?? {};
    // BOTH ids or nothing — same bar the accepting call holds. A response naming one row
    // is a half-written link: the Terms would belong to this account while the consent
    // that legitimises the data belongs to nobody. Treating that as a pass would clear the
    // payload and make the gap permanent.
    if (!body.termsAcceptanceEventId || !body.consentGrantEventId) {
        throw new Error('consent-gate link returned an incomplete pair of record ids');
    }

    return {
        termsAcceptanceEventId: body.termsAcceptanceEventId,
        consentGrantEventId: body.consentGrantEventId,
        alreadyLinked: body.alreadyLinked === true,
    };
}
