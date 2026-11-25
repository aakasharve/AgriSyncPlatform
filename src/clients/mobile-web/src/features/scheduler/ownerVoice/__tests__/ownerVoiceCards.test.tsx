// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; approved spec "Owner's voice"; P10 offline, doctrine "a message changes nothing by itself") - the owner's
 * three kinds of message in the ONE day-card renderer: a tip is a play button on its work's card; a change is its own card FIRST in the day with "आधी" and "आता" and the
 * buttons; a look is its own card right AFTER its work's card with its two answers, and its follow-up clip plays after the answer. The first full play queues "heard" once;
 * a decision or an answer is queued (it works offline) and shown as waiting until the server's own row comes back; a seat that may not decide sees no decide or answer
 * button; a clip not fetched yet says so in words and draws no player; a change whose new version is not on the phone offers no accept. The audio is a generated silence.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn(() => Promise.reject(new TypeError('offline'))), apiUrl: (p: string) => p }));

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { reconcileOwnerVoice } from '../../../sync/pull/reconcilers/ownerVoiceReconciler';
import { ownItemIdFor } from '../../ownSchedule/ownWorkPlan';
import { DayCardsViewer } from '../../dayCards/DayCardsViewer';
import { keepOwnerClip } from '../ownerVoiceStore';
import { OwnerVoiceHostProvider } from '../useOwnerVoice';
import type { OwnerVoiceHost } from '../ownerVoiceTypes';
import {
    ALL_CLIPS, CHANGE, CYCLE, FARM, FakeAudio, LOOK, M_CHANGE, M_LOOK, M_TIP, PLOT, SHOWN_DAY, TIP, V1_DETAIL, V2_DETAIL, clip, keepVersionCopy, silence, state, SPRAY_OLD,
    C_CHANGE, C_FOLLOW_1, C_TIP, C_LOOK,
} from './ownerFixtures';

const OWNER: OwnerVoiceHost = { farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, mayDecide: true };
const SEAT: OwnerVoiceHost = { farmId: FARM, plotId: PLOT, cropCycleId: null, mayDecide: false };

async function seed(opts: { states?: unknown[]; keep?: string[]; now?: boolean; mine?: boolean } = {}) {
    const db = getDatabase();
    await reconcileOwnerVoice(db, { ownerMessages: [TIP, CHANGE, LOOK], ownerClips: ALL_CLIPS, ownerMessageStates: opts.states ?? [] } as unknown as SyncPullResponse);
    for (const id of opts.keep ?? ALL_CLIPS.map(c => c.id)) await keepOwnerClip(db, clip(id), silence());
    if (opts.now !== false) await keepVersionCopy(V2_DETAIL);
    if (opts.mine) {
        await db.ownScheduleItems.put({ id: ownItemIdFor(CYCLE, 'spray'), farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, taskKey: 'spray', revision: 1, state: 'active', task: SPRAY_OLD, contentHash: 'a'.repeat(64), origin: null, mainVersionId: null, updatedAtUtc: '2026-11-20T00:00:00Z' });
    }
}

