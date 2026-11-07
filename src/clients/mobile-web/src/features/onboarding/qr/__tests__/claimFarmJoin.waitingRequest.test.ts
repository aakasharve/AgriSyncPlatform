// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1 (founder question D-103, the review's Q1).
 *
 * A wall-QR scan now makes a request that waits for the owner. A phone that does not SAY it understands that
 * (`acceptsJoinRequest: true` in the claim body) gets 409 `{error: "join.request_sent", message}` instead of the 200 —
 * because release 1.0.17 reads a 200 as "joined", fails its own farm-list cross-check, and shows "Could not reach the
 * server…", which is untrue. This file proves both halves on the phone side:
 *   1. this release's claim sends the flag (so it keeps its 200 and its own words);
 *   2. 1.0.17's OWN claim-error path — copied below VERBATIM from `b3d28967` (read with `git show`, not edited) — shows
 *      the server's 409 message exactly as written, on the same step, and not as a dead QR.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'u-1', accessToken: 'tok', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

import { claimFarmJoin } from '../inviteApi';

const WAITING_MESSAGE =
    'मालकाला विनंती गेली आहे. ते मंजूर करतील तेव्हा शेत उघडेल. / Your request reached the owner; the farm opens once he approves.';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('this release', () => {
    it('says it understands a waiting request when it claims a wall QR', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({
            membershipId: 'm', farmId: 'f', farmName: 'पाटील फार्म', role: 'Worker', wasAlreadyMember: false, status: 'PendingApproval',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const claim = await claimFarmJoin('token-1', 'K7M2QP');

        expect(claim.status).toBe('PendingApproval');
        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
        expect(body).toEqual({ token: 'token-1', farmCode: 'K7M2QP', acceptsJoinRequest: true });
    });
});

// ── release 1.0.17 (b3d28967), VERBATIM ────────────────────────────────────────────────────────────────────────────────
// src/clients/mobile-web/src/features/onboarding/qr/inviteApi.ts:74-92 and :131-132
interface InviteApiError {
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

const isInviteApiError = (value: unknown): value is InviteApiError =>
    typeof value === 'object' && value !== null && 'error' in value && 'status' in value;

// src/clients/mobile-web/src/pages/JoinFarmLandingPage.tsx:76
const REVOKED_CODES = ['join.token_invalid', 'join.farm_code_mismatch'];
// ── end of the verbatim copy ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * What 1.0.17's join page does with the claim's answer (JoinFarmLandingPage.tsx:345-395): `claimFarmJoin` throws
 * `parseError(response)` for a non-2xx answer; the catch sends a `join.*` error to the invite-error branch, which shows
 * `err.message` and moves to the "revoked" step only for REVOKED_CODES. A 200 is followed by its farm-list check
 * (`askServerIfMember`), which lists Active seats only, so a waiting seat throws its own "Could not reach the server…".
 */
async function whatOneZeroSeventeenShows(response: Response): Promise<{ error: string; step: 'phone' | 'revoked' | 'done' }> {
    try {
        if (!response.ok) throw await parseError(response);
        const claim = (await response.json()) as { status?: string };
        const listed = claim.status === 'Active';
        if (listed === false) {
            throw { error: 'join.not_confirmed', message: 'Could not reach the server. Check your connection and try again.', status: 0 };
        }
        return { error: '', step: 'done' };
    } catch (err) {
        if (isInviteApiError(err)) {
            return { error: err.message, step: REVOKED_CODES.includes(err.error) ? 'revoked' : 'phone' };
        }
        return { error: 'Could not reach the server. Check your connection and try again.', step: 'phone' };
    }
}

describe('release 1.0.17 reading the server', () => {
    it('shows the 409 join.request_sent message exactly as written, on the same step', async () => {
        const shown = await whatOneZeroSeventeenShows(new Response(
            JSON.stringify({ error: 'join.request_sent', message: WAITING_MESSAGE }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }));
        expect(shown).toEqual({ error: WAITING_MESSAGE, step: 'phone' });
    });

    it('(why the 409: the old 200 for a waiting seat made it say the network failed)', async () => {
        const shown = await whatOneZeroSeventeenShows(new Response(
            JSON.stringify({ membershipId: 'm', farmId: 'f', farmName: 'x', role: 'Worker', wasAlreadyMember: false, status: 'PendingApproval' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }));
        expect(shown.error).toBe('Could not reach the server. Check your connection and try again.');
    });
});
