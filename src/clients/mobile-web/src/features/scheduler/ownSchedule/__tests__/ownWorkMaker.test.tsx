// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; approved spec plr-d10-schedule-approved-spec-2026-11-23: one question per
 * card, five kinds, "look" and "ask" questions of their own) - the one-work maker as the farmer drives it: the cards, the outbox they fill
 * (`ownschedule.item.save` / `.remove` through the slice-3 commands), the draft kept on back, the undo on remove, Marathi only with Devanagari digits.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../plannedWork/components/PlanMic', () => ({
    PlanMic: ({ onAudio }: { onAudio: (a: { blob: Blob; base64: string; mimeType: string }) => void }) => (
        <button type="button" data-testid="plan-mic" onClick={() => onAudio({ blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm' })}>माइक</button>
    ),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { CropProfile, FarmerProfile } from '../../../../types';
import type { PlanSpeechResult } from '../../../plannedWork/data/planVoice';
import { OwnScheduleItemSavePayload } from '../../../../../../../../sync-contract/schemas/payloads/ownschedule_item_save.zod';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { OwnScheduleFlow, type OwnFlow } from '../OwnScheduleFlow';
import { OwnWorkList } from '../OwnWorkList';
import { clearWorkDrafts } from '../form/workDraftStore';
import type { OwnWorkPlace } from '../ownWorkPlace';

const PLACE: OwnWorkPlace = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
    plotName: 'मळा', // the farmer's own plot name (data): Marathi here so the Latin check reads only the app's words
    cropName: 'Grapes',
};
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: PLACE.plotId, name: 'G1' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [] } as unknown as FarmerProfile;
const FOLLOWED = '20000000-0000-4000-8000-000000000001';

const timing = (patch: Partial<ScheduleTaskContent['timing']> = {}): ScheduleTaskContent['timing'] => ({
    timer: 'none', fromDay: null, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null, ...patch,
});
const task = (key: string, name: string, patch: Partial<ScheduleTaskContent> = {}): ScheduleTaskContent => ({
    taskKey: key, name, kind: 'work', timing: timing(), basis: 'experience', stageIndex: 0, order: 0, why: null, dose: null, steps: [], products: [],
    reEntryHours: null, preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null, ...patch,
});
async function seedServerWork(t: ScheduleTaskContent) {
    await getDatabase().ownScheduleItems.put({
        id: `id-${t.taskKey}`, ...PLACE, taskKey: t.taskKey, revision: 1, state: 'active', task: t, contentHash: 'a'.repeat(64), origin: null, mainVersionId: null,
        updatedAtUtc: '2026-11-23T06:00:00Z',
    } as never);
}
async function seedFollowedStages() {
    const db = getDatabase();
    await db.referenceData.put({
        key: 'scheduleTemplates', versionHash: 'h', updatedAt: '2026-11-23T00:00:00Z',
        data: [{ id: FOLLOWED, name: 'द्राक्ष शेड्यूल', cropType: 'Grapes', scope: 'Public', hasStoredDays: true,
            stages: [{ name: 'छाटणी', startDay: 0, endDay: 0 }, { name: 'फूट निघणे', startDay: 1, endDay: 40 }, { name: 'मोहोर ते मणी धरणे', startDay: 41, endDay: 55 }], activities: [] }],
    } as never);
    await db.scheduleSubscriptions.put({ id: 'sub-1', farmId: PLACE.farmId, plotId: PLACE.plotId, cropCycleId: PLACE.cropCycleId, templateId: FOLLOWED, referenceDate: '2026-10-15', state: 'Active', adoptedAtUtc: '2026-10-15T00:00:00Z', isMain: true } as never);
}
const saves = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType.startsWith('ownschedule.')).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

const Host: React.FC<{ initial: OwnFlow; understand?: (a: unknown) => Promise<PlanSpeechResult> }> = ({ initial, understand }) => {
    const [flow, setFlow] = useState<OwnFlow | null>(initial);
    const [note, setNote] = useState<string | null>(null);
    if (!flow) {
        return (
            <div>
                <p data-testid="flow-closed">{note}</p>
                <button type="button" data-testid="reopen" onClick={() => setFlow(initial)}>पुन्हा</button>
            </div>
        );
    }
    return (
        <OwnScheduleFlow flow={flow} setFlow={setFlow} farmId={PLACE.farmId} language="mr" crops={CROPS} farmerProfile={PROFILE}
            understand={understand as never} onLeave={() => setFlow(null)} onSaved={setNote} />
    );
};
const openMaker = (understand?: (a: unknown) => Promise<PlanSpeechResult>) =>
    render(<Host initial={{ page: 'work', place: PLACE, taskKey: null }} understand={understand} />);