const show = (host: OwnerVoiceHost = OWNER) => render(
    <OwnerVoiceHostProvider host={host}><DayCardsViewer source={{ detail: V1_DETAIL }} target={{ day: SHOWN_DAY }} onClose={() => undefined} /></OwnerVoiceHostProvider>,
);
const types = () => screen.getAllByTestId('day-card').map(c => c.getAttribute('data-card-type'));
const queued = async (name: string) => (await getDatabase().mutationQueue.where('mutationType').equals(name).toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
const cardOf = (type: string, text: string) => screen.getAllByTestId('day-card').find(c => c.getAttribute('data-card-type') === type && within(c).queryAllByText(text).length > 0)!;

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

describe('the three kinds in the one renderer', () => {
    it('a tip is a play button on its OWN work\'s card and on no other', async () => {
        await seed();
        show();
        await screen.findByTestId(`tip-play-${M_TIP}`);
        const spray = cardOf('hero', 'फवारणी');
        expect(within(spray).getByTestId(`tip-play-${M_TIP}`)).toBeInTheDocument();
        const dew = cardOf('hero', 'दव तपासणी');
        expect(within(dew).queryByTestId(`tip-play-${M_TIP}`)).toBeNull();
    });

    it('a change is its own card FIRST in the day (right after the day card), with आधी and आता on the two versions', async () => {
        await seed();
        show();
        await screen.findByTestId(`change-card-${M_CHANGE}`);
        expect(types().slice(0, 3)).toEqual(['day', 'ownerChange', 'hero']);
        const card = screen.getByTestId(`change-card-${M_CHANGE}`);
        expect(within(card).getByText('आधी')).toBeInTheDocument();
        expect(await within(card).findByText('आता')).toBeInTheDocument();
        expect(within(screen.getByTestId('change-before')).getByText('फवारणी')).toBeInTheDocument();
        expect(within(screen.getByTestId('change-before')).getByText(/२ ग्रॅम/)).toBeInTheDocument();
        expect(within(screen.getByTestId('change-now')).getByText('फवारणी (नवी)')).toBeInTheDocument();
        expect(within(screen.getByTestId('change-now')).getByText(/३ ग्रॅम/)).toBeInTheDocument();
        expect(within(card).getByText('हा बदल तुम्ही ठरवेपर्यंत तुमचं वेळापत्रक आणि कामं जशीच्या तशी राहतात.')).toBeInTheDocument();
    });

    it('a look is its own card right AFTER its work\'s card, with the two answers in the owner\'s own words', async () => {
        await seed();
        show();
        await screen.findByTestId(`look-card-${M_LOOK}`);
        const all = types();
        const at = screen.getAllByTestId('day-card').findIndex(c => c.getAttribute('data-card-type') === 'ownerLook');
        expect(all[at - 1]).toBe('hero');
        expect(within(screen.getAllByTestId('day-card')[at - 1]).getByText('दव तपासणी')).toBeInTheDocument();
        expect(screen.getByTestId('look-answer-first')).toHaveTextContent('दव आहे');
        expect(screen.getByTestId('look-answer-second')).toHaveTextContent('दव नाही');
        expect(screen.queryByTestId('look-followup-first')).toBeNull();
    });

    it('answering queues ONE schedule.owner_message.answer with exactly the contract fields, and the owner\'s follow-up clip then plays', async () => {
        await seed();
        show();
        fireEvent.click(await screen.findByTestId('look-answer-first'));
        await waitFor(async () => expect(await queued(SyncMutationName.ScheduleOwnerMessageAnswer)).toHaveLength(1));
        const [row] = await queued(SyncMutationName.ScheduleOwnerMessageAnswer);
        expect(row.payload).toEqual({ farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, messageId: M_LOOK, answer: 'first' });
        expect(await screen.findByTestId('look-followup-first')).toBeInTheDocument();
        expect(screen.queryByTestId('look-answer-second')).toBeNull();
        expect(screen.queryByTestId('look-followup-second')).toBeNull();
    });
});

describe('DecisionQueuedOffline: a decision works with no signal and is never claimed before the server says so', () => {
    beforeEach(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); });
    afterEach(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });

    it('accept queues exactly one schedule.owner_message.decide and says "will be sent", not "accepted"', async () => {
        await seed({ mine: true });
        show();
        const accept = await screen.findByTestId('change-accept');
        expect(accept).toHaveTextContent('बदल स्वीकारा');
        fireEvent.click(accept);
        await waitFor(async () => expect(await queued(SyncMutationName.ScheduleOwnerMessageDecide)).toHaveLength(1));
        const [row] = await queued(SyncMutationName.ScheduleOwnerMessageDecide);
        expect(row.payload).toEqual({ farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, messageId: M_CHANGE, decision: 'accept' });
        expect(await screen.findByTestId('change-status')).toHaveTextContent('बदल स्वीकारणार — फोनवर ठेवलं, नेट आल्यावर पाठवलं जाईल');
        expect(screen.queryByText('तुम्ही बदल स्वीकारला')).toBeNull();
        expect(screen.queryByTestId('change-accept')).toBeNull();
        expect(await queued(SyncMutationName.ScheduleOwnerMessageDecide)).toHaveLength(1);
    });

    it('once the server\'s own row comes back it reads as taken, offers "take it back" and no keep-old', async () => {
        await seed({ mine: true, states: [state({ kind: 'accepted', sequence: 1, jobId: 'job-1' })] });
        show();
        expect(await screen.findByTestId('change-status')).toHaveTextContent('तुम्ही बदल स्वीकारला');
        expect(await screen.findByTestId('change-take-back')).toHaveTextContent('बदल परत घ्या');
        expect(screen.queryByTestId('change-keep-old')).toBeNull();
        expect(screen.queryByTestId('change-accept')).toBeNull();
    });

    it('the highest sequence is the standing decision: accepted, then taken back, then accept is offered again', async () => {
        await seed({ mine: true, states: [state({ kind: 'accepted', sequence: 1 }), state({ kind: 'taken_back', sequence: 2 })] });
        show();
        expect(await screen.findByTestId('change-status')).toHaveTextContent('तुम्ही बदल परत घेतला');
        expect(await screen.findByTestId('change-accept')).toBeInTheDocument();
    });

    it('keep the old one queues a keep_old decision', async () => {
        await seed({ mine: true });
        show();
        fireEvent.click(await screen.findByTestId('change-keep-old'));
        await waitFor(async () => expect(await queued(SyncMutationName.ScheduleOwnerMessageDecide)).toHaveLength(1));
        expect((await queued(SyncMutationName.ScheduleOwnerMessageDecide))[0].payload).toMatchObject({ decision: 'keep_old', messageId: M_CHANGE });
    });

    it('for a work only FOLLOWED (not in my schedule) accept reads as taking the NEW one into my schedule', async () => {
        await seed({ mine: false });
        show();
        expect(await screen.findByTestId('change-accept')).toHaveTextContent('नवं माझ्या वेळापत्रकात घ्या');
    });

    it('a change whose new version is not on the phone says so in words and offers no accept (the "now" is never invented)', async () => {
        await seed({ now: false, mine: true });
        show();
        const card = await screen.findByTestId(`change-card-${M_CHANGE}`);
        expect(await within(card).findByText('नवी आवृत्ती अजून फोनवर आलेली नाही. ती आल्यावर इथे स्वीकारता येईल.')).toBeInTheDocument();
        expect(screen.queryByTestId('change-accept')).toBeNull();
        expect(screen.queryByTestId('change-now')).toBeNull();
        expect(within(card).getByText('आधी')).toBeInTheDocument();
    });
});

