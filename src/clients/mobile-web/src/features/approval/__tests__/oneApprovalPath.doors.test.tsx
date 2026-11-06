// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-3 "one approval path, same result
 * from every entry point", D-40 §1-3) — every door opens the SAME sheet over the SAME list and the sheet makes the
 * SAME call; the count is the server's list for this farm, shown only to someone who may confirm; "पाठवणे बाकी" is this
 * phone's own unsent records and is never called "अडकलेल्या".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { enqueue, enqueueOwnerConfirmation, triggerNow, fetchLabourData, unsent } = vi.hoisted(() => ({
    enqueue: vi.fn(), enqueueOwnerConfirmation: vi.fn(), triggerNow: vi.fn(), fetchLabourData: vi.fn(), unsent: { n: 0 },
}));
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...a: unknown[]) => enqueue(...a), enqueueOwnerConfirmation: (...a: unknown[]) => enqueueOwnerConfirmation(...a) },
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => triggerNow(...a) },
}));
vi.mock('../../labour/data/labourClient', () => ({ fetchLabourData: (...a: unknown[]) => fetchLabourData(...a) }));
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({
    mutationQueue: { getRejectedUserReview: async () => [], markRejectedDropped: async () => undefined },
}));
vi.mock('../unsentRecords', async (orig) => ({
    ...(await orig<typeof import('../unsentRecords')>()),
    useUnsentRecordCount: () => unsent.n,
}));
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({ default: () => null }));

import { ApprovalChip } from '../ApprovalChip';
import { ApprovalReviewHost } from '../ApprovalReviewHost';
import { approvalCountOf, getApprovalQueue, publishApprovalQueue, resetApprovalQueueForTests } from '../approvalQueue';
import { openApprovalReview } from '../openApprovalReview';
import { unsentRecordCount } from '../unsentRecords';
import StripSignals from '../../oversight/components/StripSignals';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000aa';
const OTHER_FARM = 'f0f0f0f0-0000-4000-8000-0000000000bb';

const card = (id: string): ReviewItem => ({
    id, who: `who-${id}`, initial: 'र', tone: 'or', detail: '2026-10-30', status: 'Draft', version: 4,
    plot: 'प्लॉट A', plotScope: 'Plot', points: { count: 3, task: 'खुरपणी' },
});
const list = (ids: string[], over: Partial<LabourData> = {}): LabourData => ({ ...EMPTY_LABOUR_DATA, review: ids.map(card), canConfirm: true, ...over });

/** The router's half of the door: the event opens the one host (AppRouter's `showReviewInbox`). */
const Router: React.FC = () => {
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
        const l = () => setOpen(true);
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, l);
        return () => window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, l);
    }, []);
    return <ApprovalReviewHost open={open} onClose={() => setOpen(false)} farmId={FARM} />;
};

describe('one approval path — the count', () => {
    afterEach(() => { cleanup(); resetApprovalQueueForTests(); });

    it('is the server list for THIS farm, records not rows, and only for someone who may confirm', () => {
        publishApprovalQueue(FARM, list(['a', 'b', 'c']));
        publishApprovalQueue(OTHER_FARM, list(['x']));
        expect(approvalCountOf(getApprovalQueue(FARM))).toBe(3);
        expect(approvalCountOf(getApprovalQueue(OTHER_FARM))).toBe(1);
        publishApprovalQueue(FARM, list(['a', 'b'], { canConfirm: false }));
        expect(approvalCountOf(getApprovalQueue(FARM))).toBeNull();
        expect(approvalCountOf(getApprovalQueue('never-read'))).toBeNull();
    });

    it('the chip shows "मंजुरीसाठी N" and nothing at zero, when unread, or for a non-confirmer', () => {
        publishApprovalQueue(FARM, list(['a', 'b', 'c']));
        render(<ApprovalChip farmId={FARM} language="mr" />);
        expect(screen.getByTestId('approval-chip')).toHaveTextContent('मंजुरीसाठी ३');
        cleanup();
        publishApprovalQueue(FARM, list([]));
        render(<ApprovalChip farmId={FARM} language="mr" />);
        expect(screen.queryByTestId('approval-chip')).toBeNull();
    });
});

