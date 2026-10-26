/**
 * inviteApi — Phase 4 client for the ShramSafal QR invitation endpoints.
 *
 * Backend contracts (all authed unless noted):
 *   POST /shramsafal/farms/{farmId}/invite-qr         → InviteResponse (idempotent)
 *   POST /shramsafal/farms/{farmId}/invite-qr/rotate  → InviteResponse (fresh token)
 *   POST /shramsafal/join/claim                       → ClaimResponse
 *   POST /shramsafal/join/by-code                     → JoinByCodeOutcome (typed, never throws)
 *   GET  /shramsafal/farms/mine?includePending=true   → MyFarmDto[]
 *
 * The owner's JWT must be present; for claim the JWT must additionally
 * carry `phone_verified=true` (enforced server-side).
 */

import { z } from 'zod';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import { INCLUDE_PENDING_SEATS_QUERY } from '../../../core/session/seatStatus';

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
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — ADDITIVE (absent from older servers): the
     * seat's real status. A fresh QR claim is "Active"; an existing typed-code request answers
     * "PendingApproval" and is NOT a join. Read it through `isActiveSeat`.
     */
    status?: string;
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
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — ADDITIVE (absent from older servers): the
     * caller's seat status. Only "Active" is a farm the person is in; "PendingApproval" (a typed
     * code waiting for the owner) carries the placeholder role "Worker", which is NOT a grant.
     * Read it through `isActiveSeat` (core/session/seatStatus).
     */
    status?: string;
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

/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — always with `includePending=true`: the list then
 * also carries seats that are not Active (a typed-code request waiting for the owner, a paused
 * seat). Every caller reads it through `isActiveSeat`; without the query the server answers
 * Active seats only, which is what an installed older app understood.
 */
