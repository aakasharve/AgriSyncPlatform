/**
 * Team actions (spec: 2026-08-25-prod-cutover-waves): the two wire calls the Team page
 * adds to the existing field-operator client.
 *   - create can carry a CLIENT-CHOSEN id (idempotent retry; the server keys on the id,
 *     never on the name) and still omits it for the older callers.
 *   - deactivate ("Remove") is a POST to the farm-scoped route, never a DELETE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: vi.fn(), post: (...a: unknown[]) => mockPost(...a), delete: vi.fn() } },
}));

import {
    createFieldOperator,
    deactivateFieldOperator,
    deactivateFieldOperatorPath,
} from '../data/fieldOperatorClient';

const created = {
    id: 'op-1', displayName: 'Ramesh', fullName: null, originatingFarmId: 'f1',
    createdByUserId: 'u1', createdAtUtc: '2026-10-13T00:00:00Z', isActive: true,
};

describe('fieldOperatorClient team actions', () => {
    beforeEach(() => { mockPost.mockReset(); });

    it('create sends the client-chosen id when given', async () => {
        mockPost.mockResolvedValue({ data: created });
        const r = await createFieldOperator('f1', ' Ramesh ', undefined, 'op-1');
        expect(mockPost).toHaveBeenCalledWith('/shramsafal/farms/f1/labour/field-operators', { displayName: 'Ramesh', id: 'op-1' });
        expect(r).toEqual({ id: 'op-1', displayName: 'Ramesh', fullName: undefined, isActive: true });
    });

    it('create without an id sends exactly what it always sent', async () => {
        mockPost.mockResolvedValue({ data: created });
        await createFieldOperator('f1', 'Ramesh', 'Ramesh Patil');
        expect(mockPost).toHaveBeenCalledWith('/shramsafal/farms/f1/labour/field-operators', { displayName: 'Ramesh', fullName: 'Ramesh Patil' });
    });

    it('deactivate POSTs to the farm-scoped deactivate route and maps the answer', async () => {
        mockPost.mockResolvedValue({ data: { ...created, isActive: false } });
        expect(deactivateFieldOperatorPath('f1', 'op-1')).toBe('/shramsafal/farms/f1/labour/field-operators/op-1/deactivate');
        const r = await deactivateFieldOperator('f1', 'op-1');
        expect(mockPost).toHaveBeenCalledWith('/shramsafal/farms/f1/labour/field-operators/op-1/deactivate');
        expect(r).toEqual({ id: 'op-1', displayName: 'Ramesh', fullName: undefined, isActive: false });
    });

    it('a rejected call propagates (no pretend success)', async () => {
        mockPost.mockImplementation(() => Promise.reject(new Error('network')));
        let caught: unknown = null;
        try { await deactivateFieldOperator('f1', 'op-1'); } catch (e) { caught = e; }
        expect((caught as Error).message).toBe('network');
    });
});
