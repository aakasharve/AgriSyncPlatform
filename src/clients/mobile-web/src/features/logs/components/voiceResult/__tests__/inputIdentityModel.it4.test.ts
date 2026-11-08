/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 fix 1, F5) - which answer a row shows. The check is the SERVER's word;
 * until the server answers, a newer answer of the same person must not lose to his older check.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog, InputIdentityAnswer } from '../../../../../domain/types/log.types';
import { answersOf, statusOf, identityOf } from '../inputIdentityModel';
import type { ProductItem } from '../productModel';

const REF = { eventId: 'ev-1', mixIndex: 0 };
const ITEM: ProductItem = { id: 'm1', matchName: 'कॉन्फिडॉर', ref: REF };
const row = (over: Partial<InputIdentityAnswer>): InputIdentityAnswer => ({
    assertionId: 'a', inputEventId: 'ev-1', mixIndex: 0, verdict: 'confirmed', catalogVersion: 'inputs-2', assertedByUserId: 'owner',
    assertedAtUtc: '2026-11-09T05:00:00.000Z', isCheck: false, ...over,
});
const logWith = (rows: InputIdentityAnswer[]): DailyLog => ({ id: 'L', inputIdentities: rows }) as unknown as DailyLog;

describe('which answer a row shows (lane IT4 fix 1)', () => {
    it('PendingAnswer_NewerThanCheckFromSameUser_WinsUntilAcknowledged', () => {
        const oldCheck = row({ assertionId: 'chk', isCheck: true, verdict: 'confirmed', assertedAtUtc: '2026-11-09T05:00:00.000Z' });
        const newer = row({ assertionId: 'now', verdict: 'rejected', pending: true, assertedAtUtc: '2026-11-09T06:00:00.000Z' });
        const a = answersOf(logWith([oldCheck, newer]), REF);
        expect(a.check?.assertionId).toBe('now'); // his newer word stands in the check slot...
        const status = statusOf(identityOf(ITEM), ITEM, a, true);
        expect(status).toMatchObject({ kind: 'checked', verdict: 'rejected' }); // ...so the row no longer says "confirmed"
        // Once the server answers (same id, now the check), nothing is pending and the server row speaks for itself.
        expect(answersOf(logWith([oldCheck, { ...newer, pending: undefined, isCheck: true }]), REF).check?.assertionId).toBe('now');
    });

    it('a pending answer of ANOTHER user, or an older one, never overrides a check', () => {
        const check = row({ assertionId: 'chk', isCheck: true, assertedByUserId: 'owner', assertedAtUtc: '2026-11-09T05:00:00.000Z' });
        const other = row({ assertionId: 'o', pending: true, assertedByUserId: 'worker', assertedAtUtc: '2026-11-09T06:00:00.000Z' });
        const older = row({ assertionId: 'old', pending: true, assertedByUserId: 'owner', assertedAtUtc: '2026-11-09T04:00:00.000Z' });
        expect(answersOf(logWith([check, other]), REF).check?.assertionId).toBe('chk');
        expect(answersOf(logWith([check, older]), REF).check?.assertionId).toBe('chk');
        expect(answersOf(logWith([check, other]), REF).speaker?.assertionId).toBe('o');
    });
});
