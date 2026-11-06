// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b fix round 1) — the review's findings on the one
 * approval path, each pinned by what the farmer would see:
 *  - H-2: a record hidden for its own send comes back in the SAME sheet once a newer server list still carries it
 *    ("this record changed" after a conflict; a reopened record after a शंका);
 *  - M-1: a parked conflict belongs to its record's farm and is settled only for that farm, only after the sheet opened;
 *  - M-3: a मंजूर held by an expired trial is not "पाठवणे बाकी"; it gets its own line with the way to the subscription;
 *  - L-4: what he saw is kept per user and farm, purged with the labour caches, dropped once the record is decided;
 *  - L-6: Marathi digits on the strip and the sheet; L-10: no rest line from an older read, freshness on the button.
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
import {
    VERSION_CONFLICT_CODE, getApprovalQueue, publishApprovalQueue, refreshApprovalQueue, rememberSeen, resetApprovalQueueForTests,
    seenFactsOf,
} from '../approvalQueue';
import { openApprovalReview } from '../openApprovalReview';
import { approvalWords } from '../approvalWords';
import { countHeldApprovals, unsentRecordCount } from '../unsentRecords';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import StripSignals from '../../oversight/components/StripSignals';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { ApprovalSeenStore } from '../../../infrastructure/storage/ApprovalSeenStore';
import { purgeLabourCachesForFarm } from '../../../infrastructure/storage/labourFarmAccess';
import { resolveDataFreshnessString } from '../../../i18n/dataFreshnessTranslations';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const OTHER_USER = 'a1a1a1a1-0000-4000-8000-000000000002';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000aa';
const FARM_B = 'f0f0f0f0-0000-4000-8000-0000000000bb';
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

describe('H-2 — a record hidden for its own send returns in the same sheet', () => {
    it('approve, the server says the record changed, the refreshed list carries version 2: the changed card shows and its मंजूर sends version 2', async () => {
        h.fetchLabourData.mockResolvedValue(list([card('x', 1, 5)]));
        render(<Router />);
        act(() => { openApprovalReview(); });
        await settle();
        fireEvent.click(screen.getByTestId('review-approve-x'));

        // The server will answer: the record moved on to version 2 (six people), and the मंजूर is parked as a conflict.
        h.fetchLabourData.mockResolvedValue(list([card('x', 2, 6)]));
        h.rejected = [conflictRow(9, 'x', FARM, 1)];
        await settle(PAST_SEND);
        await settle();
        expect(h.enqueueOwnerConfirmation).toHaveBeenLastCalledWith('x', expect.objectContaining({ logVersion: 1 }));

        expect(screen.getByTestId('review-card-x')).toBeInTheDocument();
        expect(screen.getByTestId('review-changed-x')).toHaveTextContent('ही नोंद बदलली आहे');
        expect(screen.getByTestId('review-changed-lines-x')).toHaveTextContent('माणसं: ५ → ६');
        expect(screen.queryByTestId('review-list-empty')).toBeNull();

        fireEvent.click(screen.getByTestId('review-approve-x'));
        await settle(PAST_SEND);
        expect(h.enqueueOwnerConfirmation).toHaveBeenLastCalledWith('x', expect.objectContaining({ logVersion: 2 }));
        expect(h.dropped).toHaveBeenCalledWith(9);
    });

    it('a शंका, then a correction re-opens the record: the same sheet lists it again', async () => {
        h.fetchLabourData.mockResolvedValue(list([card('x', 1)]));
        render(<Router />);
        act(() => { openApprovalReview(); });
        await settle();
        fireEvent.click(screen.getByTestId('review-query-x'));
        fireEvent.change(screen.getByTestId('review-reason-x'), { target: { value: 'काम अपूर्ण' } });
        h.fetchLabourData.mockResolvedValue(list([])); // disputed: it leaves the list
        fireEvent.click(screen.getByTestId('review-reason-send-x'));
        await settle(PAST_SEND);
        await settle();
        expect(screen.queryByTestId('review-card-x')).toBeNull();

        h.fetchLabourData.mockResolvedValue(list([card('x', 2)])); // the worker corrected it: Draft again, version 2
        await act(async () => { await refreshApprovalQueue(FARM); });
        await settle();
        expect(screen.getByTestId('review-card-x')).toBeInTheDocument();
    });

    it('a card whose decision is still on this phone stays hidden, and the sheet does not claim the list is empty', async () => {
        h.fetchLabourData.mockResolvedValue(list([card('x', 1)]));
        render(<Router />);
        act(() => { openApprovalReview(); });
        await settle();
        fireEvent.click(screen.getByTestId('review-approve-x'));
        h.open = [{ id: 3, clientRequestId: 'p', mutationType: SyncMutationName.VerifyLogV2, status: 'PENDING', retryCount: 0, payload: { logId: 'x', logVersion: 1 }, farmId: FARM }];
        await settle(PAST_SEND);
        await settle();
        expect(screen.queryByTestId('review-card-x')).toBeNull();
        expect(screen.queryByTestId('review-list-empty')).toBeNull();
        expect(screen.getByTestId('review-list-sending')).toBeInTheDocument();
    });
});

