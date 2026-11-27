/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.4) - a kinds-of-work refusal that still comes (a limit this phone had
 * not heard of yet, an older phone): `ShramSafal.WorkKind.Forbidden`. It is parked PERMANENTLY by its `Forbidden` tail (no new code entry: the same
 * rule the released phone already has), and it is worded: on the parked row "ही कामं तुम्हाला नोंदवता येत नाहीत. नोंद फोनवर राखून ठेवली आहे.", and
 * on the owner's kept-work card (refused, and arrived after the limit changed: why "WorkKinds").
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection } from '../../../infrastructure/sync/RejectionPolicy';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { refusalHint, refusalReasonOf } from '../../logs/components/correction/refusedRevision';
import { keptItemWords } from '../../relationships/KeptWorkAttention';
import { relationshipCopy } from '../../relationships/relationshipCopy';
import type { KeptWorkItem } from '../../relationships/keptWorkClient';

const CODE = 'ShramSafal.WorkKind.Forbidden';

describe('PERM S4.4 - a WorkKind refusal', () => {
    it('a WorkKind refusal parks permanently with its words', () => {
        // the FORBIDDEN tail: permanent, the same rule every installed phone already applies
        expect(categorizeRejection({ errorCode: CODE })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: null, errorMessage: `${CODE}: By ShramSafal's rules this kind of work could not be saved for this person.` })).toBe('PERMANENT');
        expect(refusalReasonOf(CODE)).toBe('kindClosed');
        for (const type of [SyncMutationName.CreateDailyLog, SyncMutationName.AddCostEntry, SyncMutationName.AddLogTask, SyncMutationName.ReviseLogContent]) {
            expect(refusalHint(type, CODE, 'mr')).toBe('ही कामं तुम्हाला नोंदवता येत नाहीत. नोंद फोनवर राखून ठेवली आहे.');
            expect(refusalHint(type, CODE, 'en')).toBe('You may not record these kinds of work. The record is kept on this phone.');
        }
    });

    it('the owner\'s kept-work card says why it was kept, and why it arrived late', () => {
        const refused = { kind: 'refused', what: SyncMutationName.CreateDailyLog, why: CODE, whoName: 'रमेश', atUtc: '2026-11-27T05:00:00Z' } as unknown as KeptWorkItem;
        expect(keptItemWords(refused, relationshipCopy('mr'), 'mr').why).toBe('ठेवण्याचं कारण: हे काम नोंदवण्याची परवानगी त्यांच्याकडे नव्हती');
        expect(keptItemWords(refused, relationshipCopy('en'), 'en').why).toBe('Why it was kept: they were not allowed to record this kind of work');
        const late = { kind: 'arrived_late', what: SyncMutationName.CreateDailyLog, why: 'WorkKinds', whoName: 'रमेश', atUtc: '2026-11-27T05:00:00Z' } as unknown as KeptWorkItem;
        expect(keptItemWords(late, relationshipCopy('mr'), 'mr').why).toBe('जबाबदारी संपल्यानंतर पोहोचलं (काय नोंदवू शकतात)');
        expect(keptItemWords(late, relationshipCopy('en'), 'en').why).toBe('Arrived after the responsibility ended (kinds of work they may record)');
    });
});