describe('a seat that may not decide (a worker or a mukadam)', () => {
    it('sees the change and the look but no accept, keep-old, take-back or answer button; may still play', async () => {
        await seed({ mine: true });
        show(SEAT);
        await screen.findByTestId(`change-card-${M_CHANGE}`);
        expect(screen.getByText('हा बदल स्वीकारायचा की नाही ते शेड्यूल पाळणारे मालक ठरवतात.')).toBeInTheDocument();
        for (const id of ['change-accept', 'change-keep-old', 'change-take-back', 'look-answer-first', 'look-answer-second']) expect(screen.queryByTestId(id)).toBeNull();
        expect(within(cardOf('hero', 'फवारणी')).getByTestId(`tip-play-${M_TIP}`)).toBeInTheDocument();
    });
});

describe('heard: the first FULL play queues one schedule.owner_message.heard', () => {
    it('a full play queues exactly the contract fields once; a second full play queues nothing more', async () => {
        await seed();
        show();
        const play = await screen.findByTestId(`tip-play-${M_TIP}`);
        fireEvent.click(play);
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        expect(FakeAudio.all[0].played).toBe(1);
        expect(await queued(SyncMutationName.ScheduleOwnerMessageHeard)).toHaveLength(0);
        await act(async () => { FakeAudio.all[0].fire('ended'); });
        await waitFor(async () => expect(await queued(SyncMutationName.ScheduleOwnerMessageHeard)).toHaveLength(1));
        expect((await queued(SyncMutationName.ScheduleOwnerMessageHeard))[0].payload).toEqual({ farmId: FARM, plotId: PLOT, messageId: M_TIP });

        fireEvent.click(await screen.findByTestId(`tip-play-${M_TIP}`));
        await waitFor(() => expect(FakeAudio.all.length).toBeGreaterThan(1));
        await act(async () => { FakeAudio.all[FakeAudio.all.length - 1].fire('ended'); });
        expect(await queued(SyncMutationName.ScheduleOwnerMessageHeard)).toHaveLength(1);
    });

    it('a partial play (stopped before the end) queues nothing', async () => {
        await seed();
        show();
        fireEvent.click(await screen.findByTestId(`tip-play-${M_TIP}`));
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        fireEvent.click(await screen.findByTestId(`tip-play-${M_TIP}`));
        await act(async () => { await Promise.resolve(); });
        expect(FakeAudio.all[0].paused).toBe(true);
        expect(await queued(SyncMutationName.ScheduleOwnerMessageHeard)).toHaveLength(0);
    });
});

describe('OfflineClipPlays: the kept bytes play with no signal; an unfetched clip says so and draws no player', () => {
    beforeEach(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); });
    afterEach(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });

    it('a clip fetched earlier plays offline from the bytes kept on the phone', async () => {
        await seed({ keep: [C_TIP, C_CHANGE, C_LOOK, C_FOLLOW_1] });
        show();
        fireEvent.click(await screen.findByTestId(`tip-play-${M_TIP}`));
        await waitFor(() => expect(FakeAudio.all).toHaveLength(1));
        expect(FakeAudio.all[0].src).toBe('blob:silence');
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('a clip not fetched yet says so in words and draws no broken player', async () => {
        await seed({ keep: [C_CHANGE] });
        const { container } = show();
        expect(await screen.findByTestId(`tip-not-fetched-${M_TIP}`)).toHaveTextContent('हा आवाज अजून फोनवर आलेला नाही. नेट आल्यावर तो इथे येईल.');
        expect(screen.queryByTestId(`tip-play-${M_TIP}`)).toBeNull();
        expect(container.querySelector('audio')).toBeNull();
    });
});
