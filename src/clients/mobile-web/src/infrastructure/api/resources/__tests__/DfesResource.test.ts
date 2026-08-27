/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DfesResource.getDayUnderstanding — unit tests (dfes-companion-2026-07-11 Slice 3b).
 *
 * Proves the client:
 *   - hits GET /shramsafal/day-understanding with the farmId (and date when given),
 *   - URL-encodes the farmId,
 *   - parses `{ score }` for a real score AND for null (not-enough-understood),
 *   - carries NO lens fields across the boundary (wire shape is `{ score }` only),
 *   - propagates transport errors (so the hook can fall to the gentle pending state
 *     rather than inventing a number).
 */
import { describe, it, expect, vi } from 'vitest';
import { getDayUnderstanding } from '../DfesResource';
import type { HttpTransport } from '../../transport';

function makeTransport(get: ReturnType<typeof vi.fn>): HttpTransport {
    return {
        http: { get } as unknown as HttpTransport['http'],
        authHttp: {} as HttpTransport['authHttp'],
    };
}

describe('DfesResource.getDayUnderstanding', () => {
    it('GETs /shramsafal/day-understanding with farmId + date and parses the score', async () => {
        const get = vi.fn().mockResolvedValue({ data: { score: 7 } });
        const result = await getDayUnderstanding(makeTransport(get), 'farm-1', '2026-07-11');

        expect(get).toHaveBeenCalledWith('/shramsafal/day-understanding?farmId=farm-1&date=2026-07-11');
        expect(result).toEqual({ score: 7 });
    });

    it('omits the date param when no date is supplied (server defaults to today)', async () => {
        const get = vi.fn().mockResolvedValue({ data: { score: 4 } });
        await getDayUnderstanding(makeTransport(get), 'farm-1');

        expect(get).toHaveBeenCalledWith('/shramsafal/day-understanding?farmId=farm-1');
    });

    it('URL-encodes the farmId', async () => {
        const get = vi.fn().mockResolvedValue({ data: { score: 1 } });
        await getDayUnderstanding(makeTransport(get), 'farm/with space');

        expect(get).toHaveBeenCalledWith('/shramsafal/day-understanding?farmId=farm%2Fwith%20space');
    });

    it('parses a null score (not-enough-understood) without inventing a number', async () => {
        const get = vi.fn().mockResolvedValue({ data: { score: null } });
        const result = await getDayUnderstanding(makeTransport(get), 'farm-1', '2026-07-11');

        expect(result).toEqual({ score: null });
        expect(result.score).toBeNull();
    });

    it('carries ONLY { score } across the boundary — no internal lenses', async () => {
        const get = vi.fn().mockResolvedValue({ data: { score: 6 } });
        const result = await getDayUnderstanding(makeTransport(get), 'farm-1', '2026-07-11');

        // The 3 internal lenses must never reach the client. The parsed DTO shape is score-only.
        expect(Object.keys(result)).toEqual(['score']);
    });

    it('propagates transport errors (offline / server error)', async () => {
        const get = vi.fn().mockRejectedValue(new Error('offline'));

        await expect(getDayUnderstanding(makeTransport(get), 'farm-1', '2026-07-11')).rejects.toThrow('offline');
    });
});
