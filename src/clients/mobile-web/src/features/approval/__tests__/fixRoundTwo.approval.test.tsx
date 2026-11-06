// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b fix round 2) — re-review 2's findings on the one
 * approval path:
 *  - N-1: a read that lands FIRST (the हजेरी page's publish) must not make the sheet lose its own read's facts: the
 *    "this record changed" notice still shows (scenario A), and a card whose decision is still on this phone stays
 *    hidden (scenario B: a failed send, and a send held for the farm's trial);
 *  - N-2: the trial line has no button, in both languages;
 *  - L-b: the old unscoped seen-store keys are dropped; L-d: a neutral line for decisions still on the phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
    enqueue: vi.fn(), enqueueOwnerConfirmation: vi.fn(), triggerNow: vi.fn(), fetchLabourData: vi.fn(),
    rejected: [] as unknown[], open: [] as unknown[], dropped: vi.fn(), held: { n: 0 }, unsent: { n: 0 },
}));
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...a: unknown[]) => h.enqueue(...a), enqueueOwnerConfirmation: (...a: unknown[]) => h.enqueueOwnerConfirmation(...a) },
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => h.triggerNow(...a) },
}));
vi.mock('../../labour/data/labourClient', () => ({ fetchLabourData: (...a: unknown[]) => h.fetchLabourData(...a) }));
vi.mock('../../../infrastructure/sync/MutationQueue', async (orig) => ({
    ...(await orig<typeof import('../../../infrastructure/sync/MutationQueue')>()),
    mutationQueue: {
        getRejectedUserReview: async () => h.rejected,
        markRejectedDropped: async (id: number) => { h.dropped(id); },
    },
}));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        mutationQueue: { where: () => ({ anyOf: () => ({ toArray: async () => h.open }) }) },
        uploadQueue: { where: () => ({ anyOf: () => ({ count: async () => 0 }) }) },
        pendingAiJobs: { where: () => ({ anyOf: () => ({ count: async () => 0 }) }) },
    }),
}));
vi.mock('../unsentRecords', async (orig) => ({
    ...(await orig<typeof import('../unsentRecords')>()),
    useUnsentRecordCount: () => h.unsent.n,
    useHeldApprovalCount: () => h.held.n,
}));
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({ default: () => null }));

import { ApprovalReviewHost } from '../ApprovalReviewHost';
import { VERSION_CONFLICT_CODE, publishApprovalQueue, resetApprovalQueueForTests } from '../approvalQueue';
import { openApprovalReview } from '../openApprovalReview';
import { approvalWords } from '../approvalWords';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import StripSignals from '../../oversight/components/StripSignals';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { ApprovalSeenStore } from '../../../infrastructure/storage/ApprovalSeenStore';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000aa';
const PAST_SEND = 450 + 3100;

const card = (id: string, version = 1, count = 5): ReviewItem => ({
    id, who: `who-${id}`, initial: 'र', tone: 'or', detail: '2026-10-30', status: 'Draft', version,
    plot: 'प्लॉट A', plotScope: 'Plot', points: { count, task: 'फवारणी' },
});
const list = (items: ReviewItem[]): LabourData => ({ ...EMPTY_LABOUR_DATA, review: items, canConfirm: true });
const conflictRow = (id: number, logId: string, farmId: string, seen = 1) => ({
    id, clientRequestId: `c-${id}`, mutationType: SyncMutationName.VerifyLogV2, status: 'REJECTED_USER_REVIEW', retryCount: 0,
    errorCode: VERSION_CONFLICT_CODE, payload: { logId, logVersion: seen }, farmId,
});

/** The router's half of the door (AppRouter's `showReviewInbox`). */
const Router: React.FC<{ farmId?: string }> = ({ farmId = FARM }) => {
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
        const l = () => setOpen(true);
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, l);
        return () => window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, l);
    }, []);
    return <ApprovalReviewHost open={open} onClose={() => setOpen(false)} farmId={farmId} />;
};

const settle = async (ms = 20) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.enqueue.mockReset().mockResolvedValue('id');
    h.enqueueOwnerConfirmation.mockReset().mockResolvedValue('id');
    h.triggerNow.mockReset().mockResolvedValue(undefined);
    h.fetchLabourData.mockReset();
    h.dropped.mockReset();
    h.rejected = [];
    h.open = [];
    h.held.n = 0;
    h.unsent.n = 0;
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); resetApprovalQueueForTests(); window.localStorage.clear(); });


/** A post-send read that answers only when the test says so: the page's publish lands in between. */
function deferredRead() {
    let resolve!: (d: LabourData) => void;
    const promise = new Promise<LabourData>((r) => { resolve = r; });
    return { promise, resolve };
}

