// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — `joinByCode` maps the fixed server contract
 *   POST /shramsafal/join/by-code {farmCode}
 *     200 {farmId, farmName, status}  ·  404 {error:"join.code_unknown"}  ·  429  ·  401
 * to typed outcomes, checks the 200 body instead of trusting it, and never throws.
 *
 * M5: it goes through the app's authenticated fetch (`apiFetch`), so an expired access token is
 * refreshed ONCE and the request replayed — a raw fetch never refreshed and left the farmer on
 * "इंटरनेट तपासून पुन्हा प्रयत्न करा" for ever. Only `fetch` and the session refresh are stubbed;
 * `apiFetch` itself runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Session = { userId: string; accessToken: string; expiresAtUtc: string };
const h = vi.hoisted(() => ({
    session: null as Session | null,
    refreshSession: vi.fn(),
}));

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => h.session,
}));
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: (...a: unknown[]) => h.refreshSession(...a) },
}));

import { joinByCode } from '../inviteApi';

const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const sessionWith = (accessToken: string): Session =>
    ({ userId: 'u-1', accessToken, expiresAtUtc: '2099-01-01T00:00:00Z' });

const bearerOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Authorization');

const SEAT = { farmId: 'f-1', farmName: 'पवार शेती', status: 'PendingApproval' };

const fetchMock = vi.fn();

beforeEach(() => {
    h.session = sessionWith('tok-abc');
    h.refreshSession.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('joinByCode — request', () => {
    it('POSTs the code, signed in, to /shramsafal/join/by-code — and nothing else (no role)', async () => {
        fetchMock.mockResolvedValue(reply(200, SEAT));
        await joinByCode('K7M2QX');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url.endsWith('/shramsafal/join/by-code')).toBe(true);
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ farmCode: 'K7M2QX' });
        expect(bearerOf(fetchMock.mock.calls[0])).toBe('Bearer tok-abc');
        expect(h.refreshSession).not.toHaveBeenCalled();
    });
});

describe('joinByCode — answers', () => {
    it('200 PendingApproval → joined, with the server farm name and status', async () => {
        fetchMock.mockResolvedValue(reply(200, SEAT));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'joined', farm: SEAT });
    });

    it.each([['Active'], ['Suspended']])('200 with an existing seat\'s real status (%s) → joined with that status', async (status) => {
        fetchMock.mockResolvedValue(reply(200, { farmId: 'f-1', farmName: 'पवार शेती', status }));
        const out = await joinByCode('K7M2QX');
        expect(out.kind).toBe('joined');
        expect(out.kind === 'joined' && out.farm.status).toBe(status);
    });

    it('200 whose body breaks the contract is a failure, never a join', async () => {
        fetchMock.mockResolvedValue(reply(200, { farmId: 'f-1', farmName: 'पवार शेती', status: 'Owner' }));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'failed', status: 200 });
        fetchMock.mockResolvedValue(reply(200, { farmName: 'पवार शेती' }));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'failed', status: 200 });
    });

    it('404 join.code_unknown → code_unknown (carries no farm name)', async () => {
        fetchMock.mockResolvedValue(reply(404, { error: 'join.code_unknown' }));
        const out = await joinByCode('K7M2QX');
        expect(out).toEqual({ kind: 'code_unknown' });
        expect(JSON.stringify(out)).not.toContain('farmName');
    });

    it('404 WITHOUT that code (an older server with no such route) is a failure, not "wrong code"', async () => {
        fetchMock.mockResolvedValue(reply(404));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'failed', status: 404 });
    });

    it('429 → rate_limited', async () => {
        fetchMock.mockResolvedValue(reply(429));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'rate_limited' });
    });

    it.each([[500], [503]])('%i → failed with that status, and no session refresh', async (status) => {
        fetchMock.mockResolvedValue(reply(status, { error: 'x' }));
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'failed', status });
        expect(h.refreshSession).not.toHaveBeenCalled();
    });

    it('no network → failed (status 0), never a throw', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(joinByCode('K7M2QX')).resolves.toEqual({ kind: 'failed', status: 0 });
    });
});

describe('joinByCode — an expired sign-in (M5)', () => {
    it('401 → refreshes the session ONCE, replays the same request with the fresh token, and joins', async () => {
        fetchMock.mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, SEAT));
        h.refreshSession.mockImplementation(async () => {
            h.session = sessionWith('tok-fresh');
            return { kind: 'refreshed', session: h.session };
        });

        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'joined', farm: SEAT });

        expect(h.refreshSession).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(bearerOf(fetchMock.mock.calls[0])).toBe('Bearer tok-abc');
        // The replay carries the NEW token and the same code.
        expect(bearerOf(fetchMock.mock.calls[1])).toBe('Bearer tok-fresh');
        const replay = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(replay[0].endsWith('/shramsafal/join/by-code')).toBe(true);
        expect(replay[1].method).toBe('POST');
        expect(JSON.parse(String(replay[1].body))).toEqual({ farmCode: 'K7M2QX' });
    });

    it('the server refuses the refresh (sign-in cleared) → signed_out, not a "check the internet" failure', async () => {
        fetchMock.mockResolvedValue(reply(401));
        h.refreshSession.mockImplementation(async () => {
            // What the real refreshSession does on a judged refusal: clear the session, then answer.
            h.session = null;
            return { kind: 'rejected' };
        });

        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'signed_out' });
        expect(h.refreshSession).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1); // nothing to replay with
    });

    it('the refresh works but the server refuses the fresh token too → signed_out, and no loop', async () => {
        fetchMock.mockResolvedValue(reply(401));
        h.refreshSession.mockImplementation(async () => {
            h.session = sessionWith('tok-fresh');
            return { kind: 'refreshed', session: h.session };
        });

        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'signed_out' });
        expect(h.refreshSession).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a refresh that never reached the server keeps the sign-in → a plain retryable failure, and the retry recovers', async () => {
        fetchMock.mockResolvedValueOnce(reply(401));
        h.refreshSession.mockResolvedValueOnce({ kind: 'unreachable' }); // session left exactly as it was

        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'failed', status: 401 });
        expect(h.session?.accessToken).toBe('tok-abc');

        // पुन्हा पाठवा: the same call refreshes again, and this time it works.
        fetchMock.mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, SEAT));
        h.refreshSession.mockImplementationOnce(async () => {
            h.session = sessionWith('tok-fresh');
            return { kind: 'refreshed', session: h.session };
        });
        expect(await joinByCode('K7M2QX')).toEqual({ kind: 'joined', farm: SEAT });
    });
});
