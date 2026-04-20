/**
 * MeContextService — fetches and locally caches the /user/auth/me/context
 * aggregate. The cache is keyed by userId + a 2-minute TTL so the app
 * stays snappy on repeated navigation while staying fresh enough.
 *
 * Multi-tenant plan §6.2.1.
 */

import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';

export interface SubscriptionSnapshot {
    status: string;
    statusCode: number;
    planCode: string;
    validUntilUtc: string;
    allowsOwnerWrites: boolean;
}

export interface MeMembership {
    membershipId: string;
    farmId: string;
    farmName: string;
    farmCode: string | null;
    ownerAccountId: string;
    role: string;
    status: string;
    joinedVia: string;
    lastSeenAtUtc: string | null;
    grantedAtUtc: string;
    subscription: SubscriptionSnapshot | null;
}

export interface MeOwnerAccount {
    ownerAccountId: string;
    accountName: string;
    isPrimaryOwner: boolean;
    subscription: (SubscriptionSnapshot & { subscriptionId: string }) | null;
}

export interface MeAffiliation {
    referralCode: string | null;
    referralsTotal: number;
    referralsQualified: number;
    benefitsEarned: number;
}

export interface MeContext {
    user: {
        userId: string;
        displayName: string;
        phoneMasked: string;
    };
    ownerAccounts: MeOwnerAccount[];
    memberships: MeMembership[];
    affiliation: MeAffiliation;
    serverTimeUtc: string;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface CacheEntry {
    data: MeContext;
    fetchedAt: number;
}

let cache: CacheEntry | null = null;

export async function fetchMeContext(opts?: { force?: boolean }): Promise<MeContext> {
    const now = Date.now();
    if (!opts?.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.data;
    }
    const response = await agriSyncClient.getMeContext();
    cache = { data: response, fetchedAt: now };
    return response;
}

export function invalidateMeContext(): void {
    cache = null;
}

export function getLastCachedMeContext(): MeContext | null {
    return cache?.data ?? null;
}
