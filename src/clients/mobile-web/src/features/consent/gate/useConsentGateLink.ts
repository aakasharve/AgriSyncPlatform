// spec: 2026-08-25-prod-cutover-waves (B1) — where the reconciliation is triggered from.
//
// ONE TRIGGER, NOT THREE. The gate cannot tell whether the account it produced came from
// registration or from a login, and it does not need to: the effect below fires whenever
// an authenticated user id appears, which covers registration, password login, OTP login
// (which authenticates through `AUTH_SESSION_CHANGED_EVENT`, not through `login()`), and
// the boot-validation refresh on every cold start. That last one IS the retry — a farmer
// who was offline when he registered gets linked the next time he opens the app with
// signal, with no separate retry machinery to keep correct.
//
// Wiring it here rather than inside AuthProvider is deliberate. `login`, `register` and
// the boot effect are the paths that must never acquire a new way to fail (doctrine P9);
// an effect that merely OBSERVES the resulting state cannot delay or break them. It also
// keeps the consent feature's code inside the consent feature.
//
// The `online` listener is the one addition beyond app start, and it is there because
// offline is normal here: a farmer can register in the field, keep the app open all day,
// and only reach signal in the evening. Without it the link waits for the next cold start.

import { useEffect } from 'react';
import { reconcileConsentGateLink } from './consentGateLinkReconciler';

/**
 * Fires the pending consent-gate link reconciliation for the signed-in account.
 *
 * Renders nothing, returns nothing, and reports nothing to the farmer — see doctrine P4
 * in the reconciler's header. Pass `null` when there is no authenticated account; the
 * hook is a no-op then.
 */
export function useConsentGateLinkReconciliation(userId: string | null | undefined): void {
    useEffect(() => {
        if (!userId) return;

        // try/catch AND a rejection handler. The reconciler already promises never to
        // reject, but this callsite sits directly beside the auth state, and a broken
        // promise here would surface as a JS crash report for what is usually just a
        // farmer with no signal. Two belts, because the cost of one is nothing.
        const attempt = () => {
            try {
                void reconcileConsentGateLink(userId).catch(() => { /* never surfaces */ });
            } catch {
                /* never surfaces */
            }
        };

        attempt();

        if (typeof window === 'undefined') return;
        window.addEventListener('online', attempt);
        return () => window.removeEventListener('online', attempt);
    }, [userId]);
}
