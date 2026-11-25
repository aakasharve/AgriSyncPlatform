// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, CTO gate after the real-app drive) - the design says "Tap Schedule, then Listen on the orange line. The clip
 * plays on its own card" and "the owner's follow-up plays after the answer". The drive found both waiting for a second tap. Here: the message Listen named starts by itself,
 * nothing else does, the follow-up starts right after the answer, and a phone that blocks a start by itself keeps the play button with no error words.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn(() => Promise.reject(new TypeError('offline'))), apiUrl: (p: string) => p }));

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { reconcileOwnerVoice } from '../../../sync/pull/reconcilers/ownerVoiceReconciler';
import { DayCardsViewer } from '../../dayCards/DayCardsViewer';
import { keepOwnerClip } from '../ownerVoiceStore';
import { OwnerAutoPlayProvider, OwnerVoiceHostProvider } from '../useOwnerVoice';
import { ownerVoiceWords } from '../ownerVoiceWords';
import type { OwnerVoiceHost } from '../ownerVoiceTypes';
import { ALL_CLIPS, CHANGE, CYCLE, FARM, FakeAudio, LOOK, M_TIP, PLOT, SHOWN_DAY, TIP, V1_DETAIL, V2_DETAIL, clip, keepVersionCopy, silence } from './ownerFixtures';

const OWNER: OwnerVoiceHost = { farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, mayDecide: true };
const WORDS = ownerVoiceWords('mr');

class BlockedAudio extends FakeAudio {
    play() { this.played += 1; return Promise.reject(Object.assign(new Error('play() needs a tap'), { name: 'NotAllowedError' })); }
}

async function seed() {
    const db = getDatabase();
    await reconcileOwnerVoice(db, { ownerMessages: [TIP, CHANGE, LOOK], ownerClips: ALL_CLIPS, ownerMessageStates: [] } as unknown as SyncPullResponse);
    for (const c of ALL_CLIPS) await keepOwnerClip(db, clip(c.id), silence());
    await keepVersionCopy(V2_DETAIL);
}

const show = (autoPlayId: string | null) => render(
    <OwnerVoiceHostProvider host={OWNER}>
        <OwnerAutoPlayProvider value={autoPlayId}>
            <DayCardsViewer source={{ detail: V1_DETAIL }} target={{ day: SHOWN_DAY }} onClose={() => undefined} />
        </OwnerAutoPlayProvider>
    </OwnerVoiceHostProvider>,
);
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
    FakeAudio.all = [];
    vi.stubGlobal('Audio', FakeAudio);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:silence') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Listen starts the clip on its own card', () => {
    it('the message Listen named starts by itself, and only that one; its full play queues heard once', async () => {
        await seed();
        show(M_TIP);
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        expect(FakeAudio.all[0].played).toBe(1);
        expect(await screen.findByTestId(`tip-play-${M_TIP}`)).toHaveTextContent(WORDS.stop);
        await settle();
        expect(FakeAudio.all).toHaveLength(1);

        await act(async () => { FakeAudio.all[0].fire('ended'); });
        await waitFor(async () => {
            const heard = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleOwnerMessageHeard).toArray();
            expect(heard.map(r => (r.payload as { messageId: string }).messageId)).toEqual([M_TIP]);
        });
    });

    it('with no Listen, nothing starts without its own tap', async () => {
        await seed();
        show(null);
        expect(await screen.findByTestId(`tip-play-${M_TIP}`)).toHaveTextContent(WORDS.listen);
        await settle();
        expect(FakeAudio.all).toHaveLength(0);
    });

    it('a phone that blocks a start by itself keeps the play button and shows no error words', async () => {
        vi.stubGlobal('Audio', BlockedAudio);
        await seed();
        show(M_TIP);
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        await settle();
        expect(screen.getByTestId(`tip-play-${M_TIP}`)).toHaveTextContent(WORDS.listen);
        expect(screen.queryByText(WORDS.cannotPlay)).toBeNull();
    });
});

describe('the look\'s follow-up plays after the answer', () => {
    it('starts by itself right after the answer, with no second tap', async () => {
        await seed();
        show(null);
        fireEvent.click(await screen.findByTestId('look-answer-first'));
        expect(await screen.findByTestId('look-followup-first')).toBeInTheDocument();
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        expect(FakeAudio.all[0].played).toBe(1);
        expect(screen.getByTestId('look-followup-play-first')).toHaveTextContent(WORDS.stop);
    });
});
