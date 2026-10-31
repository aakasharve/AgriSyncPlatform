/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * membershipAdminClient — the PRIMARY owner's decisions about one person on one farm.
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2). Before this, a typed farm code made a
 * PendingApproval seat that no screen could answer: the joiner's phone stopped at "विनंती पाठवली".
 *
 *   POST farms/{farmId}/memberships/{userId}/approve  {role, grantLabour}
 *   POST farms/{farmId}/memberships/{userId}/decline  {reason?}
 *   POST farms/{farmId}/memberships/{userId}/suspend  {reason?}
 *   POST farms/{farmId}/memberships/{userId}/restore
 *   POST farms/{farmId}/memberships/{userId}/remove   {reason?}
 *   PUT  farms/{farmId}/memberships/{userId}/access   {role?, resetPermissions?, labourGrant?}
 *
 * Every answer is the person's roster row (`LabourPermission`, the same shape the
 * labour-permissions roster returns), so the caller ADOPTS the server's row instead of assuming
 * its request landed (the rule `useLabourPermissions` already follows). The server refuses on its
 * own terms — the primary owner only (founder D-22), never on yourself, never on the farm's
 * registrant, the last owner stays — so a client that skips a guard cannot fake a decision, only
 * lose it.
 *
 * TRANSPORT: the app's one shared HTTP client (token, device id, one refresh-and-replay on 401).
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import type { AuthorityGrant, LabourPermission } from './labourPermissionsClient';

/**
 * The primary owner's two choices when he lets a waiting person in (PLR-D7 M1 plan step 2, founder
 * D-22 of 26 Oct; the joiner never chooses):
 *  - `work`   काम सांगणे   — a Worker (tells the work he did, records a purchase);
 *  - `crew`   काम + हजेरी  — a Mukadam with the existing हजेरी व पक्कं switch (the labour grant) on.
 * A family / co-owner choice is NOT offered in step 2 (its powers come as visible switches in the
 * proposed step 2b); the server refuses it with 400.
 */
export type ApprovePreset = 'work' | 'crew';

export interface ApproveBody {
    role: 'Worker' | 'Mukadam';
    grantLabour?: boolean;
}

/**
 * The request each choice sends. The हजेरी व पक्कं switch is sent as DESIRED state both ways, so a
 * grant left on the waiting request never survives काम सांगणे (the server also sets it exactly).
 */
export function approveBodyFor(preset: ApprovePreset): ApproveBody {
    switch (preset) {
        case 'work':
            return { role: 'Worker', grantLabour: false };
        case 'crew':
            return { role: 'Mukadam', grantLabour: true };
    }
}

export const membershipPath = (farmId: string, userId: string): string =>
    `/shramsafal/farms/${farmId}/memberships/${userId}`;

/** Blank → no reason sent (the server stores none). Trimmed; the server refuses over 500. */
const reasonBody = (reason?: string | null): { reason?: string } => {
    const trimmed = reason?.trim();
    return trimmed ? { reason: trimmed } : {};
};

export async function approveMember(farmId: string, userId: string, body: ApproveBody): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${membershipPath(farmId, userId)}/approve`, body);
    return response.data;
}

export async function declineMember(farmId: string, userId: string, reason?: string | null): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${membershipPath(farmId, userId)}/decline`, reasonBody(reason));
    return response.data;
}

export async function suspendMember(farmId: string, userId: string, reason?: string | null): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${membershipPath(farmId, userId)}/suspend`, reasonBody(reason));
    return response.data;
}

export async function restoreMember(farmId: string, userId: string): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${membershipPath(farmId, userId)}/restore`, {});
    return response.data;
}

export async function removeMember(farmId: string, userId: string, reason?: string | null): Promise<LabourPermission> {
    const response = await agriSyncClient.http.post<LabourPermission>(`${membershipPath(farmId, userId)}/remove`, reasonBody(reason));
    return response.data;
}

export interface SetAccessBody {
    role?: ApproveBody['role'];
    resetPermissions?: boolean;
    /** The हजेरी व पक्कं switch as DESIRED state (the server also turns it off on a role change). */
    labourGrant?: boolean;
}

/**
 * Moving a let-in person to one of the two choices, in ONE request: the role, back to that role's
 * defaults (whatever the owner had stored for the old role does NOT come along), and the हजेरी व
 * पक्कं switch exactly as the choice says (on for काम + हजेरी, off for काम सांगणे).
 */
export function presetAccessBody(preset: ApprovePreset): SetAccessBody {
    switch (preset) {
        case 'work':
            return { role: 'Worker', resetPermissions: true, labourGrant: false };
        case 'crew':
            return { role: 'Mukadam', resetPermissions: true, labourGrant: true };
    }
}

/** DESIRED state (role, labour grant), so a retry on a bad line converges. */
export async function setMemberAccess(farmId: string, userId: string, body: SetAccessBody): Promise<LabourPermission> {
    const response = await agriSyncClient.http.put<LabourPermission>(`${membershipPath(farmId, userId)}/access`, body);
    return response.data;
}

/**
 * lane 2b (MU design §2, §11.1) — the primary account holder sets EXACTLY which authorities this
 * person holds, each permanent (`expiresAtUtc: null`) or until an instant. The WHOLE desired set
 * travels (an authority left out is taken back), so a retry on a bad line converges; the server's
 * row is adopted, never assumed.
 */
export async function setMemberAuthorities(
    farmId: string,
    userId: string,
    authorities: readonly AuthorityGrant[],
): Promise<LabourPermission> {
    const response = await agriSyncClient.http.put<LabourPermission>(
        `${membershipPath(farmId, userId)}/authorities`, { authorities });
    return response.data;
}

/** Why a decision did not land, as the screen must say it (never "done" when it was not). */
export type MembershipErrorKind = 'last_owner' | 'wrong_status' | 'forbidden' | 'failed';

/**
 * Structural (not `instanceof AxiosError`), as `isCarriedByRoleError`: the shared client's
 * interceptor re-throws. 409 carries `{error:"membership.last_owner"|"membership.wrong_status"}`;
 * 403 has no body (not the primary owner, yourself, the registrant, not on this farm).
 */
export function membershipErrorKind(error: unknown): MembershipErrorKind {
    if (typeof error !== 'object' || error === null) return 'failed';
    const response = (error as { response?: { status?: number; data?: unknown } }).response;
    if (!response) return 'failed';
    if (response.status === 403) return 'forbidden';
    if (response.status === 409) {
        const code = typeof response.data === 'object' && response.data !== null
            ? (response.data as { error?: unknown }).error
            : undefined;
        if (code === 'membership.last_owner') return 'last_owner';
        if (code === 'membership.wrong_status') return 'wrong_status';
    }
    return 'failed';
}