const typeInto = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const startNamed = async (kind: string, name: string) => {
    if (screen.queryByTestId('own-work-start-blank')) fireEvent.click(screen.getByTestId('own-work-start-blank'));
    fireEvent.click(await screen.findByTestId(`own-kind-${kind}`));
    typeInto('own-work-name', name);
};
const saveAndRead = async () => {
    fireEvent.click(screen.getByTestId('own-work-save'));
    await waitFor(async () => expect((await saves()).length).toBe(1));
    const [row] = await saves();
    return row;
};

afterEach(() => cleanup());

beforeEach(async () => {
    clearWorkDrafts();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.referenceData.clear(), db.scheduleSubscriptions.clear(), db.ownScheduleItems.clear(), db.appMeta.clear()]);
});

describe('the one-work maker (slice 4)', () => {
    it('nameAlone_saves: a kind and a spoken name are enough, the outbox holds exactly one contract-clean save', async () => {
        const understand = vi.fn(async () => ({ ok: true, speech: { transcript: 'वांज काढणे', title: 'वांज काढणे' } }) as unknown as PlanSpeechResult);
        openMaker(understand);
        fireEvent.click(await screen.findByTestId('own-kind-work'));
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('own-work-name')).toHaveValue('वांज काढणे'));
        const row = await saveAndRead();
        expect(row.mutationType).toBe(SyncMutationName.OwnscheduleItemSave);
        expect(Object.keys(row.payload as object).sort()).toEqual(['cropCycleId', 'farmId', 'plotId', 'task']);
        expect(OwnScheduleItemSavePayload.safeParse(row.payload).success).toBe(true);
        const sent = (row.payload as { task: ScheduleTaskContent }).task;
        expect(sent).toMatchObject({ name: 'वांज काढणे', kind: 'work', basis: 'experience' });
        expect(sent.timing.timer).toBe('none');
        await waitFor(() => expect(screen.getByTestId('flow-closed')).toBeInTheDocument());
    });

    it('the save stays off until both the kind and the name are there; nothing optional holds it', async () => {
        openMaker();
        fireEvent.click(await screen.findByTestId('own-kind-spray'));
        expect(screen.getByTestId('own-work-save')).toBeDisabled();
        typeInto('own-work-name', 'फवारणी');
        expect(screen.getByTestId('own-work-save')).toBeEnabled();
        fireEvent.click(screen.getByTestId('own-when-day')); // a timer chosen and left empty never blocks
        expect(screen.getByTestId('own-work-save')).toBeEnabled();
    });

    it('threeTimers_payloads: day (and before pruning), after a work, when seen', async () => {
        await seedServerWork(task('w-paste', 'पेस्ट लावणे'));
        const cases: Array<[string, () => void, Partial<ScheduleTaskContent['timing']>]> = [
            ['दिवस', () => { fireEvent.click(screen.getByTestId('own-when-day')); typeInto('own-step-from', '१२'); typeInto('own-step-to', '16'); }, { timer: 'day', fromDay: 11, toDay: 15 }],
            ['आधी', () => { fireEvent.click(screen.getByTestId('own-when-day')); fireEvent.click(screen.getByTestId('own-day-side-before')); typeInto('own-step-before', '20'); }, { timer: 'day', fromDay: -20, toDay: null }],
            ['नंतर', () => { fireEvent.click(screen.getByTestId('own-when-after')); fireEvent.click(screen.getByTestId('own-after-w-paste')); typeInto('own-step-usual', '8'); }, { timer: 'after', afterTaskKey: 'w-paste', usualDays: 8 }],
            ['खूण', () => { fireEvent.click(screen.getByTestId('own-when-sign')); typeInto('own-sign-words', 'तिसरं पान उघडलं'); }, { timer: 'sign', signWords: 'तिसरं पान उघडलं' }],
        ];
        for (const [name, answer, expected] of cases) {
            await getDatabase().mutationQueue.clear();
            const view = openMaker();
            await startNamed('work', name);
            if (expected.timer === 'after') await screen.findByTestId('own-after-w-paste').catch(() => undefined);
            answer();
            const row = await saveAndRead();
            expect((row.payload as { task: ScheduleTaskContent }).task.timing, name).toMatchObject(expected);
            view.unmount();
        }
    });

    it('a new work never inherits its stage\'s first day', async () => {
        await seedFollowedStages();
        openMaker();
        await startNamed('work', 'घड पाहणे');
        fireEvent.click(await screen.findByTestId('own-stage-2'));
        fireEvent.click(screen.getByTestId('own-when-day'));
        expect(screen.getByTestId('own-step-from')).toHaveValue('');
        expect(screen.getByTestId('own-stage-hint')).toHaveTextContent('दिवस ४२');
        const row = await saveAndRead();
        const sent = (row.payload as { task: ScheduleTaskContent }).task;
        expect(sent.stageIndex).toBe(2);
        expect(sent.timing.timer).toBe('none');
        expect(sent.timing.fromDay).toBeNull();
    });

    it('with no schedule followed, the stage stays open and the maker says so', async () => {
        openMaker();
        await startNamed('work', 'तण काढणे');
        expect(screen.queryByTestId('own-stage-0')).toBeNull();
        expect(screen.getByTestId('own-stage-open-note')).toBeInTheDocument();
    });

    it('backKeepsDraft: going back keeps what was typed; opening again shows it', async () => {
        openMaker();
        await startNamed('nutrition', 'युरिया देणे');
        fireEvent.click(screen.getByTestId('own-when-sign'));
        typeInto('own-sign-words', 'पानं पिवळी');
        fireEvent.click(screen.getByTestId('own-back'));
        fireEvent.click(await screen.findByTestId('reopen'));
        expect(await screen.findByTestId('own-work-name')).toHaveValue('युरिया देणे');
        expect(screen.getByTestId('own-kind-nutrition')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('own-sign-words')).toHaveValue('पानं पिवळी');
        expect(await saves()).toHaveLength(0);
    });

    it('removeHasUndo: removing a work queues the removal and offers to bring it back, which saves it again whole', async () => {
        const kept = task('w-1', 'खुरपणी', { timing: timing({ timer: 'day', fromDay: 4 }) });
        await seedServerWork(kept);
        render(<OwnWorkList place={PLACE} language="mr" onAdd={() => undefined} onEdit={() => undefined} onOpenConflicts={() => undefined} />);
        fireEvent.click(await screen.findByTestId('own-list-remove-w-1'));
        await waitFor(async () => expect((await saves()).map(r => r.mutationType)).toEqual([SyncMutationName.OwnscheduleItemRemove]));
        fireEvent.click(await screen.findByTestId('own-list-undo'));
        await waitFor(async () => expect((await saves()).map(r => r.mutationType)).toEqual([SyncMutationName.OwnscheduleItemRemove, SyncMutationName.OwnscheduleItemSave]));
        const back = (await saves())[1].payload as { task: ScheduleTaskContent };
        expect(back.task).toEqual(kept);
        await waitFor(() => expect(screen.queryByTestId('own-list-undo')).toBeNull());
    });

    it('noEnglishOrLatinDigits: every card and the list read in Marathi with Devanagari digits', async () => {
        await seedFollowedStages();
        await seedServerWork(task('w-paste', 'पेस्ट लावणे', { timing: timing({ timer: 'day', fromDay: 1, toDay: 3, repeat: 'every_n_days', repeatInterval: 2 }) }));
        const latin = /[A-Za-z0-9]/;
        const visible = (root: HTMLElement) => [
            root.textContent ?? '',
            ...Array.from(root.querySelectorAll('[placeholder]')).map(e => e.getAttribute('placeholder') ?? ''),
            ...Array.from(root.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label') ?? ''),
            ...Array.from(root.querySelectorAll('input')).map(e => (e as HTMLInputElement).value),
        ].join(' ');
        const list = render(<OwnWorkList place={PLACE} language="mr" onAdd={() => undefined} onEdit={() => undefined} onOpenConflicts={() => undefined} />);
        await screen.findByTestId('own-list-row-w-paste');
        expect(visible(list.container)).not.toMatch(latin);
        list.unmount();

        const maker = openMaker();
        for (const kind of ['spray', 'nutrition', 'irrigation', 'work', 'observe']) {
            await startNamed(kind, 'काम');
            fireEvent.click(screen.getByTestId('own-when-day'));
            typeInto('own-step-from', '12');
            fireEvent.click(screen.getByTestId('own-repeat-every_n_days'));
            typeInto('own-step-repeat', '5');
            typeInto('own-step-qty', '3');
            expect(screen.getByTestId('own-step-from')).toHaveValue('१२');
            expect(visible(maker.container), kind).not.toMatch(latin);
            fireEvent.click(screen.getByTestId('own-when-after'));
            fireEvent.click(screen.getByTestId('own-when-sign'));
            expect(visible(maker.container), kind).not.toMatch(latin);
        }
    });

    it('editing a work saves the same key; nothing the cards do not show is lost', async () => {
        const rich = task('w-9', 'केवडा फवारणी', { kind: 'spray', why: 'केवडा येतो', warnings: ['हातमोजे'], timing: timing({ timer: 'sign', signWords: 'पान' }) });
        await seedServerWork(rich);
        render(<Host initial={{ page: 'work', place: PLACE, taskKey: 'w-9' }} />);
        await waitFor(() => expect(screen.getByTestId('own-work-name')).toHaveValue('केवडा फवारणी'));
        typeInto('own-work-name', 'केवडा फवारणी १');
        const row = await saveAndRead();
        const sent = (row.payload as { task: ScheduleTaskContent }).task;
        expect(sent).toEqual({ ...rich, name: 'केवडा फवारणी १' });
        await act(async () => undefined);
    });
});