export const getMyFarms = async (): Promise<MyFarmDto[]> => {
    const response = await fetch(`${resolveBaseUrl()}/shramsafal/farms/mine?${INCLUDE_PENDING_SEATS_QUERY}`, {
        method: 'GET',
        headers: authHeaders(),
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as MyFarmDto[];
};

export const isInviteApiError = (value: unknown): value is InviteApiError =>
    typeof value === 'object' && value !== null && 'error' in value && 'status' in value;

/* ─────────────────────────────────────────────────────────────── */
/* spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — typed farm code */
/* ─────────────────────────────────────────────────────────────── */

/**
 * The server's answer to a known code: the seat it made (PendingApproval) or, when the caller
 * already had a live seat there, that seat's real status. Checked, not cast: a body that does not
 * match is a failure, never a join.
 */
const JoinByCodeResponseSchema = z.object({
    farmId: z.string().min(1),
    farmName: z.string(),
    status: z.enum(['Active', 'PendingApproval', 'Suspended']),
});

export type JoinedFarm = z.infer<typeof JoinByCodeResponseSchema>;
export type JoinSeatStatus = JoinedFarm['status'];

/**
 * Every answer the join-by-code door can get, as a value (the screen never parses an error):
 *   joined        200 — a seat exists; the joiner never chose its role
 *   code_unknown  404 `join.code_unknown` — the SAME answer for any wrong code; carries no farm name
 *   rate_limited  429 — too many tries
 *   signed_out    401 that is still a 401 after `apiFetch` refreshed the session once and replayed:
 *                 the server refused the refresh (the phone's sign-in was cleared) or refused even
 *                 the fresh token. Asking again cannot help — the person has to sign in again.
 *   failed        anything else: no network (status 0), a timeout, 5xx, a 404 WITHOUT that code
 *                 (an older server that has no such route must not read as "wrong code"), a 200
 *                 body that does not match the contract, or a 401 whose refresh never reached the
 *                 server (the old token is kept, so a later try refreshes again and can succeed)
 */
export type JoinByCodeOutcome =
    | { kind: 'joined'; farm: JoinedFarm }
    | { kind: 'code_unknown' }
    | { kind: 'rate_limited' }
    | { kind: 'signed_out' }
    | { kind: 'failed'; status: number };

const JOIN_BY_CODE_TIMEOUT_MS = 20_000;

export const joinByCode = async (farmCode: string): Promise<JoinByCodeOutcome> => {
    // A hung request must not leave the screen on "तपासत आहे…" for ever.
    const abort = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = abort ? setTimeout(() => abort.abort(), JOIN_BY_CODE_TIMEOUT_MS) : null;
    // The token this ask starts with: after a final 401 it tells whether the refresh changed anything.
    const tokenBefore = getAuthSession()?.accessToken ?? null;
    try {
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, M5) — through `apiFetch`, the app's
        // authenticated fetch: it carries the access token and, on a 401 (a token past its short
        // life, or none yet on a cold start), refreshes the session ONCE and replays this request.
        // A raw fetch never refreshed, so an expired token read as "check the internet" for ever.
        // No Authorization header here on purpose: apiFetch only refreshes a token it attached.
        const response = await apiFetch('/shramsafal/join/by-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farmCode }),
            signal: abort?.signal,
        });
        if (response.status === 401) {
            // Refused even after the refresh-and-replay. A refused refresh clears the session; a
            // refresh that worked holds a NEW token the server still refused — either way the token
            // changed, and the sign-in is gone. Only a refresh that never reached a server leaves the
            // same token in place: that one is a plain failure, and पुन्हा पाठवा refreshes again.
            const tokenAfter = getAuthSession()?.accessToken ?? null;
            return tokenAfter === tokenBefore ? { kind: 'failed', status: 401 } : { kind: 'signed_out' };
        }
        if (response.status === 429) return { kind: 'rate_limited' };
        if (response.status === 404) {
            const error = await parseError(response);
            return error.error === 'join.code_unknown'
                ? { kind: 'code_unknown' }
                : { kind: 'failed', status: 404 };
        }
        if (!response.ok) return { kind: 'failed', status: response.status };
        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            /* not JSON: fails the check below */
        }
        const parsed = JoinByCodeResponseSchema.safeParse(body);
        return parsed.success
            ? { kind: 'joined', farm: parsed.data }
            : { kind: 'failed', status: response.status };
    } catch {
        return { kind: 'failed', status: 0 };
    } finally {
        if (timer) clearTimeout(timer);
    }
};

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
    farmerName?: string,
): Promise<BootstrapFirstFarmResponse> => {
    const response = await fetch(`${resolveBaseUrl()}/bootstrap/first-farm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            farmName: farmName.trim(),
            village: village?.trim() || null,
            farmerName: farmerName?.trim() || null,
        }),
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

/* ─────────────────────────────────────────────────────────────── */
/* Farm details + boundary — used by Identity > Draw farm boundary */
/* ─────────────────────────────────────────────────────────────── */

export interface FarmDetailsDto {
    id: string;
    name: string;
    ownerUserId: string;
    ownerAccountId: string;
    canonicalCentreLat: number | null;
    canonicalCentreLng: number | null;
    centreSource: string | null;
    weatherRadiusKm: number;
    totalMappedAreaAcres: number | null;
    totalGovtAreaAcres: number | null;
    geoValidationStatus: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export const getFarmDetails = async (farmId: string): Promise<FarmDetailsDto> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}`,
        { method: 'GET', headers: authHeaders() },
    );
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as FarmDetailsDto;
};

export interface UpdateFarmBoundaryInput {
    boundary: { lat: number; lng: number }[];
    centre: { lat: number; lng: number };
    areaAcres: number;
}

const boundaryToFeatureGeoJson = (boundary: { lat: number; lng: number }[]): string => {
    const coordinates = boundary.map(p => [p.lng, p.lat]);
    if (coordinates.length > 0) {
        const [fx, fy] = coordinates[0];
        const [lx, ly] = coordinates[coordinates.length - 1];
        if (fx !== lx || fy !== ly) coordinates.push([fx, fy]);
    }
    return JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coordinates] },
    });
};

/**
 * Probe the farm's weather endpoint to confirm the boundary→provider link
 * is healthy. Used by the "Connect Farm to Weather" CTA so the user can
 * explicitly opt in to live weather and we can surface a friendly error
 * if Tomorrow.io isn't yet configured (HTTP 400 WeatherProviderNotConfigured)
 * or the canonical centre is missing (FarmCentreMissing).
 */
export const probeFarmWeather = async (farmId: string): Promise<void> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/weather/current`,
        { method: 'GET', headers: authHeaders() },
    );
    if (!response.ok) throw await parseError(response);
};

export const updateFarmBoundary = async (
    farmId: string,
    input: UpdateFarmBoundaryInput,
): Promise<FarmDetailsDto> => {
    const response = await fetch(
        `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/boundary`,
        {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                polygonGeoJson: boundaryToFeatureGeoJson(input.boundary),
                centreLat: input.centre.lat,
                centreLng: input.centre.lng,
                calculatedAreaAcres: input.areaAcres,
            }),
        },
    );
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as FarmDetailsDto;
};
