/**
 * useEntitlement — reads the current farm's subscription snapshot and
 * returns a typed decision for a given feature gate.
 *
 * Multi-tenant plan Phase 5.4. Data source: the SubscriptionSnapshotDto
 * embedded in each MyFarmDto returned by /shramsafal/farms/mine. No
 * separate network call — the snapshot is already in the farm-context
 * state managed by AppContent.
 *
 * Usage:
 *   const { allowed, reason } = useEntitlement(currentFarm, 'write');
 *   if (!allowed) return <EntitlementBanner ... />;
 */

import type { SubscriptionSnapshotDto } from '../../features/onboarding/qr/inviteApi';

export type EntitlementFeature =
    | 'write'       // create log, add cost, verify, create plot
    | 'ai'          // voice parse, receipt OCR, patti extract
    | 'mis_read'    // owner MIS dashboard (paid-only feature)
    | 'read';       // always allowed — fallback for read-path operations

export interface EntitlementDecision {
    allowed: boolean;
    reason:
        | 'allowed'
        | 'subscription_missing'
        | 'subscription_past_due_read_only'
        | 'subscription_expired'
        | 'subscription_canceled'
        | 'subscription_suspended';
}

const ALLOWED: EntitlementDecision = { allowed: true, reason: 'allowed' };

/**
 * Pure function — no React needed. Can be called from hooks, event
 * handlers, or server-side utilities.
 */
export function evaluateEntitlement(
    subscription: SubscriptionSnapshotDto | null | undefined,
    role: string,
    feature: EntitlementFeature,
): EntitlementDecision {
    // Workers have no write features gated by subscription — they
    // contribute logs; the owner's account pays for the platform.
    if (role !== 'PrimaryOwner' && role !== 'SecondaryOwner') {
        return ALLOWED;
    }

    // Read is always allowed regardless of subscription state.
    if (feature === 'read') return ALLOWED;

    if (!subscription) {
        return { allowed: false, reason: 'subscription_missing' };
    }

    const { status, allowsOwnerWrites } = subscription;

    if (allowsOwnerWrites) return ALLOWED;

    switch (status) {
        case 'PastDue':
            // Writes blocked, reads allowed.
            return { allowed: false, reason: 'subscription_past_due_read_only' };
        case 'Expired':
            return { allowed: false, reason: 'subscription_expired' };
        case 'Canceled':
            return { allowed: false, reason: 'subscription_canceled' };
        case 'Suspended':
            return { allowed: false, reason: 'subscription_suspended' };
        default:
            // Covers any future states — fail closed.
            return { allowed: false, reason: 'subscription_expired' };
    }
}

/**
 * React hook variant — takes the subscription + role from a MyFarmDto
 * and memoises the decision.
 */
import { useMemo } from 'react';

export function useEntitlement(
    subscription: SubscriptionSnapshotDto | null | undefined,
    role: string,
    feature: EntitlementFeature,
): EntitlementDecision {
    return useMemo(
        () => evaluateEntitlement(subscription, role, feature),
        [subscription, role, feature],
    );
}
