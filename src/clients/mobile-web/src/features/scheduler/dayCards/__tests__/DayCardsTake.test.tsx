// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9; approved spec decision 5 "following open after the check", decision 2 one take button) - the ONE renderer
 * hosts "माझ्या वेळापत्रकात घ्या" on the hero card of a work, only when the viewer was opened for a FOLLOWED, CHECKED reference of a place (a `take` prop), only from
 * today onward; never on an unchecked reference, never on an own schedule, never on a past day, and never without `take` (the planning and job-card doors).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { DayCardsViewer } from '../DayCardsViewer';
import type { TakeHost } from '../../ownSchedule/TakeIntoMyScheduleButton';
import { shownDayOfStored, type DayCardsDetail } from '../dayCardsTypes';

const task = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({ taskKey: 't', name: 'काम', kind: 'work', basis: 'stated', timing: { timer: 'day', fromDay: 10, toDay: 10, repeat: 'once' }, sources: [{ document: 'पुस्तिका' }], ...over });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};
const FUTURE = task({ taskKey: 'f', name: 'पुढचं काम', timing: { timer: 'day', fromDay: 12, toDay: 12, repeat: 'once' } });
const PAST = task({ taskKey: 'p', name: 'आधीचं काम', timing: { timer: 'day', fromDay: 3, toDay: 3, repeat: 'once' } });

const detailOf = (kind: 'reference' | 'own', checked: boolean): DayCardsDetail => ({
    templateId: 'd0d0d0d0-0000-4000-8000-0000000000a1', chainId: null, version: 1, contentHash: 'h', kind, name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'संस्था' }, check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: checked ? 'तपासनीस' : null, checkedAtUtc: null },
    stages: [{ index: 0, name: 'छाटणी', from: shownDayOfStored(0)!, to: shownDayOfStored(40)!, startSign: null, endSign: null }],
    tasks: [FUTURE, PAST].map(t => ({ task: t, contentHash: 'x', shown: { from: shownDayOfStored(t.timing.fromDay), to: shownDayOfStored(t.timing.toDay), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked })),
    challenges: [], skipped: 0,
});

const take: TakeHost = {
    place: { farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1', plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1', cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1' },
    mayTake: true,
    planning: { mayAssign: false, assignees: [], myUserId: 'b0b0b0b0-0000-4000-8000-0000000000b1' },
    todayStored: 10,
};

const open = (detail: DayCardsDetail, key: string, host?: TakeHost) =>
    render(<DayCardsViewer source={{ detail }} target={{ taskKey: key }} onClose={() => undefined} take={host} />);

afterEach(() => cleanup());
beforeEach(async () => { await resetDatabase(); await getDatabase().mutationQueue.clear(); });

describe('the take button in the one renderer', () => {
    it('shows on the hero card of a work from today onward, for a checked followed reference with a place', async () => {
        open(detailOf('reference', true), 'f', take);
        expect(await screen.findByTestId('take-btn-f')).toBeInTheDocument();
        expect(screen.getAllByTestId('day-card').filter(c => c.getAttribute('data-card-type') === 'hero')).toHaveLength(1);
    });

    it('never on an unchecked reference', async () => {
        open(detailOf('reference', false), 'f', take);
        await screen.findAllByTestId('day-card');
        expect(screen.queryByTestId('take-f')).toBeNull();
    });

    it('never on an own schedule', async () => {
        open(detailOf('own', true), 'f', take);
        await screen.findAllByTestId('day-card');
        expect(screen.queryByTestId('take-f')).toBeNull();
    });

    it('never on a past day', async () => {
        open(detailOf('reference', true), 'p', take);
        await screen.findAllByTestId('day-card');
        expect(screen.queryByTestId('take-p')).toBeNull();
    });

    it('never without take (the planning and job-card doors): the deck stays exactly as it was', async () => {
        open(detailOf('reference', true), 'f');
        await screen.findAllByTestId('day-card');
        expect(screen.queryByTestId('take-f')).toBeNull();
    });

    it('a seat that may not take sees none; a take names the detail\'s version', async () => {
        const { unmount } = open(detailOf('reference', true), 'f', { ...take, mayTake: false });
        await screen.findAllByTestId('day-card');
        expect(screen.queryByTestId('take-f')).toBeNull();
        unmount();
        open(detailOf('reference', true), 'f', take);
        (await screen.findByTestId('take-btn-f')).click();
        await waitFor(async () => expect((await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.ScheduleTakeTask)).toHaveLength(1));
        const row = (await getDatabase().mutationQueue.toArray()).find(r => r.mutationType === SyncMutationName.ScheduleTakeTask)!;
        expect(row.payload).toMatchObject({ sourceVersionId: 'd0d0d0d0-0000-4000-8000-0000000000a1', taskKey: 'f' });
    });
});
