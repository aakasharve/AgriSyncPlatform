// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; slice 10's empty slots filled with real data) - the orange line on the Schedule tab is hidden at 0 unheard
 * and shows "N आवाज" with the right count (and "ऐका") while at least one message of the followed schedule is unheard on THIS plot; "N आवाज" on the tile of the schedule version
 * the messages came from; and the job card (owner and mukadam) plays the clip of the message whose STANDING decision is "accepted" and names that job.
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
import { JobCardClip } from '../JobCardClip';
import { OwnerVoiceLine } from '../OwnerVoiceLine';
import { keepOwnerClip, readOwnerVoice } from '../ownerVoiceStore';
import { unheardCounts } from '../ownerVoiceModel';
import { OwnerVoiceHostProvider } from '../useOwnerVoice';
import type { OwnerVoiceHost } from '../ownerVoiceTypes';
import { ALL_CLIPS, CHANGE, CYCLE, FARM, FakeAudio, JOB, LOOK, M_CHANGE, M_TIP, PLOT, TIP, V1, clip, silence, state, C_CHANGE } from './ownerFixtures';

const HOST: OwnerVoiceHost = { farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, mayDecide: true };
const pullOf = (body: Record<string, unknown>) => body as unknown as SyncPullResponse;

async function seed(messages: unknown[], states: unknown[] = []) {
    const db = getDatabase();
    await reconcileOwnerVoice(db, pullOf({ ownerMessages: messages, ownerClips: ALL_CLIPS, ownerMessageStates: states }));
}

const line = (onListen?: (id: string) => void) => render(
    <OwnerVoiceHostProvider host={HOST}><OwnerVoiceLine versionIds={[V1]} fromNameOf={() => 'श्रमसफल'} onListen={m => onListen?.(m.id)} /></OwnerVoiceHostProvider>,
);

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

describe('the orange line on the Schedule tab', () => {
    it('is hidden at 0 unheard (no messages at all)', async () => {
        const { container } = line();
        await act(async () => { await Promise.resolve(); });
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('owner-voice-line')).toBeNull();
    });

    it('is hidden when every message is already heard on this plot', async () => {
        await seed([TIP, CHANGE], [state({ kind: 'heard', cropCycleId: null, messageId: TIP.id }), state({ kind: 'heard', cropCycleId: null, messageId: CHANGE.id })]);
        const { container } = line();
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(container).toBeEmptyDOMElement();
    });

    it('a message heard on ANOTHER plot is still unheard here', async () => {
        await seed([TIP], [state({ kind: 'heard', cropCycleId: null, messageId: TIP.id, plotId: 'a2a2a2a2-0000-4000-8000-0000000000a2' })]);
        line();
        expect(await screen.findByTestId('owner-voice-line')).toHaveTextContent('१ आवाज');
    });

    it('shows the right count in Devanagari digits with "ऐका", and the count drops when one is heard', async () => {
        await seed([TIP, CHANGE, LOOK], [state({ kind: 'heard', cropCycleId: null, messageId: TIP.id })]);
        const onListen = vi.fn();
        line(onListen);
        const el = await screen.findByTestId('owner-voice-line');
        expect(el).toHaveTextContent('२ आवाज');
        expect(el).toHaveTextContent('श्रमसफल');
        expect(screen.getByTestId('owner-voice-play')).toHaveTextContent('ऐका');
        fireEvent.click(screen.getByTestId('owner-voice-play'));
        expect(onListen).toHaveBeenCalledWith(M_CHANGE);
        await getDatabase().mutationQueue.add({ deviceId: 'd', clientRequestId: 'r1', clientCommandId: 'r1', mutationType: SyncMutationName.ScheduleOwnerMessageHeard, payload: { farmId: FARM, plotId: PLOT, messageId: CHANGE.id }, status: 'PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retryCount: 0 } as never);
        await waitFor(() => expect(screen.getByTestId('owner-voice-line')).toHaveTextContent('१ आवाज'));
    });

    it('counts per schedule version for the tiles ("N आवाज" on the tile it came from), and a version with none is not listed', async () => {
        await seed([TIP, CHANGE, { ...LOOK, scheduleVersionId: '77777777-0000-4000-8000-000000000007' }]);
        const view = await readOwnerVoice(getDatabase());
        expect(unheardCounts(view, PLOT, [V1])).toEqual({ [V1]: 2 });
        expect(unheardCounts(view, PLOT, ['77777777-0000-4000-8000-000000000007'])).toEqual({ '77777777-0000-4000-8000-000000000007': 1 });
        expect(unheardCounts(view, PLOT, ['88888888-0000-4000-8000-000000000008'])).toEqual({});
    });
});

describe('the job card plays the clip of the accepted message', () => {
    const accepted = (over: Record<string, unknown> = {}) => state({ kind: 'accepted', sequence: 1, messageId: M_CHANGE, jobId: JOB, ...over });

    it('a mukadam (no host) sees the play button for the accepted message\'s clip, and a full play queues heard for the state\'s own plot', async () => {
        await seed([CHANGE], [accepted()]);
        await keepOwnerClip(getDatabase(), clip(C_CHANGE), silence());
        render(<JobCardClip jobId={JOB} />);
        const play = await screen.findByTestId('job-clip-play');
        expect(screen.getByText('या कामासाठी शेड्यूल बनवणाऱ्याचा आवाज')).toBeInTheDocument();
        fireEvent.click(play);
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        await act(async () => { FakeAudio.all[0].fire('ended'); });
        await waitFor(async () => expect(await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleOwnerMessageHeard).count()).toBe(1));
        const [row] = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleOwnerMessageHeard).toArray();
        expect(row.payload).toEqual({ farmId: FARM, plotId: PLOT, messageId: M_CHANGE });
    });

    it('draws nothing for a job no accepted message names', async () => {
        await seed([CHANGE], [accepted()]);
        const { container } = render(<JobCardClip jobId="99999999-0000-4000-8000-000000000009" />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing once the standing decision is no longer "accepted" (taken back)', async () => {
        await seed([CHANGE], [accepted(), state({ kind: 'taken_back', sequence: 2, messageId: M_CHANGE })]);
        await keepOwnerClip(getDatabase(), clip(C_CHANGE), silence());
        const { container } = render(<JobCardClip jobId={JOB} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(container).toBeEmptyDOMElement();
    });

    it('a clip not on the phone yet says so in words and draws no player', async () => {
        await seed([CHANGE], [accepted()]);
        const { container } = render(<JobCardClip jobId={JOB} />);
        expect(await screen.findByTestId('job-clip-not-fetched')).toHaveTextContent('हा आवाज अजून फोनवर आलेला नाही. नेट आल्यावर तो इथे येईल.');
        expect(screen.queryByTestId('job-clip-play')).toBeNull();
        expect(container.querySelector('audio')).toBeNull();
    });
});

describe('a message changes nothing by itself', () => {
    it('reading and playing writes no own item, no plan and no queued change except "heard"', async () => {
        await seed([TIP, CHANGE, LOOK]);
        const db = getDatabase();
        await keepOwnerClip(db, clip(C_CHANGE), silence());
        line();
        await screen.findByTestId('owner-voice-line');
        expect(await db.ownScheduleItems.count()).toBe(0);
        expect(await db.plannedWork.count()).toBe(0);
        expect(await db.mutationQueue.count()).toBe(0);
        expect(M_TIP).toBeTruthy();
    });
});
