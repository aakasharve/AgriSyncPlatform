// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5 fix pass 1; F1, F2, F4) - "पाहिलं" on an "आधी हे पाहा" card against the REAL sync
 * queue and a real Dexie (fake-indexeddb); only the sync worker and the farm's authorities are stood in for.
 *   F1 - a refused or given-up acknowledge is queued AGAIN on the next tap; a double tap while one waits is one request.
 *   F2 - "पाहिलं" is drawn only for a seat that holds ConfirmRecords (the server refuses everyone else); the card and its words stay.
 *   F4 - while the acknowledge is merely queued (waiting, sending, retrying) the card stays hidden: after an app restart, after a pull
 *        that lands before the push drains, and with a phone clock behind the server's.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const farm = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() } }));
vi.mock('../../../core/session/FarmContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: 'f1', currentFarm: farm.current }),
}));

import AttentionPage from '../pages/AttentionPage';
import MixAlertCard from '../components/MixAlertCard';
import { AttentionStrip } from '../components/AttentionStrip';
import { useAttentionModel } from '../hooks/useAttentionModel';
import { acknowledgeMixAlert, acknowledgeRequestId } from '../data/acknowledgeMixAlert';
import { clearSeenSignalsForTests, markSignalSeen } from '../seenSignals';
import { INPUT_MIX_RULE_CODE } from '../attentionItems';
import { getDatabase, resetDatabase, type AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';

const SIGNAL = '6f1d8f2e-4c1a-4a52-9d0e-1b2c3d4e5f60';
const holder = { role: 'CoOwner', authorities: [{ name: 'ConfirmRecords' }] };
const worker = { role: 'Worker', authorities: [{ name: 'TakeAttendance' }] };

const mixCard = (extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => ({
    cardId: 'mix', farmId: 'f1', farmName: 'शेत', plotId: 'p1', plotName: 'प्लॉट १', rank: 0, computedAtUtc: '2026-11-09T03:30:00.000Z',
    titleEn: 'x', titleMr: 'हे मिश्रण चुकीचं आहे', descriptionEn: 'x', descriptionMr: 'दोघं मिळून घट्ट साका बनतो.', suggestedAction: 0,
    suggestedActionLabelEn: 'x', suggestedActionLabelMr: 'तुकडा पहा', topSignalId: SIGNAL, topSignalRuleCode: INPUT_MIX_RULE_CODE, ...extra,
});

const rowsOf = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.ComplianceAcknowledge);

/** The phone's board as a pull leaves it: the cards, and a sync cursor. */
const putBoard = async (cards: AttentionCardCacheRecord[]) => {
    const db = getDatabase();
    await db.attentionCards.clear();
    await db.attentionCards.bulkPut(cards);
    await db.syncCursors.put({ tableName: 'shramsafal', lastSyncAt: '2026-11-09T03:30:00.000Z', version: 1 } as never);
};

/** What the three surfaces show: the page, the strip and the bottom-bar total (one list, `useAttentionModel`). */
const Total: React.FC = () => <span data-testid="bottom-total">{useAttentionModel([], []).total}</span>;
const Surfaces: React.FC = () => (
    <>
        <AttentionPage onGo={vi.fn()} />
        <AttentionStrip tasks={[]} crops={[]} onOpen={vi.fn()} />
        <Total />
    </>
);

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T06:00:00.000Z'));
    farm.current = holder;
    clearSeenSignalsForTests();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('F1 - a refused acknowledge is queued again', () => {
    it('Seen_QueuesComplianceAcknowledge: the first tap queues ONE pending request; a double tap while it waits is the same request', async () => {
        expect(await acknowledgeMixAlert(SIGNAL)).toBe(true);
        expect(await acknowledgeMixAlert(SIGNAL)).toBe(true);
        const rows = await rowsOf();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING');
        expect(rows[0].clientRequestId).toBe(acknowledgeRequestId(SIGNAL));
        expect(rows[0].payload).toEqual({ signalId: SIGNAL });
    });

    it.each([
        ['refused for review', { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.Forbidden', lastError: 'no' }],
        ['refused and dropped', { status: 'REJECTED_DROPPED', errorCode: 'ShramSafal.Forbidden', lastError: 'no' }],
        ['given up past the retry cap', { status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT, lastError: 'offline' }],
    ])('Seen_QueuesComplianceAcknowledge: an acknowledge that was %s is queued again by the next tap (re-armed, not swallowed)', async (_name, finished) => {
        await acknowledgeMixAlert(SIGNAL);
        const db = getDatabase();
        const [first] = await rowsOf();
        await db.mutationQueue.update(first.id!, finished as never);
        expect((await rowsOf())[0].status).not.toBe('PENDING');

        await acknowledgeMixAlert(SIGNAL);
        const rows = await rowsOf();
        expect(rows).toHaveLength(1); // the same request id, re-armed - never a second request
        expect(rows[0].id).toBe(first.id);
        expect(rows[0].status).toBe('PENDING');
        expect(rows[0].retryCount).toBe(0);
        expect(rows[0].errorCode).toBeUndefined();
        expect(rows[0].lastError).toBeUndefined();
    });

    it('an acknowledge already applied is left alone (the server has it)', async () => {
        await acknowledgeMixAlert(SIGNAL);
        const [first] = await rowsOf();
        await getDatabase().mutationQueue.update(first.id!, { status: 'APPLIED' });
        await acknowledgeMixAlert(SIGNAL);
        expect((await rowsOf()).map(r => r.status)).toEqual(['APPLIED']);
    });
});

describe('F2 - "पाहिलं" only for a seat that may confirm records', () => {
    it('Seen_QueuesComplianceAcknowledge: a ConfirmRecords holder gets the button; a worker seat sees the card and its words but no button', () => {
        farm.current = holder;
        render(<MixAlertCard card={mixCard()} />);
        expect(screen.getByTestId('attention-first-seen-mix')).toHaveTextContent('पाहिलं');
        cleanup();

        for (const seat of [worker, { role: 'Worker', authorities: [] }, { role: 'Mukadam' }, null]) {
            farm.current = seat;
            render(<MixAlertCard card={mixCard()} />);
            expect(screen.getByTestId('attention-card-mix')).toHaveTextContent('हे मिश्रण चुकीचं आहे'); // the card and its words stay
            expect(screen.getByTestId('attention-first-why-mix')).toHaveTextContent('दोघं मिळून घट्ट साका बनतो.');
            expect(screen.queryByTestId('attention-first-seen-mix')).toBeNull();
            cleanup();
        }
        // the primary account holder, with no list sent, holds every authority (D-26)
        farm.current = { role: 'PrimaryOwner' };
        render(<MixAlertCard card={mixCard()} />);
        expect(screen.getByTestId('attention-first-seen-mix')).toBeInTheDocument();
    });

    it('a worker seat on the page: the group and the count are there, the button is not', async () => {
        farm.current = worker;
        await putBoard([mixCard()]);
        render(<Surfaces />);
        await waitFor(() => expect(screen.getByTestId('attention-group-first')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-first-seen-mix')).toBeNull();
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('1');
    });
});

describe('F4 - while the acknowledge is only queued, the card stays away', () => {
    it('after a tap the page, the strip and the bottom-bar total all drop (one list)', async () => {
        await putBoard([mixCard()]);
        render(<Surfaces />);
        await waitFor(() => expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('1'));
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('1');

        await act(async () => { fireEvent.click(screen.getByTestId('attention-first-seen-mix')); });
        await waitFor(() => expect(screen.queryByTestId('attention-card-mix')).toBeNull());
        expect(screen.queryByTestId('attention-strip')).toBeNull();
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('0');
        expect(await rowsOf()).toHaveLength(1);
    });

    it('(b) app restart before the push: the tap is forgotten in memory but the queued request still hides the card', async () => {
        await acknowledgeMixAlert(SIGNAL);
        clearSeenSignalsForTests(); // a new app start: nothing in memory
        await putBoard([mixCard()]);
        render(<Surfaces />);
        await waitFor(() => expect(screen.getByTestId('bottom-total')).toHaveTextContent('0'));
        await new Promise(r => setTimeout(r, 20));
        expect(screen.queryByTestId('attention-card-mix')).toBeNull();
        expect(screen.queryByTestId('attention-strip')).toBeNull();
    });

    it('(c) a pull lands before the push drains: the board is newer than the tap, the request is still queued, the card stays hidden', async () => {
        await putBoard([mixCard()]);
        render(<Surfaces />);
        await waitFor(() => expect(screen.getByTestId('attention-card-mix')).toBeInTheDocument());
        await act(async () => { fireEvent.click(screen.getByTestId('attention-first-seen-mix')); });
        await waitFor(() => expect(screen.queryByTestId('attention-card-mix')).toBeNull());

        // the pull: a board computed AFTER the tap that (the push not having run) still lists the signal
        await putBoard([mixCard({ computedAtUtc: '2026-11-09T06:30:00.000Z' })]);
        await act(async () => { window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled')); });
        await new Promise(r => setTimeout(r, 30));
        expect(screen.queryByTestId('attention-card-mix')).toBeNull();
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('0');
    });

    it('(a) a phone clock BEHIND the server\'s: the board looks newer than the tap, yet the queued request keeps the card hidden', async () => {
        await acknowledgeMixAlert(SIGNAL);
        markSignalSeen(SIGNAL, Date.parse('2026-11-09T01:00:00.000Z')); // the phone thinks it is long before the board was computed
        await putBoard([mixCard({ computedAtUtc: '2026-11-09T03:30:00.000Z' })]);
        render(<Surfaces />);
        await new Promise(r => setTimeout(r, 30));
        expect(screen.queryByTestId('attention-card-mix')).toBeNull();
    });

    it('once the request is refused for good the card comes back (the server\'s word wins); a request still retrying keeps it hidden', async () => {
        await acknowledgeMixAlert(SIGNAL);
        clearSeenSignalsForTests();
        const [row] = await rowsOf();
        await getDatabase().mutationQueue.update(row.id!, { status: 'FAILED', retryCount: 2 }); // retrying: still on its way
        await putBoard([mixCard()]);
        render(<Surfaces />);
        await new Promise(r => setTimeout(r, 30));
        expect(screen.queryByTestId('attention-card-mix')).toBeNull();

        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.Forbidden' });
        await act(async () => { window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled')); });
        await waitFor(() => expect(screen.getByTestId('attention-card-mix')).toBeInTheDocument());
    });
});
