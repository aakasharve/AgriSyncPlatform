/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 fix 1, F7) - a waiting or refused हो / नाही / फोटो answer is named in
 * the sync drawer in his words, not by the generic "नोंद" fallback or the wire name.
 */
import { describe, expect, it } from 'vitest';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { mutationLabel } from '../syncDrawerWords';

describe('the sync drawer names a product answer (lane IT4 fix 1, F7)', () => {
    it('AssertInputIdentity_HasItsOwnLabel_InBothLanguages', () => {
        const mr = mutationLabel(SyncMutationName.AssertInputIdentity, 'mr');
        const en = mutationLabel(SyncMutationName.AssertInputIdentity, 'en');
        expect(mr).not.toBe(mutationLabel('some_unknown_type', 'mr'));
        expect(mr).toBe('औषधाबद्दलचं उत्तर');
        expect(en).toBe('Answer about a product');
        expect(en).not.toContain(SyncMutationName.AssertInputIdentity); // never the wire name
        expect(/[A-Za-z]/.test(mr)).toBe(false);
        expect(/[\u0900-\u097F]/.test(en)).toBe(false);
    });
});
