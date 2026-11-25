// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, phone half; F215; doctrine P8, P9) - what he said about WHEN fills the one-work maker's
 * "when" card: the day box (through the one day helper), the days after a work (the work only when exactly one matches), the sign words. Every box filled
 * from speech says "बोलण्यातून" and shows the words it was heard from; he can change any of it; saving stays his tap. The parse result is FAKED: no provider
 * is called.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../plannedWork/components/PlanMic', () => ({
    PlanMic: ({ onAudio }: { onAudio: (a: { blob: Blob; base64: string; mimeType: string }) => void }) => (
        <button type="button" data-testid="plan-mic" onClick={() => onAudio({ blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm' })}>mic</button>
    ),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { CropProfile, FarmerProfile } from '../../../../types';
import type { PlanSpeechResult } from '../../../plannedWork/data/planVoice';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { OwnScheduleFlow, type OwnFlow } from '../OwnScheduleFlow';
import { clearWorkDrafts } from '../form/workDraftStore';
import type { OwnWorkPlace } from '../ownWorkPlace';

const PLACE: OwnWorkPlace = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
    plotName: 'मळा',
    cropName: 'Grapes',
};
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: PLACE.plotId, name: 'G1' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [] } as unknown as FarmerProfile;

const timing = (): ScheduleTaskContent['timing'] => ({
    timer: 'none', fromDay: null, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null,
});
const work = (key: string, name: string): ScheduleTaskContent => ({
    taskKey: key, name, kind: 'work', timing: timing(), basis: 'experience', stageIndex: 0, order: 0, why: null, dose: null, steps: [], products: [],
    reEntryHours: null, preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null,
});
const seed = async (t: ScheduleTaskContent) => {
    await getDatabase().ownScheduleItems.put({
        id: `id-${t.taskKey}`, ...PLACE, taskKey: t.taskKey, revision: 1, state: 'active', task: t, contentHash: 'a'.repeat(64), origin: null, mainVersionId: null,
        updatedAtUtc: '2026-11-23T06:00:00Z',
    } as never);
};
const saves = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType.startsWith('ownschedule.'));

type Spoken = Record<string, unknown> | undefined;
const heard = (spokenTimer: Spoken, title = 'फवारणी'): (() => Promise<PlanSpeechResult>) =>
    async () => ({ ok: true, speech: { transcript: 'सगळं बोलणं', title, dueHint: null, ...(spokenTimer ? { spokenTimer } : {}) } }) as unknown as PlanSpeechResult;

const Host: React.FC<{ understand: () => Promise<PlanSpeechResult>; language: 'mr' | 'en' }> = ({ understand, language }) => {
    const [flow, setFlow] = useState<OwnFlow | null>({ page: 'work', place: PLACE, taskKey: null });
    if (!flow) return <p data-testid="flow-closed" />;
    return (
        <OwnScheduleFlow flow={flow} setFlow={setFlow} farmId={PLACE.farmId} language={language} crops={CROPS} farmerProfile={PROFILE}
            understand={understand as never} onLeave={() => setFlow(null)} onSaved={() => undefined} />
    );
};
const speak = async (spokenTimer: Spoken, language: 'mr' | 'en' = 'mr') => {
    render(<Host understand={heard(spokenTimer)} language={language} />);
    fireEvent.click(await screen.findByTestId('own-kind-spray'));
    fireEvent.click(screen.getByTestId('plan-mic'));
    await waitFor(() => expect(screen.getByTestId('own-work-name')).toHaveValue('फवारणी'));
};

beforeEach(async () => {
    clearWorkDrafts();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.referenceData.clear(), db.scheduleSubscriptions.clear(), db.ownScheduleItems.clear(), db.appMeta.clear()]);
});
afterEach(() => cleanup());

const MARK = 'बोलण्यातून';

