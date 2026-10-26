// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the shared contract for the two farm lists:
 * `GET /shramsafal/farms/mine` and `GET /user/auth/me/context` list the seats that are NOT Active
 * (PendingApproval / Suspended / PendingOtpClaim) ONLY when asked with `includePending=true`.
 * Without it they answer Active seats only — what an installed older app (e.g. the 1.0.16 APK)
 * understood (doctrine P11). THIS phone always asks with it, and reads every seat through
 * `isActiveSeat`.
 *
 * Two halves:
 *   1. each of the three places that builds one of these requests sends the query (the real code,
 *      only `fetch` / the axios transport stubbed);
 *   2. a source sweep: no other code in `src/` builds either route, and every place that does
 *      carries the query — so a future caller cannot quietly ask for Active seats only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// inviteApi -> apiFetch -> AgriSyncClient: the client is not under test here.
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { refreshSession: vi.fn() },
}));

import { INCLUDE_PENDING_SEATS_QUERY, isActiveSeat } from '../seatStatus';
import { getMyFarms } from '../../../features/onboarding/qr/inviteApi';
import { BackendFarmGeographyClient } from '../../../infrastructure/farmGeography/BackendFarmGeographyClient';
import { getMeContext } from '../../../infrastructure/api/resources/AuthResource';

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the query itself', () => {
    it('is exactly includePending=true', () => {
        expect(INCLUDE_PENDING_SEATS_QUERY).toBe('includePending=true');
    });

    it('the phone-side reading of a seat is unchanged: only Active (or no status, an older server) is a farm he is in', () => {
        expect(isActiveSeat({ status: 'Active' })).toBe(true);
        expect(isActiveSeat({})).toBe(true);
        for (const status of ['PendingApproval', 'Suspended', 'PendingOtpClaim']) {
            expect(isActiveSeat({ status })).toBe(false);
        }
    });
});

describe('every /farms/mine and /me/context call carries includePending=true', () => {
    it('inviteApi.getMyFarms (join landing page, farm switcher, profile, referrals …)', async () => {
        fetchMock.mockResolvedValue(json(200, []));
        await getMyFarms();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url.endsWith('/shramsafal/farms/mine?includePending=true')).toBe(true);
        expect(init.method).toBe('GET');
    });

    it('BackendFarmGeographyClient.listAccessibleFarms — and it still opens Active seats only', async () => {
        fetchMock.mockImplementation(async (url: string) =>
            url.includes('/farms/mine')
                ? json(200, [
                    { farmId: 'f-pending', status: 'PendingApproval' },
                    { farmId: 'f-paused', status: 'Suspended' },
                    { farmId: 'f-active', status: 'Active' },
                ])
                : json(404, {}));

        await new BackendFarmGeographyClient().listAccessibleFarms();

        const urls = fetchMock.mock.calls.map(c => String(c[0]));
        expect(urls[0].endsWith('/shramsafal/farms/mine?includePending=true')).toBe(true);
        // Only the Active seat's farm is asked for; a request or a paused seat is never opened.
        expect(urls.slice(1)).toHaveLength(1);
        expect(urls[1].endsWith('/shramsafal/farms/f-active')).toBe(true);
    });

    it('AuthResource.getMeContext (every /me/context reader: FarmContext, language, AI farm, voice archive)', async () => {
        const get = vi.fn().mockResolvedValue({ data: { farms: [] } });
        await getMeContext({ http: { get }, authHttp: {} } as never);

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/user/auth/me/context?includePending=true');
    });
});

/* ───────────────────────── source sweep ───────────────────────── */

const SRC = join(process.cwd(), 'src');

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
        return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) ? [full] : [];
    });

/** The code part of a line: comment lines are dropped and a trailing ` // …` is cut off. */
const codeOf = (line: string): string => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return '';
    return line.replace(/\s\/\/\s.*$/, '');
};

const ROUTE = /\/(?:farms\/mine|me\/context)\b/g;
const WITH_QUERY = /^\?(?:\$\{INCLUDE_PENDING_SEATS_QUERY\}|includePending=true)/;

describe('source sweep: no farm-list request without includePending=true', () => {
    const hits: { file: string; line: number; ok: boolean; text: string }[] = [];
    for (const file of sourceFiles(SRC)) {
        readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            const code = codeOf(line);
            for (const m of code.matchAll(ROUTE)) {
                const after = code.slice((m.index ?? 0) + m[0].length);
                hits.push({ file: relative(SRC, file).split(sep).join('/'), line: i + 1, ok: WITH_QUERY.test(after), text: line.trim() });
            }
        });
    }

    it('the sweep sees the three places that build these requests (it is not looking at nothing)', () => {
        expect([...new Set(hits.map(h => h.file))].sort()).toEqual([
            'features/onboarding/qr/inviteApi.ts',
            'infrastructure/api/resources/AuthResource.ts',
            'infrastructure/farmGeography/BackendFarmGeographyClient.ts',
        ]);
    });

    it('every one of them asks with includePending=true', () => {
        expect(hits.filter(h => !h.ok)).toEqual([]);
    });
});
