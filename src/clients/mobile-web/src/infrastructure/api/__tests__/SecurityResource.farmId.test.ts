/**
 * spec: 2026-08-25-prod-cutover-waves (D1)
 *
 * The tenant-DEK routes need a FARM to know which owner account the key belongs
 * to (the JWT carries none). The client must always name one, and must treat the
 * server's "not this account / not your farm" answers as a clean miss.
 */
import { describe, it, expect, vi } from 'vitest';
import { getTenantDek, resolveDek } from '../resources/SecurityResource';
import type { HttpTransport } from '../transport';

const FARM = 'f1111111-1111-4111-8111-111111111111';

function transport(overrides: { get?: unknown; post?: unknown }): HttpTransport {
    return { http: { get: overrides.get, post: overrides.post } } as unknown as HttpTransport;
}

describe('SecurityResource sends the farm the server derives the owner account from', () => {
    it('GET tenant-dek carries farmId as a query parameter', async () => {
        const get = vi.fn().mockResolvedValue({ data: { dekId: 'd', dekBase64: 'AA==', expiresAtUtc: 'x' } });
        await getTenantDek(transport({ get }), FARM);
        expect(get).toHaveBeenCalledWith('/shramsafal/security/tenant-dek', { params: { farmId: FARM } });
    });

    it('POST resolve carries { dekId, farmId }', async () => {
        const post = vi.fn().mockResolvedValue({ data: { dekBase64: 'AA==' } });
        await resolveDek(transport({ post }), 'dek-1', FARM);
        expect(post).toHaveBeenCalledWith('/shramsafal/security/tenant-dek/resolve', { dekId: 'dek-1', farmId: FARM });
    });

    it.each([403, 404])('a %i from resolve is a clean miss (null), not a crash', async status => {
        const post = vi.fn().mockRejectedValue({ response: { status } });
        expect(await resolveDek(transport({ post }), 'dek-1', FARM)).toBeNull();
    });

    it('any other failure still throws', async () => {
        const post = vi.fn().mockRejectedValue({ response: { status: 500 } });
        await expect(resolveDek(transport({ post }), 'dek-1', FARM)).rejects.toBeDefined();
    });
});