describe('M-1 — a conflict belongs to its record\'s farm', () => {
    it('settles only this farm\'s conflicts, only after the sheet was open; another farm\'s is kept', async () => {
        h.rejected = [conflictRow(21, 'b-record', FARM_B), conflictRow(22, 'a-gone', FARM)];
        h.fetchLabourData.mockResolvedValue(list([]));
        render(<Router />);
        await act(async () => { await refreshApprovalQueue(FARM); });
        await settle();
        expect(h.dropped).not.toHaveBeenCalled(); // the sheet was never opened
        expect(getApprovalQueue(FARM).conflicts.map((c) => c.rowId)).toEqual([22]);

        act(() => { openApprovalReview(); });
        await settle();
        await settle();
        expect(h.dropped).toHaveBeenCalledWith(22);
        expect(h.dropped).not.toHaveBeenCalledWith(21);
    });
});

describe('M-3 — a मंजूर held by an expired trial', () => {
    it('is not "पाठवणे बाकी", and the strip says approvals need an active subscription, with the way there', () => {
        const held = { clientRequestId: 'h', status: 'FAILED', retryCount: 0, errorCode: 'entitlement.subscriptionexpired', payload: { logId: 'x' }, farmId: FARM, mutationType: SyncMutationName.VerifyLogV2 };
        const offline = { clientRequestId: 'o', status: 'PENDING', retryCount: 0, payload: { dailyLogId: 'L1' }, farmId: FARM, mutationType: SyncMutationName.CreateDailyLog };
        expect(unsentRecordCount([held, offline], 0, 0)).toBe(1);
        expect(countHeldApprovals([held, offline], FARM)).toBe(1);
        expect(countHeldApprovals([held], FARM_B)).toBe(0);

        h.held.n = 1;
        publishApprovalQueue(FARM, list([]));
        const onOpenSubscription = vi.fn();
        const base = { language: 'mr' as const, farmId: FARM, needsYouCount: 0, onOpenSync: vi.fn(), onOpenWaiting: vi.fn(), lastSyncAt: null };
        render(<StripSignals {...base} onOpenSubscription={onOpenSubscription} />);
        const line = screen.getByTestId('strip-held-approvals');
        expect(line).toHaveTextContent('मंजुरीसाठी सदस्यता सुरू असावी लागते');
        fireEvent.click(line);
        expect(onOpenSubscription).toHaveBeenCalledTimes(1);
        cleanup();
        render(<StripSignals {...base} />);
        expect(screen.getByTestId('strip-held-approvals').tagName).not.toBe('BUTTON');
    });
});

describe('L-4 — what he saw is kept per user and farm, and not for ever', () => {
    it('is keyed by user and farm, purged with the labour caches, and dropped once the record is decided', async () => {
        ApprovalSeenStore.write(ME, FARM, 'x', { version: 1 });
        ApprovalSeenStore.write(OTHER_USER, FARM, 'x', { version: 7 });
        expect(ApprovalSeenStore.read(ME, FARM, 'x')).toEqual({ version: 1 });
        expect(ApprovalSeenStore.read(ME, FARM_B, 'x')).toBeNull();
        ApprovalSeenStore.purgeExceptUser(ME);
        expect(ApprovalSeenStore.read(OTHER_USER, FARM, 'x')).toBeNull();
        purgeLabourCachesForFarm(ME, FARM);
        expect(ApprovalSeenStore.read(ME, FARM, 'x')).toBeNull();

        rememberSeen(card('y', 1), FARM);
        expect(seenFactsOf('y', FARM)).not.toBeNull();
        h.fetchLabourData.mockResolvedValue(list([])); // decided: it left the list, nothing parked
        await refreshApprovalQueue(FARM);
        expect(seenFactsOf('y', FARM)).toBeNull();
    });
});

describe('L-6 / L-10 — the strip\'s digits and its honesty about old reads', () => {
    it('Marathi digits on the chips and the sheet count line', () => {
        expect(approvalWords('mr').countLine(3)).toBe('३ नोंदी — मंजूर करा');
        expect(approvalWords('mr').approvalChip(12)).toBe('मंजुरीसाठी १२');
        expect(approvalWords('mr').unsentChip(2)).toBe('पाठवणे बाकी २');
        expect(approvalWords('en').countLine(3)).toBe('3 records — approve');
    });

    it('after a failed refresh the rest line from an older read is not shown, and the button says how fresh the strip is', async () => {
        publishApprovalQueue(FARM, list([]));
        h.fetchLabourData.mockRejectedValue(new Error('offline'));
        await refreshApprovalQueue(FARM);
        render(<StripSignals language="mr" farmId={FARM} needsYouCount={0} onOpenSync={vi.fn()} onOpenWaiting={vi.fn()} lastSyncAt={null} />);
        expect(screen.getByTestId('strip-rest')).toHaveTextContent('यादी आत्ता दिसत नाही');
        expect(screen.getByTestId('strip-rest')).not.toHaveTextContent('मंजुरीसाठी नोंदी बाकी नाहीत');
        expect(screen.getByTestId('canonical-strip-waiting-button').getAttribute('aria-label'))
            .toContain(resolveDataFreshnessString('mr', 'showingWorkUpToUnknown'));
    });
});
