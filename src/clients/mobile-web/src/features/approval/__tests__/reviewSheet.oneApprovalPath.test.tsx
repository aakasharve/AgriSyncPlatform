// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-40 / D-46) — the one review sheet:
 * the explanation line once, the empty line, शंका only with his reason, bulk only over records he SELECTS (the number
 * shown first), and "this record changed": the new version, the reason, what changed, and his मंजूर of THAT version.
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
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({ default: () => null }));

import ReviewSheet from '../../labour/components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { ApprovalSeenStore } from '../../../infrastructure/storage/ApprovalSeenStore';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const FARM = 'f0f0f0f0-0000-4000-8000-000000000001';
const PAST_SEND_MS = 450 + 3100;

const complete = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
    id, who: `who-${id}`, initial: 'र', tone: 'or', detail: '2026-10-30', status: 'Draft', version: 1,
    plot: 'प्लॉट A', plotScope: 'Plot', points: { count: 5, task: 'फवारणी' }, ...over,
});
const data = (review: ReviewItem[], over: Partial<LabourData> = {}): LabourData => ({ ...EMPTY_LABOUR_DATA, review, canConfirm: true, ...over });
type SheetProps = React.ComponentProps<typeof ReviewSheet>;
const mount = (props: Partial<SheetProps> & { data: LabourData }) =>
    render(React.createElement(ReviewSheet, { open: true, onClose: vi.fn(), onToast: vi.fn(), farmId: FARM, ...props }));

describe('the one review sheet (lane L4b)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        enqueue.mockReset().mockResolvedValue('id');
        enqueueOwnerConfirmation.mockReset().mockResolvedValue('id');
        triggerNow.mockReset().mockResolvedValue(undefined);
        setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); window.localStorage.clear(); });

    it('says the payment line ONCE and, on a list read empty, "मंजुरीसाठी नोंदी बाकी नाहीत" — never an all-clear', () => {
        mount({ data: data([complete('a'), complete('b')]) });
        expect(screen.getAllByText('मंजुरी म्हणजे कामाच्या नोंदीची खात्री. पैसे दिल्याची नोंद वेगळी आहे.')).toHaveLength(1);
        cleanup();
        mount({ data: data([]) });
        expect(screen.getByTestId('review-list-empty')).toHaveTextContent('मंजुरीसाठी नोंदी बाकी नाहीत');
        expect(document.body.textContent).not.toMatch(/सर्व कामे पूर्ण|सगळं झालं|तपासून झाल्या/);
    });

    it('an unread list is never called empty', () => {
        mount({ data: data([]), reviewListUnknown: true });
        expect(screen.queryByTestId('review-list-empty')).toBeNull();
        expect(screen.getByTestId('review-list-unknown')).toBeInTheDocument();
    });

    it('शंका needs his reason: the send stays off until he gives one, and his own words are sent', async () => {
        mount({ data: data([complete('a')]) });
        fireEvent.click(screen.getByTestId('review-query-a'));
        const send = screen.getByTestId('review-reason-send-a');
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByTestId('review-reason-a'), { target: { value: '   ' } });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByTestId('review-reason-a'), { target: { value: 'मजूर ५ नव्हते, ४ होते' } });
        expect(send).toBeEnabled();
        fireEvent.click(send);
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SEND_MS); });
        expect(enqueue).toHaveBeenLastCalledWith({ dailyLogId: 'a', verificationStatus: 'disputed', reason: 'मजूर ५ नव्हते, ४ होते' });
        expect(enqueue.mock.calls.flat()).not.toContainEqual(expect.objectContaining({ reason: expect.stringContaining('एकदा विचारून') }));
    });

    it('bulk only over the records he SELECTS, only eligible ones, the number shown before it goes', async () => {
        const incomplete = complete('noPlot', { plot: null, plotScope: undefined });
        mount({ data: data([complete('a'), complete('b'), complete('c'), incomplete]) });
        expect(screen.queryByTestId('review-approve-all')).toBeNull();
        expect(screen.queryByTestId('review-approve-selected')).toBeNull();
        expect(screen.queryByTestId('review-select-noPlot')).toBeNull(); // a card with "—" is looked at on its own

        fireEvent.click(screen.getByTestId('review-select-a'));
        fireEvent.click(screen.getByTestId('review-select-c'));
        fireEvent.click(screen.getByTestId('review-approve-selected'));
        expect(screen.getByTestId('review-bulk-confirm')).toHaveTextContent('२ नोंदी मंजूर करायच्या?');
        expect(enqueueOwnerConfirmation).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('review-bulk-yes'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SEND_MS); });
        expect(enqueueOwnerConfirmation.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c']);
        expect(triggerNow).toHaveBeenCalledTimes(1);
    });

    it('a record that changed after he saw it shows the new version, the reason and what changed; his मंजूर covers THAT version', async () => {
        ApprovalSeenStore.write('a', { version: 1, count: 5, task: 'फवारणी', plot: 'प्लॉट A', amount: null });
        const settled = vi.fn();
        mount({
            data: data([complete('a', { version: 2, points: { count: 6, task: 'फवारणी' } })]),
            conflicts: [{ rowId: 7, logId: 'a', seenVersion: 1 }],
            onConflictSettled: settled,
        });
        const notice = screen.getByTestId('review-changed-a');
        expect(notice).toHaveTextContent('ही नोंद बदलली आहे');
        expect(notice).toHaveTextContent('तुमची मंजुरी जुन्या नोंदीवर लागली नाही');
        expect(screen.getByTestId('review-changed-lines-a')).toHaveTextContent('माणसं: ५ → ६');
        expect(screen.getByTestId('review-fact-count-a')).toHaveTextContent('६');
        expect(screen.queryByTestId('review-select-a')).toBeNull(); // a changed record is never bulk-approved

        fireEvent.click(screen.getByTestId('review-approve-a'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SEND_MS); });
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith('a', { verifierUserId: ME, reviewBasis: 'read', logVersion: 2 });
        expect(settled).toHaveBeenCalledWith(7);
    });

    it('one language at a time: English words in English mode', () => {
        mount({ data: data([]), language: 'en' });
        expect(screen.getByTestId('review-sheet-explanation')).toHaveTextContent('Approval confirms the work record. A record of payment is separate.');
        expect(screen.getByTestId('review-list-empty')).toHaveTextContent('No records waiting for approval');
        expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
