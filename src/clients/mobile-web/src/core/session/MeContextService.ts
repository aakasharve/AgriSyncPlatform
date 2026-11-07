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
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE (absent from an older server): the
     * seat's EFFECTIVE permission names ("AddCost", "PlanWork", …), empty unless Active.
     */
    permissions?: string[] | null;
    /** The owner's written reason for a pause ("काम थांबवलं — कारण…"), or null. */
    statusReason?: string | null;
    /**
     * lane 2b (MU design §2, §6) — ADDITIVE (absent from an older server): every authority this
     * seat HOLDS now on this farm, each with its end (`null` = कायम); empty unless Active. The label
     * (`role`) grants none — the phone reads its doors from this, never from the label.
     */
    authorities?: MeAuthority[] | null;
}

/** lane 2b — one authority the server says this seat holds, and when it ends. */
export interface MeAuthority {
    /** The server's `FarmAuthority` name ("TakeAttendance", "ConfirmRecords", "EditFarmSetup", …). */
    name: string;
    /** ISO UTC instant it ends, or null for कायम. */
    expiresAtUtc: string | null;
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
    /**
     * spec: plr-d10 lane MU-2 (MU design §6) — ADDITIVE (absent from an older server, or without includePending): the
     * waiting personal invitations that named his proven number. Never farms: the switcher reads `farms` only.
     */
    invitations?: MeInvitation[] | null;
}

/** spec: plr-d10 lane MU-2 — one waiting invitation on /me/context (no code, no farm id, no number). */
export interface MeInvitation {
    invitationId: string;
    farmName: string;
    invitedByName: string | null;
    /** "CoOwner" / "Family" / "Mukadam" / "Worker". */
    label: string;
    name: string | null;
    plotScope: 'AllPlots' | 'ChosenPlots' | 'OwnWork';
    plotNames: string[];
    authorities: MeAuthority[];
    expiresAtUtc: string;
    namesAWorker: boolean;
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
