/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; approved spec plr-d10-schedule-approved-spec-2026-11-23) - the pure
 * model behind the one-work cards: a draft becomes ONE task in the one task format, read back by the contract's own parser. Only the work's name and its kind
 * are needed (P9); an unfinished timer is "later", never a refusal; a day the farmer types goes through `storedScheduleDay`; "before pruning" is stored -N.
 */
import { describe, expect, it } from 'vitest';
import { OwnScheduleItemSavePayload } from '../../../../../../../../sync-contract/schemas/payloads/ownschedule_item_save.zod';
import { blankDraft, buildTask, canSave, draftFromTask, type WorkDraft } from '../form/workDraft';

const CTX = { taskKey: 'w-1', order: 0, language: 'mr' as const };
const named = (patch: Partial<WorkDraft> = {}): WorkDraft => ({ ...blankDraft(), kind: 'work', name: 'वांज काढणे', ...patch });
const built = (d: WorkDraft) => {
    const r = buildTask(d, CTX);
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

describe('workDraft: one work becomes one task', () => {
    it('nameAlone_saves: a kind and a name are enough; every other part is empty and the timer is "none"', () => {
        expect(canSave(blankDraft())).toBe(false);
        expect(canSave({ ...blankDraft(), kind: 'work', name: '   ' })).toBe(false);
        expect(canSave(named())).toBe(true);
        const t = built(named());
        expect(t).toMatchObject({ taskKey: 'w-1', name: 'वांज काढणे', kind: 'work', basis: 'experience', stageIndex: 0, order: 0, dose: null, look: null, ask: null });
        expect(t.timing.timer).toBe('none');
        expect(t.timing.repeat).toBe('once');
        // The contract's own payload schema takes it with no extra key.
        const ids = { farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1', plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1', cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1' };
        expect(OwnScheduleItemSavePayload.safeParse({ ...ids, task: t }).success).toBe(true);
    });

    it('threeTimers_payloads: day, after a work, and when seen each write exactly one timer; "later" writes none', () => {
        const day = built(named({ when: 'day', fromShown: 12, toShown: 16 })).timing;
        expect(day).toMatchObject({ timer: 'day', fromDay: 11, toDay: 15, afterTaskKey: null, signWords: null });

        const before = built(named({ when: 'day', dayBefore: true, beforeDays: 20 })).timing;
        expect(before).toMatchObject({ timer: 'day', fromDay: -20, toDay: null });

        const after = built(named({ when: 'after', afterKey: 'w-paste', usualDays: 8, earliestDays: 3 })).timing;
        expect(after).toMatchObject({ timer: 'after', afterTaskKey: 'w-paste', usualDays: 8, earliestDays: 3, fromDay: null, signWords: null });

        const sign = built(named({ when: 'sign', signWords: 'तिसरं पान उघडलं' })).timing;
        expect(sign).toMatchObject({ timer: 'sign', signWords: 'तिसरं पान उघडलं', fromDay: null, afterTaskKey: null });

        expect(built(named({ when: 'later' })).timing.timer).toBe('none');
    });

    it('an unfinished timer never refuses the save: it is kept as "later" (P9)', () => {
        expect(built(named({ when: 'day', fromShown: null })).timing.timer).toBe('none');
        expect(built(named({ when: 'after', afterKey: null, usualDays: 4 })).timing.timer).toBe('none');
        expect(built(named({ when: 'sign', signWords: '  ' })).timing.timer).toBe('none');
    });

    it('a repeat rides on a timer; per week is at most 7 and an empty number is "once"', () => {
        expect(built(named({ when: 'day', fromShown: 2, repeat: 'every_n_days', repeatN: 5 })).timing).toMatchObject({ repeat: 'every_n_days', repeatInterval: 5 });
        expect(built(named({ when: 'day', fromShown: 2, repeat: 'per_week', repeatN: 3 })).timing).toMatchObject({ repeat: 'per_week', repeatInterval: 3 });
        expect(built(named({ when: 'day', fromShown: 2, repeat: 'every_n_days', repeatN: null })).timing).toMatchObject({ repeat: 'once', repeatInterval: null });
        expect(built(named({ when: 'later', repeat: 'every_n_days', repeatN: 5 })).timing).toMatchObject({ repeat: 'once' });
    });

    it('a window that ends before it starts keeps only its first day (never a refusal)', () => {
        expect(built(named({ when: 'day', fromShown: 10, toShown: 4 })).timing).toMatchObject({ fromDay: 9, toDay: null });
    });

    it('how, look and ask fill their own parts, the dose kept as words (P4)', () => {
        const spray = built(named({ kind: 'spray', name: 'केवडा फवारणी', product: 'मॅन्कोझेब', qty: 2, preHarvestDays: 30, steps: 'टाकी भरा\nफवारा', lookWords: 'ठिपके', askWords: 'पान उघडलं का?' }));
        expect(spray.products).toEqual([{ name: 'मॅन्कोझेब', doseAsWritten: 'लिटरला २ ग्रॅम', unit: null, perWhat: null, water: null }]);
        expect(spray.dose).toBeNull();
        expect(spray.preHarvestDays).toBe(30);
        expect(spray.steps).toEqual(['टाकी भरा', 'फवारा']);
        expect(spray.look).toMatchObject({ sign: 'ठिपके' });
        expect(spray.ask).toMatchObject({ question: 'पान उघडलं का?', answers: [] });
        expect(built(named({ kind: 'irrigation', name: 'पाणी', qty: 3 })).dose).toBe('३ तास');
        expect(built(named({ kind: 'observe', name: 'दव पाहा', qty: 10 })).look).toMatchObject({ sample: '१० वेली' });
    });

    it('an edited work keeps every part the cards do not show, and its key and origin', () => {
        const first = built(named({ kind: 'spray', name: 'फवारणी', when: 'sign', signWords: 'पान', product: 'औषध', qty: 2 }));
        const rich = { ...first, why: 'केवडा येतो', warnings: ['हातमोजे'], sources: [{ document: 'पुस्तक', page: '४' }], origin: 'ref:1', reEntryHours: 24, stageIndex: 3, order: 7 };
        const again = buildTask(draftFromTask(rich), { taskKey: rich.taskKey, order: rich.order, language: 'mr' });
        expect(again.ok && again.value).toEqual(rich);
    });
});
