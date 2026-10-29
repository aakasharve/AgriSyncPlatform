/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec R-11 (c) — the one plain Marathi line, for the owner AND a worker.
 */

import { describe, it, expect } from 'vitest';
import { heldWorkLine, HELD_WORK_COPY } from '../HeldWorkNotice';
import { countHeldRows } from '../../../sync/hooks/useHeldWorkCount';
import { evaluateEntitlement } from '../../../../core/entitlement/useEntitlement';
import type { SubscriptionSnapshotDto } from '../../../onboarding/qr/inviteApi';

const expired: SubscriptionSnapshotDto = {
    statusCode: 4, status: 'Expired', planCode: 'shramsafal_pro',
    validUntilUtc: '2026-10-01T00:00:00Z', allowsOwnerWrites: false,
};
const extended: SubscriptionSnapshotDto = {
    ...expired, allowsOwnerWrites: true, accessExtendedUntilUtc: '2026-12-31T18:30:00Z',
};
const trial: SubscriptionSnapshotDto = {
    statusCode: 1, status: 'Trialing', planCode: 'shramsafal_pro',
    validUntilUtc: '2099-01-01T00:00:00Z', allowsOwnerWrites: true,
};

describe('heldWorkLine', () => {
    it('tells anyone holding refused work how many records are safe on the phone (Marathi digits)', () => {
        expect(heldWorkLine(3, { role: 'Worker', subscription: trial })).toBe(HELD_WORK_COPY.held(3));
        expect(HELD_WORK_COPY.held(12)).toContain('१२');
    });

    it.each(['PrimaryOwner', 'SecondaryOwner', 'Mukadam', 'Worker'])(
        'says the farm is held for a %s too when the snapshot refuses new work',
        (role) => {
            expect(heldWorkLine(0, { role, subscription: expired })).toBe(HELD_WORK_COPY.blocked);
        });

    it('says nothing while an access extension keeps the farm working', () => {
        expect(heldWorkLine(0, { role: 'Worker', subscription: extended })).toBeNull();
        expect(heldWorkLine(0, { role: 'PrimaryOwner', subscription: trial })).toBeNull();
    });

    it('never reads a MISSING snapshot (older server, or none) as "blocked"', () => {
        expect(heldWorkLine(0, { role: 'PrimaryOwner', subscription: null })).toBeNull();
        expect(heldWorkLine(0, null)).toBeNull();
    });
});

describe('countHeldRows', () => {
    const FARM = 'farm-a';

    it('counts open rows carrying a held entitlement code, nothing else', () => {
        expect(countHeldRows([
            { status: 'FAILED', errorCode: 'entitlement.subscriptionexpired', farmId: FARM },
            { status: 'PENDING', errorCode: 'entitlement.subscriptionexpired', farmId: FARM },
            { status: 'SENDING', errorCode: 'entitlement.subscriptionsuspended', farmId: FARM },
            { status: 'APPLIED', errorCode: 'entitlement.subscriptionexpired', farmId: FARM },
            { status: 'REJECTED_USER_REVIEW', errorCode: 'entitlement.subscriptionexpired', farmId: FARM },
            { status: 'FAILED', errorCode: 'entitlement.nomembership', farmId: FARM },
            { status: 'FAILED', errorCode: undefined, farmId: FARM },
        ], FARM)).toBe(3);
    });

    it("counts only the OPEN farm's held rows — another owner's farm being held says nothing here (M2)", () => {
        const held = 'entitlement.subscriptionexpired';
        const rows = [
            { status: 'FAILED' as const, errorCode: held, farmId: 'farm-b' },
            { status: 'FAILED' as const, errorCode: held, farmId: 'farm-b' },
            // A row queued by an older app: no stamp, the payload names the farm.
            { status: 'FAILED' as const, errorCode: held, payload: { farmId: 'farm-b' } },
            // A row that names no farm at all is claimed by none.
            { status: 'FAILED' as const, errorCode: held, payload: { logId: 'x' } },
        ];
        expect(countHeldRows(rows, 'farm-b')).toBe(3);
        expect(countHeldRows(rows, FARM)).toBe(0);
        expect(heldWorkLine(countHeldRows(rows, FARM), { role: 'Worker', subscription: trial })).toBeNull();
        expect(countHeldRows(rows, null)).toBe(0);
    });
});

describe('evaluateEntitlement (wired; the worker exemption was false)', () => {
    it('gates a worker on an expired farm exactly like the owner — as the server does', () => {
        expect(evaluateEntitlement(expired, 'Worker', 'write')).toEqual({ allowed: false, reason: 'subscription_expired' });
        expect(evaluateEntitlement(expired, 'PrimaryOwner', 'write')).toEqual({ allowed: false, reason: 'subscription_expired' });
    });

    it('allows when the server says writes are allowed (trial, or an access extension)', () => {
        expect(evaluateEntitlement(extended, 'Worker', 'write').allowed).toBe(true);
        expect(evaluateEntitlement(trial, 'Worker', 'ai').allowed).toBe(true);
    });

    it('reading is always allowed', () => {
        expect(evaluateEntitlement(expired, 'Worker', 'read').allowed).toBe(true);
    });
});
