/**
 * inviteApi — Phase 4 client for the ShramSafal QR invitation endpoints.
 *
 * Backend contracts (all authed unless noted):
 *   POST /shramsafal/farms/{farmId}/invite-qr         → InviteResponse (idempotent)
 *   POST /shramsafal/farms/{farmId}/invite-qr/rotate  → InviteResponse (fresh token)
 *   POST /shramsafal/join/claim                       → ClaimResponse
 *   GET  /shramsafal/farms/mine                       → MyFarmDto[]
 *
 * The owner's JWT must be present; for claim the JWT must additionally
 * carry `phone_verified=true` (enforced server-side).
 */

import { getAuthSession } from '../../../infrastructure/api/AuthTokenStore';

interface ViteImportMeta {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
    return headers;
};

export interface InviteResponse {
    invitationId: string;
    joinTokenId: string;
    farmId: string;
    farmName: string;
    farmCode: string;
    token: string;
    issuedAtUtc: string;
    qrPayload: string;
}

export interface ClaimResponse {
    membershipId: string;
    farmId: string;
    farmName: string;
    role: string;
    wasAlreadyMember: boolean;
}

export interface SubscriptionSnapshotDto {
    statusCode: number;
    status: string;
    planCode: string;
    validUntilUtc: string;
    allowsOwnerWrites: boolean;
}

export interface MyFarmDto {
    farmId: string;
    name: string;
    role: string;
    farmCode: string | null;
    subscription: SubscriptionSnapshotDto | null;
}

export interface InviteApiError {
    error: string;
    message: string;
    status: number;
}

const parseError = async (response: Response): Promise<InviteApiError> => {
    let payload: { error?: string; message?: string } = {};
    try {
        payload = await response.json();
    } catch {
        /* noop */
    }
    return {
        error: payload.error ?? 'invite.unknown',
        message: payload.message ?? `Server returned ${response.status}.`,
        status: response.status,
    };
};

export const issueFarmInvite = async (farmId: string): Promise<InviteResponse> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/invite-qr`,
        { method: 'POST', headers: authHeaders() },
    );
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as InviteResponse;
};

export const rotateFarmInvite = async (farmId: string): Promise<InviteResponse> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/invite-qr/rotate`,
        { method: 'POST', headers: authHeaders() },
    );
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as InviteResponse;
};

export const claimFarmJoin = async (token: string, farmCode: string): Promise<ClaimResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/shramsafal/join/claim`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token, farmCode }),
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as ClaimResponse;
};

export const getMyFarms = async (): Promise<MyFarmDto[]> => {
    const response = await fetch(`${resolveBaseUrl()}/shramsafal/farms/mine`, {
        method: 'GET',
        headers: authHeaders(),
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as MyFarmDto[];
};

export const isInviteApiError = (value: unknown): value is InviteApiError =>
    typeof value === 'object' && value !== null && 'error' in value && 'status' in value;

/* ─────────────────────────────────────────────────────────────── */
/* Phase 6 — first-farm bootstrap + self-exit                      */
/* ─────────────────────────────────────────────────────────────── */

export interface BootstrapFirstFarmResponse {
    farmId: string;
    farmName: string;
    farmCode: string;
    ownerAccountId: string;
    subscription: {
        subscriptionId: string;
        status: string;
        planCode: string;
        validUntilUtc: string;
        allowsOwnerWrites: boolean;
    } | null;
    wasAlreadyBootstrapped: boolean;
}

export const bootstrapFirstFarm = async (
    farmName: string,
    village?: string,
): Promise<BootstrapFirstFarmResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/bootstrap/first-farm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ farmName: farmName.trim(), village: village?.trim() || null }),
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as BootstrapFirstFarmResponse;
};

export interface ExitMembershipResponse {
    membershipId: string;
    alreadyExited: boolean;
}

export const exitMembership = async (farmId: string): Promise<ExitMembershipResponse> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/memberships/self-exit`,
        { method: 'POST', headers: authHeaders() },
    );
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as ExitMembershipResponse;
};