describe('voice fills the timer of the one-work maker (slice 16)', () => {
    it('day: fromDay 9 shows day १० through the day helper, marked and with the heard words; saving is still his tap', async () => {
        await speak({ kind: 'day', fromDay: 9, heardWords: 'दहाव्या दिवशी' });
        expect(screen.getByTestId('own-when-day')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('own-step-from')).toHaveValue('१०');
        expect(screen.getByTestId('own-spoken-from')).toHaveTextContent(MARK);
        expect(screen.getByTestId('own-spoken-from')).toHaveTextContent('दहाव्या दिवशी');
        expect(await saves()).toHaveLength(0); // nothing is saved by speech alone
        fireEvent.click(screen.getByTestId('own-work-save'));
        await waitFor(async () => expect(await saves()).toHaveLength(1));
        const sent = ((await saves())[0].payload as { task: ScheduleTaskContent }).task;
        expect(sent.timing).toMatchObject({ timer: 'day', fromDay: 9, toDay: null });
    });

    it('after, one work matches: that work is picked and the days are filled, both marked', async () => {
        await seed(work('w-paste', 'पेस्ट लावणे'));
        await seed(work('w-chhatni', 'छाटणी'));
        await speak({ kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 8, heardWords: 'पेस्टनंतर आठ दिवसांनी' });
        await waitFor(() => expect(screen.getByTestId('own-after-w-paste')).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByTestId('own-after-w-chhatni')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-step-usual')).toHaveValue('८');
        expect(screen.getByTestId('own-spoken-after-work')).toHaveTextContent(MARK);
        expect(screen.getByTestId('own-spoken-after-days')).toHaveTextContent(MARK);
        expect(screen.getByTestId('own-spoken-after-days')).toHaveTextContent('पेस्टनंतर आठ दिवसांनी');
    });

    it('after, no work matches: the work stays unpicked and unmarked, the days are kept (the one thing left to ask)', async () => {
        await seed(work('w-chhatni', 'छाटणी'));
        await speak({ kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 8, heardWords: 'पेस्टनंतर आठ दिवसांनी' });
        await waitFor(() => expect(screen.getByTestId('own-step-usual')).toHaveValue('८'));
        expect(screen.getByTestId('own-after-w-chhatni')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId('own-spoken-after-work')).toBeNull();
        expect(screen.getByTestId('own-spoken-after-days')).toHaveTextContent(MARK);
    });

    it('after, two works match: the work stays unpicked (never a guess), the days are kept', async () => {
        await seed(work('w-paste', 'पेस्ट लावणे'));
        await seed(work('w-paste2', 'पेस्ट काढणे'));
        await speak({ kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 8, heardWords: 'पेस्टनंतर आठ दिवसांनी' });
        await waitFor(() => expect(screen.getByTestId('own-step-usual')).toHaveValue('८'));
        expect(screen.getByTestId('own-after-w-paste')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-after-w-paste2')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId('own-spoken-after-work')).toBeNull();
    });

    it('sign: the sign words box is filled, marked, with the heard words', async () => {
        await speak({ kind: 'sign', signWords: 'फूट दिसली', heardWords: 'फूट दिसली की' });
        expect(screen.getByTestId('own-when-sign')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('own-sign-words')).toHaveValue('फूट दिसली');
        expect(screen.getByTestId('own-spoken-sign')).toHaveTextContent(MARK);
        expect(screen.getByTestId('own-spoken-sign')).toHaveTextContent('फूट दिसली की');
    });

    it('unclear (no spokenTimer): the timer boxes stay empty and nothing pretends a timer was heard', async () => {
        await speak(undefined);
        expect(screen.getByTestId('own-when-day')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-when-after')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('own-when-sign')).toHaveAttribute('aria-pressed', 'false');
        expect(document.querySelector('[data-testid^="own-spoken-"]')).toBeNull();
    });

    it('a malformed spokenTimer that reaches the form is ignored', async () => {
        await speak({ kind: 'day', fromDay: 'नऊ', heardWords: 'x' });
        expect(screen.getByTestId('own-when-day')).toHaveAttribute('aria-pressed', 'false');
        expect(document.querySelector('[data-testid^="own-spoken-"]')).toBeNull();
    });

    it('he can change a filled box: the mark goes away from the box he changed', async () => {
        await speak({ kind: 'day', fromDay: 9, heardWords: 'दहाव्या दिवशी' });
        fireEvent.change(screen.getByTestId('own-step-from'), { target: { value: '१२' } });
        expect(screen.getByTestId('own-step-from')).toHaveValue('१२');
        expect(screen.queryByTestId('own-spoken-from')).toBeNull();
    });

    it('English mode: "From your words" and English only', async () => {
        await speak({ kind: 'sign', signWords: 'shoots seen', heardWords: 'when shoots are seen' }, 'en');
        const mark = screen.getByTestId('own-spoken-sign');
        expect(mark).toHaveTextContent('From your words');
        expect(mark).toHaveTextContent('when shoots are seen');
        expect(mark.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
