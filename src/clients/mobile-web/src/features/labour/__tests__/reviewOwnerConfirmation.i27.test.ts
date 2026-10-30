// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — the review sheet's मंजूर as the OWNER'S confirmation
 * (founder D-44 / D-46 / D-31):
 *   - मंजूर / शंका only for whoever may give it (the server's `canConfirm`: the primary owner or a member holding the
 *     owner's grant); a co-owner by role alone sees the cards, no buttons (P5);
 *   - मंजूर goes as ONE verify_log_v2 that says how he reviewed it ('read', or 'heard' once he played the original
 *     voice to the end) and which version of the record the card showed (D-46);
 *   - "मूळ आवाज ऐका" only on a card whose record has a recording, and only for someone who may confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { enqueue, enqueueOwnerConfirmation, triggerNow } = vi.hoisted(() => ({
    enqueue: vi.fn(), enqueueOwnerConfirmation: vi.fn(), triggerNow: vi.fn(),
}));
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...a: unknown[]) => enqueue(...a), enqueueOwnerConfirmation: (...a: unknown[]) => enqueueOwnerConfirmation(...a) },
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => triggerNow(...a) },
}));
// The replay control itself is tested on its own; here it is a stand-in that can report "heard".
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({
    default: (p: { dailyLogId: string; onHeard?: (id: string) => void }) =>
        React.createElement('button', { type: 'button', 'data-testid': `ov-play-${p.dailyLogId}`, onClick: () => p.onHeard?.(p.dailyLogId) }, 'मूळ आवाज ऐका'),
}));

import ReviewSheet from '../components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, ReviewItem } from '../labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const FARM = 'f0f0f0f0-0000-4000-8000-000000000001';
const PAST_ANIM_MS = 450;
const PAST_UNDO_WINDOW_MS = 3100;

const item = (id: string, over: Partial<ReviewItem> = {}): ReviewItem =>
    ({ id, who: `who-${id}`, initial: 'र', tone: 'or', detail: '2026-10-30', status: 'Draft', points: {}, ...over });
const data = (review: ReviewItem[], over: Partial<LabourData> = {}): LabourData => ({ ...EMPTY_LABOUR_DATA, review, ...over });
const mount = (d: LabourData) => render(React.createElement(ReviewSheet, { open: true, data: d, onClose: vi.fn(), onToast: vi.fn(), farmId: FARM }));

describe('review sheet — the owner\'s confirmation (I27)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        enqueue.mockReset().mockResolvedValue('id');
        enqueueOwnerConfirmation.mockReset().mockResolvedValue('id');
        triggerNow.mockReset().mockResolvedValue(undefined);
        setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); });

    it('मंजूर goes as ONE owner confirmation, noted as READ, with the version the card showed', async () => {
        mount(data([item('r1', { version: 3, hasRecording: true })], { canConfirm: true }));
        fireEvent.click(screen.getByTestId('review-approve-r1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS + PAST_UNDO_WINDOW_MS); });

        expect(enqueue).not.toHaveBeenCalled(); // no two-hop v1 walk: the server walks Draft itself
        expect(enqueueOwnerConfirmation).toHaveBeenCalledTimes(1);
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith('r1', { verifierUserId: ME, reviewBasis: 'read', logVersion: 3 });
    });

    it('once he heard the original voice, the same मंजूर is noted as HEARD', async () => {
        mount(data([item('r1', { version: 1, hasRecording: true })], { canConfirm: true }));
        fireEvent.click(screen.getByTestId('ov-play-r1')); // played to the end
        fireEvent.click(screen.getByTestId('review-approve-r1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS + PAST_UNDO_WINDOW_MS); });
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith('r1', { verifierUserId: ME, reviewBasis: 'heard', logVersion: 1 });
    });

    it('"मूळ आवाज ऐका" only where the record has a recording', () => {
        mount(data([item('with', { hasRecording: true }), item('without')], { canConfirm: true }));
        expect(screen.getByTestId('ov-play-with')).toBeInTheDocument();
        expect(screen.queryByTestId('ov-play-without')).toBeNull();
    });

    it('someone who may not give the owner\'s confirmation (a co-owner by role) sees the cards but no मंजूर, शंका or replay', () => {
        mount(data([item('r1', { hasRecording: true })], { canConfirm: false, canManageLabour: true }));
        expect(screen.getByTestId('review-card-r1')).toBeInTheDocument();
        expect(screen.queryByTestId('review-approve-r1')).toBeNull();
        expect(screen.queryByTestId('review-query-r1')).toBeNull();
        expect(screen.queryByTestId('ov-play-r1')).toBeNull();
    });

    it('शंका is unchanged: the v1 dispute walk with its reason, no confirmation evidence', async () => {
        mount(data([item('r1', { status: 'Confirmed' })], { canConfirm: true }));
        fireEvent.click(screen.getByTestId('review-query-r1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS + PAST_UNDO_WINDOW_MS); });
        expect(enqueueOwnerConfirmation).not.toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ dailyLogId: 'r1', verificationStatus: 'disputed' }));
    });
});
