// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 follow-up; founder D-44, "Redesign keeps every real feature") — the
 * final result screen has one way out ("झालं — पूर्ण शेतीचा आढावा बघा") and no blue detail button, so the owner's "पक्कं आहे" on his
 * OWN recording must stay reachable from पूर्ण शेतीचा आढावा. The path, pinned here as one journey:
 *   पूर्ण शेतीचा आढावा (main / reflect) → the header strip's "मंजुरीसाठी N" (`StripSignals` → `ApprovalChip`, drawn on log and reflect,
 *   `AppHeader.oversight.test`) → THE one review sheet (`ApprovalReviewHost`) → his own voice record's card → "मंजूर" → ONE owner
 *   confirmation (`VerifyLogCommand.enqueueOwnerConfirmation`, verify_log_v2) with the D-44 basis ('heard' once he played the voice
 *   to its end, else 'read') and the D-46 version — the same server handler the detail page's "पक्कं आहे" reaches.
 * The phone never hides the holder's own record from this list: the server lists every Draft / Confirmed record he may act on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { enqueue, enqueueOwnerConfirmation, triggerNow, fetchLabourData } = vi.hoisted(() => ({
    enqueue: vi.fn(), enqueueOwnerConfirmation: vi.fn(), triggerNow: vi.fn(), fetchLabourData: vi.fn(),
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
// The replay control is tested on its own; here it reports "played to the end".
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({
    default: (p: { dailyLogId: string; onHeard?: (id: string) => void }) =>
        React.createElement('button', { type: 'button', 'data-testid': `ov-play-${p.dailyLogId}`, onClick: () => p.onHeard?.(p.dailyLogId) }, 'मूळ आवाज ऐका'),
}));

import { ApprovalChip } from '../ApprovalChip';
import { ApprovalReviewHost } from '../ApprovalReviewHost';
import { publishApprovalQueue, resetApprovalQueueForTests } from '../approvalQueue';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

const OWNER = 'a1a1a1a1-0000-4000-8000-000000000001';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000aa';
/** The voice record he just saved on the result screen, once the server holds it (Draft, version 1, with its recording). */
const HIS_TALK = 'c3c3c3c3-0000-4000-8000-000000000003';

const hisOwnRecord: ReviewItem = {
    id: HIS_TALK, who: 'सुनील', initial: 'सु', tone: 'or', detail: '2026-11-28', status: 'Draft', version: 1, hasRecording: true,
    plot: 'प्लॉट १', plotScope: 'Plot', points: { task: 'फवारणी' },
};
const ownerList = (review: ReviewItem[]): LabourData => ({ ...EMPTY_LABOUR_DATA, review, canConfirm: true });

/** The router's half (AppRouter's `showReviewInbox`): the strip's chip opens the one host through the event. */
const Router: React.FC = () => {
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => {
        const l = () => setOpen(true);
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, l);
        return () => window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, l);
    }, []);
    return <ApprovalReviewHost open={open} onClose={() => setOpen(false)} farmId={FARM} ownName="सुनील" />;
};

describe('D-44 — the owner\'s "पक्कं आहे" on his own recording, from पूर्ण शेतीचा आढावा', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        enqueue.mockReset().mockResolvedValue('id');
        enqueueOwnerConfirmation.mockReset().mockResolvedValue('id');
        triggerNow.mockReset().mockResolvedValue(undefined);
        fetchLabourData.mockReset().mockResolvedValue(ownerList([hisOwnRecord]));
        setAuthSession({ userId: OWNER, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); resetApprovalQueueForTests(); });

    const openFromTheStrip = async () => {
        publishApprovalQueue(FARM, ownerList([hisOwnRecord]));
        render(<><Router /><ApprovalChip farmId={FARM} language="mr" variant="chip" data-testid="strip-approval" /></>);
        expect(screen.getByTestId('strip-approval')).toHaveTextContent('मंजुरीसाठी १');
        fireEvent.click(screen.getByTestId('strip-approval'));
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        expect(screen.getByTestId('review-sheet')).toHaveAttribute('aria-hidden', 'false');
    };

    it('his own just-saved talk is a card there, and its मंजूर is ONE owner confirmation, noted as READ, with the version shown', async () => {
        await openFromTheStrip();
        expect(screen.getByTestId(`review-card-${HIS_TALK}`)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId(`review-approve-${HIS_TALK}`));
        await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
        expect(enqueueOwnerConfirmation).toHaveBeenCalledTimes(1);
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith(HIS_TALK, { verifierUserId: OWNER, reviewBasis: 'read', logVersion: 1 });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('once he played his voice there to the end, the same confirmation is noted as HEARD (D-44)', async () => {
        await openFromTheStrip();
        fireEvent.click(screen.getByTestId(`ov-play-${HIS_TALK}`));
        fireEvent.click(screen.getByTestId(`review-approve-${HIS_TALK}`));
        await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith(HIS_TALK, { verifierUserId: OWNER, reviewBasis: 'heard', logVersion: 1 });
    });
});
