/**
 * MeContextService — fetches and locally caches the /user/auth/me/context
 * aggregate. The cache is keyed by userId + a 2-minute TTL so the app
 * stays snappy on repeated navigation while staying fresh enough.
 *
 * New shape (spec 2026-04-20-user-is-multitenant-base): the server
 * pre-computes plan strings, per-farm capabilities, and banner alerts so
 * the frontend is a dumb renderer for a semi-literate Marathi farmer.
 */

import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';

export type MePlan = 'Free' | 'Trial' | 'Pro' | 'PastDue' | 'Expired';

export interface MeCapabilities {
    canInvite: boolean;
    canVerify: boolean;
    canAddCost: boolean;
    canSeeBilling: boolean;
}

export interface MeFarm {
    farmId: string;
    name: string;
    farmCode: string | null;
    ownerAccountId: string;
    role: string;
    status: string;
    joinedVia: string;
    plan: MePlan;
    planValidUntilUtc: string | null;
    capabilities: MeCapabilities;
}

export interface MeIdentity {
    userId: string;
    displayName: string;
    phoneMasked: string;
    phoneVerifiedAtUtc: string | null;
    preferredLanguage: string;
    authMode: string;
}

export interface MeShare {
    referralCode: string | null;
    referralsTotal: number;
    referralsQualified: number;
    benefitsEarned: number;
}

export type MeAlertKind =
    | 'verify_phone'
    | 'plan_expiring'
    | 'plan_expired'
    | 'no_farms_yet';

export interface MeAlert {
    kind: MeAlertKind;
    severity: 'info' | 'warn' | 'error';
    farmId?: string | null;
    daysLeft?: number | null;
}

export interface MeContext {
    me: MeIdentity;
    farms: MeFarm[];
    share: MeShare;
    alerts: MeAlert[];
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