/** Never a bare changed card: either hidden, or shown with its notice. */
const shownWithoutItsNotice = () => !!screen.queryByTestId('review-card-x') && !screen.queryByTestId('review-changed-x');

describe("N-1 — a read that lands first keeps the sheet read's own facts", () => {
    it('scenario A: a version conflict — the changed card never shows without "ही नोंद बदलली आहे", and shows with it', async () => {
        h.fetchLabourData.mockResolvedValueOnce(list([card('x', 1, 5)]));
        render(<Router />);
        act(() => { openApprovalReview(); });
        await settle();
        const sheetRead = deferredRead();
        h.fetchLabourData.mockImplementationOnce(() => sheetRead.promise);
        h.rejected = [conflictRow(9, 'x', FARM, 1)];
        fireEvent.click(screen.getByTestId('review-approve-x'));
        await settle(PAST_SEND);

        // The हजेरी page's own read lands first, carrying version 2.
        act(() => { publishApprovalQueue(FARM, list([card('x', 2, 6)])); });
        await settle();
        expect(shownWithoutItsNotice()).toBe(false);

        // Then the sheet's read lands (it started earlier, and it read the parked conflict).
        await act(async () => { sheetRead.resolve(list([card('x', 2, 6)])); });
        await settle();
        expect(screen.getByTestId('review-changed-x')).toHaveTextContent('ही नोंद बदलली आहे');
        expect(screen.getByTestId('review-changed-lines-x')).toHaveTextContent('माणसं: ५ → ६');
    });

    it.each([
        ['a failed send the worker will try again', undefined],
        ["a send held for the farm's trial", 'entitlement.subscriptionexpired'],
    ])('scenario B: %s — the card stays hidden while its decision is on this phone', async (_label, errorCode) => {
        h.fetchLabourData.mockResolvedValueOnce(list([card('x', 1)]));
        render(<Router />);
        act(() => { openApprovalReview(); });
        await settle();
        const sheetRead = deferredRead();
        h.fetchLabourData.mockImplementationOnce(() => sheetRead.promise);
        h.open = [{
            id: 3, clientRequestId: 'p', mutationType: SyncMutationName.VerifyLogV2, status: 'FAILED', retryCount: 1, errorCode,
            payload: { logId: 'x', logVersion: 1 }, farmId: FARM,
        }];
        fireEvent.click(screen.getByTestId('review-approve-x'));
        await settle(PAST_SEND);

        act(() => { publishApprovalQueue(FARM, list([card('x', 1)])); });
        await settle();
        expect(screen.queryByTestId('review-card-x')).toBeNull();

        await act(async () => { sheetRead.resolve(list([card('x', 1)])); });
        await settle();
        expect(screen.queryByTestId('review-card-x')).toBeNull();
        expect(screen.queryByTestId('review-list-empty')).toBeNull();
        expect(screen.getByTestId('review-list-sending')).toHaveTextContent('तुमचे निर्णय या फोनवर आहेत');
    });
});

describe('N-2 — the trial line has no button until the trial lane gives it a real action', () => {
    it.each([
        ['mr' as const, 'मंजुरीसाठी सदस्यता सुरू असावी लागते'],
        ['en' as const, 'Approvals need an active subscription'],
    ])('%s: the line, never a button', (language, words) => {
        h.held.n = 1;
        publishApprovalQueue(FARM, list([]));
        render(<StripSignals language={language} farmId={FARM} needsYouCount={0} onOpenSync={vi.fn()} onOpenWaiting={vi.fn()} lastSyncAt={null} />);
        const line = screen.getByTestId('strip-held-approvals');
        expect(line).toHaveTextContent(words);
        expect(line.tagName).not.toBe('BUTTON');
        expect(line.closest('button')).toBeNull();
    });
});

describe('L-b / L-d', () => {
    it('the old unscoped seen-store keys (before lane L4b fix round 1) are dropped; the scoped ones stay', () => {
        window.localStorage.setItem('agrisync.approval.seen.b2b2b2b2-0000-4000-8000-000000000009', '{"amount":1500}');
        ApprovalSeenStore.write(ME, FARM, 'x', { version: 1, amount: 900 });
        ApprovalSeenStore.dropUnscoped();
        expect(window.localStorage.getItem('agrisync.approval.seen.b2b2b2b2-0000-4000-8000-000000000009')).toBeNull();
        expect(ApprovalSeenStore.read(ME, FARM, 'x')).toEqual({ version: 1, amount: 900 });
    });

    it('a neutral line for decisions still on this phone: it does not claim they are being sent', () => {
        expect(approvalWords('mr').listSending).toBe('तुमचे निर्णय या फोनवर आहेत');
        expect(approvalWords('en').listSending).toBe('Your decisions are on this phone');
    });
});