describe('one approval path — every door, the same sheet, the same call', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        enqueue.mockReset().mockResolvedValue('id');
        enqueueOwnerConfirmation.mockReset().mockResolvedValue('id');
        triggerNow.mockReset().mockResolvedValue(undefined);
        fetchLabourData.mockReset().mockResolvedValue(list(['a', 'b']));
        setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); resetApprovalQueueForTests(); });

    const doorClicks: Array<[string, () => void]> = [
        ['the strip / आढावा chip', () => fireEvent.click(screen.getByTestId('approval-chip'))],
        ['a door about one record (job card)', () => act(() => { openApprovalReview('b'); })],
        ['हजेरी तपासा / dashboard / waiting drawer', () => act(() => { openApprovalReview(); })],
    ];

    it.each(doorClicks)('%s opens THE sheet over the farm list, and मंजूर is the one verify_log_v2', async (_door, click) => {
        publishApprovalQueue(FARM, list(['a', 'b']));
        render(<><Router /><ApprovalChip farmId={FARM} language="mr" /></>);
        expect(screen.getByTestId('review-sheet')).toHaveAttribute('aria-hidden', 'true');
        click();
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        expect(screen.getByTestId('review-sheet')).toHaveAttribute('aria-hidden', 'false');
        expect(fetchLabourData).toHaveBeenCalledWith(FARM, 'today'); // opening reads the server list again
        expect(screen.getByTestId('review-card-a')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('review-approve-a'));
        await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith('a', { verifierUserId: ME, reviewBasis: 'read', logVersion: 4 });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('a door about one record puts that record first', async () => {
        publishApprovalQueue(FARM, list(['a', 'b']));
        render(<Router />);
        act(() => { openApprovalReview('b'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        const cards = screen.getAllByTestId(/^review-card-/);
        expect(cards[0]).toHaveAttribute('data-testid', 'review-card-b');
        expect(cards[0]).toHaveAttribute('data-focused', 'true');
    });
});

describe('one approval path — no second sheet, no second write', () => {
    const SRC = join(__dirname, '..', '..', '..');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : files(full);
        return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
    const all = files(SRC).map((f) => ({ path: relative(SRC, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));

    it('the review sheet is mounted in ONE place, the router-mounted host', () => {
        const mounts = all.filter((f) => /<ReviewSheet\b/.test(f.text)).map((f) => f.path);
        expect(mounts).toEqual(['features/approval/ApprovalReviewHost.tsx']);
    });

    it('every door goes through the one opener', () => {
        const doors = [
            'features/context/components/AppHeader.tsx', // the waiting drawer's approval row
            'features/oversight/components/StripSignals.tsx', // the strip
            'features/reflect/ReflectPage.tsx', // आढावा
            'features/labour/components/LabourFeature.tsx', // हजेरी तपासा + the dashboard's तपासायचं
            'features/work/pages/JobCardDetailPage.tsx', // a task card's linked record
        ];
        for (const door of doors) {
            const text = all.find((f) => f.path === door)?.text ?? '';
            expect(text, door).toMatch(/openApprovalReview|ApprovalChip/);
        }
    });

    it('only the sheet\'s one write, the owner\'s own "save and confirm" (D-46) and the use cases under them enqueue a verification', () => {
        const writers = all
            .filter((f) => /VerifyLogCommand\.(enqueue|enqueueOwnerConfirmation)\(|\bverifyLog\(\{|enqueue\(\s*SyncMutationName\.VerifyLog/.test(f.text))
            .map((f) => f.path)
            .sort();
        expect(writers).toContain('features/labour/components/reviewSend.ts'); // THE one write of the one sheet
        const allowed = [
            'app/hooks/useTrustLayer.ts', // legacy handleVerifyLog: reached only by the dev E2E page
            'application/usecases/VerifyLog.ts', // the use case "save and confirm" goes through
            'application/usecases/sync/VerifyLogCommand.ts', // the wire shapes reviewSend uses
            'features/labour/components/reviewSend.ts',
            'features/logs/components/voiceResult/useRecordingTrust.ts', // his own new recording: "save and confirm" (D-46 §3)
        ];
        expect(writers.filter((w) => !allowed.includes(w))).toEqual([]);
    });
});

describe('"पाठवणे बाकी" — this phone only, never "अडकलेल्या"', () => {
    beforeEach(() => { fetchLabourData.mockReset().mockRejectedValue(new Error('offline')); });
    afterEach(() => { cleanup(); resetApprovalQueueForTests(); unsent.n = 0; });

    it('counts this phone\'s records on their way, once each, and leaves out what needs him', () => {
        const rows = [
            { clientRequestId: '1', status: 'PENDING', retryCount: 0, payload: { dailyLogId: 'L1' } },
            { clientRequestId: '2', status: 'PENDING', retryCount: 0, payload: { dailyLogId: 'L1', activityType: 'x' } },
            { clientRequestId: '3', status: 'SENDING', retryCount: 0, payload: { logId: 'L1' } },
            { clientRequestId: '4', status: 'FAILED', retryCount: 1, payload: { costEntryId: 'C1' } },
            { clientRequestId: '5', status: 'FAILED', retryCount: 9, payload: { dailyLogId: 'L2' } },
            { clientRequestId: '6', status: 'REJECTED_USER_REVIEW', retryCount: 0, payload: { dailyLogId: 'L3' } },
        ];
        expect(unsentRecordCount(rows, 1, 1)).toBe(2 + 1 + 1); // L1, C1 + a photo + a recording
    });

    it('the strip shows it beside the farm count without mixing them, and the failure words only for what needs him', () => {
        publishApprovalQueue(FARM, list(['a', 'b', 'c', 'd', 'e']));
        unsent.n = 2;
        const props = { language: 'mr' as const, farmId: FARM, onOpenSync: vi.fn(), onOpenWaiting: vi.fn() };
        render(<StripSignals {...props} needsYouCount={0} />);
        expect(screen.getByTestId('strip-unsent')).toHaveTextContent('पाठवणे बाकी २');
        expect(screen.getByTestId('strip-approval')).toHaveTextContent('मंजुरीसाठी ५');
        expect(document.body.textContent).not.toMatch(/अडकल/);
        cleanup();
        render(<StripSignals {...props} needsYouCount={1} />);
        expect(screen.getByTestId('strip-needs-you')).toBeInTheDocument();
    });

    it('with nothing waiting, the strip says only what it read: never "सर्व कामे पूर्ण"', () => {
        publishApprovalQueue(FARM, list([]));
        const props = { language: 'mr' as const, onOpenSync: vi.fn(), onOpenWaiting: vi.fn(), needsYouCount: 0 };
        render(<StripSignals {...props} farmId={FARM} />);
        expect(screen.getByTestId('strip-rest')).toHaveTextContent('मंजुरीसाठी नोंदी बाकी नाहीत');
        cleanup();
        render(<StripSignals {...props} farmId="unread-farm" />);
        expect(screen.getByTestId('strip-rest')).toHaveTextContent('यादी आत्ता दिसत नाही');
        expect(document.body.textContent).not.toMatch(/सर्व कामे पूर्ण/);
    });
});
