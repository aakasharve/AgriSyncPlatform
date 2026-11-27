/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.1; founder 27 Nov "kinds of work he may record") - the phone reads
 * the kinds of work a seat may record from the pull's access scope (`workKinds`, written only for a limited seat) and answers "every kind" when it
 * does not know: no scope yet, a farm the answer does not cover, an older server. The server decides again on every write.
 */
import { describe, expect, it } from 'vitest';
import kinds from '../../../../../../../sync-contract/schemas/work-kinds.json';
import type { FarmAccessScopeDto } from '../../../infrastructure/api/accessScopeDtos';
import type { StoredAccessScopes } from '../../../infrastructure/storage/accessScopeStore';
import {
    ALWAYS_OPEN_WORK_KINDS, LIMITABLE_WORK_KINDS, allowedWorkKinds, closedKindsOf, mayRecordKind,
} from '../workKinds';

const A = 'aaaa0000-0000-4000-8000-00000000000a';
const B = 'bbbb0000-0000-4000-8000-00000000000b';
const scope = (farmId: string, over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true, ...over,
});
const stored = (...scopes: FarmAccessScopeDto[]): StoredAccessScopes => ({ receivedAtUtc: '2026-11-27T10:00:00Z', scopes });

describe('PERM S4.1 - the kinds of work a seat may record', () => {
    it('the phone constant is the contract file, in its order', () => {
        expect([...LIMITABLE_WORK_KINDS]).toEqual(kinds.limitable);
        expect([...ALWAYS_OPEN_WORK_KINDS]).toEqual(kinds.alwaysOpen);
    });

    it('absent workKinds means every kind', () => {
        expect(allowedWorkKinds(stored(scope(A)), A)).toBeNull();
        expect(allowedWorkKinds(null, A)).toBeNull();
        expect(allowedWorkKinds(stored(scope(A, { workKinds: null })), A)).toBeNull();
        for (const k of LIMITABLE_WORK_KINDS) expect(mayRecordKind(stored(scope(A)), A, k)).toBe(true);
        // a farm the answer does not cover, and no farm at all: not known, so every kind (the server decides)
        expect(allowedWorkKinds(stored(scope(A, { workKinds: ['irrigation'] })), B)).toBeNull();
        expect(allowedWorkKinds(stored(scope(A, { workKinds: ['irrigation'] })), null)).toBeNull();
    });

    it('the open farm\'s limit is read, not another farm\'s', () => {
        const both = stored(scope(A, { workKinds: ['irrigation', 'inputs'] }), scope(B));
        expect([...(allowedWorkKinds(both, A) ?? [])]).toEqual(['irrigation', 'inputs']);
        expect(mayRecordKind(both, A, 'cropActivities')).toBe(false);
        expect(mayRecordKind(both, A, 'irrigation')).toBe(true);
        expect(mayRecordKind(both, B, 'cropActivities')).toBe(true);
    });

    it('observations and reminders are always open; an unknown name in the answer is never a kind he gains', () => {
        const limited = stored(scope(A, { workKinds: ['irrigation', 'somethingNew'] }));
        expect(mayRecordKind(limited, A, 'observations')).toBe(true);
        expect(mayRecordKind(limited, A, 'plannedTasks')).toBe(true);
        expect([...(allowedWorkKinds(limited, A) ?? [])]).toEqual(['irrigation']);
    });

    it('closedKindsOf names the closed kinds a record carries, in the contract order', () => {
        const log = { cropActivities: [{ id: 'c' }], irrigation: [{ id: 'i' }], labour: [{ id: 'l' }], inputs: [], machinery: [], observations: [{ id: 'o' }] };
        expect(closedKindsOf(log, new Set(['irrigation']))).toEqual(['cropActivities', 'labour']);
        expect(closedKindsOf(log, null)).toEqual([]);
    });
});
