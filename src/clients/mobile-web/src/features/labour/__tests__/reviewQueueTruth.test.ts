// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 20 (spec: 2026-08-28-labour-v2-release-1) — the तपासणी queue lied about
 * itself in two ways, and this file pins both.
 *
 * DEFECT 1 — the card showed nothing to approve. `GetLabourDataHandler` sent
 * an all-null `LabourPointsDto` for every review row, so the card rendered a
 * coloured circle, a name and a relative date and nothing else. An owner who
 * cannot see WHAT he is approving taps सगळं मंजूर on a backlog and approves it
 * unseen — worse than having no approval step, because the system then records
 * that he checked. The four facts he judges by are headcount, work, plot and
 * money; each is either shown or explicitly marked unknown with an em-dash.
 * NEVER a `0` or `₹0` — that is a claim, not a blank.
 *
 * DEFECT 2 — the badge and the list counted different things. The server
 * counted every unapproved log; the sheet then dropped anything older than 14
 * days before rendering. The tile said 60, the sheet showed 12, the badge could
 * never reach zero, and work older than a fortnight was unreachable from every
 * screen in the app. Both now render the SAME set, and the sheet may not claim
 * "तपासायला काही उरलं नाही" while unapproved work exists.
 *
 * The sync/undo machinery is mocked exactly as in `reviewApprove.test.ts` —
 * this file never approves anything, it only reads what the screen states.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import ReviewSheet from '../components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, ReviewItem } from '../labourMock';
import { oversightTranslations } from '../../../i18n/oversightTranslations';

const ENTIRE_FARM = oversightTranslations.mr.entireFarmLabel;

const toLocalIsoDate = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgoIso = (days: number): string =>
    toLocalIsoDate(new Date(Date.now() - days * 86_400_000));

function item(over: Partial<ReviewItem> & { id: string }): ReviewItem {
    return {
        who: 'धनाजी',
        initial: 'ध',
        tone: 'or',
        detail: daysAgoIso(0),
        status: 'Confirmed',
        points: {},
        ...over,
    };
}

/** `pending` mirrors the server contract: it is the size of `review`, always. */
function dataWith(review: ReviewItem[]): LabourData {
    return {
        ...EMPTY_LABOUR_DATA,
        dashboard: { ...EMPTY_LABOUR_DATA.dashboard, pending: review.length },
        review,
    };
}

const mount = (review: ReviewItem[]) =>
    render(React.createElement(ReviewSheet, {
        open: true, data: dataWith(review), onClose: vi.fn(), onToast: vi.fn(),
    }));

afterEach(cleanup);

describe('DEFECT 1 — the approval card carries what the owner judges by', () => {
    it('shows headcount, work, plot and money for a real मुकादम entry', () => {
        mount([item({
            id: 'm1',
            plot: 'ऊस-१',
            plotScope: 'Plot',
            points: { count: 8, task: 'ऊस तोडणी', amount: 2400 },
        })]);

        const card = within(screen.getByTestId('review-card-m1'));
        expect(card.getByTestId('review-fact-count-m1')).toHaveTextContent('८');
        expect(card.getByTestId('review-fact-task-m1')).toHaveTextContent('ऊस तोडणी');
        expect(card.getByTestId('review-fact-plot-m1')).toHaveTextContent('ऊस-१');
        expect(card.getByTestId('review-fact-amount-m1')).toHaveTextContent('2,400');
    });

    it('renders an em-dash for every fact the record does not carry — never a zero', () => {
        mount([item({ id: 'blank', points: {} })]);

        const card = within(screen.getByTestId('review-card-blank'));
        for (const slot of ['count', 'task', 'plot', 'amount']) {
            const cell = card.getByTestId(`review-fact-${slot}-blank`);
            expect(cell).toHaveTextContent('—');
            // "0 मजूर" / "₹0" would assert nobody came and nothing is owed.
            expect(cell.textContent).not.toMatch(/0|०/);
        }
    });

    it('every fact slot is present even when unknown — absence is stated, never silently dropped', () => {
        mount([item({ id: 'blank2', points: { count: 4 } })]);

        const card = within(screen.getByTestId('review-card-blank2'));
        expect(card.getByTestId('review-fact-count-blank2')).toHaveTextContent('४');
        expect(card.getByTestId('review-fact-task-blank2')).toBeInTheDocument();
        expect(card.getByTestId('review-fact-plot-blank2')).toBeInTheDocument();
        expect(card.getByTestId('review-fact-amount-blank2')).toBeInTheDocument();
    });

    it('a farm-wide log says संपूर्ण शेत instead of an em-dash — that scope is a stated fact', () => {
        mount([item({ id: 'fw', plot: null, plotScope: 'Farm', points: { count: 3 } })]);

        expect(screen.getByTestId('review-fact-plot-fw')).toHaveTextContent(ENTIRE_FARM);
    });

    it('a genuinely stated ₹0 is still shown as ₹0 — only ABSENCE becomes an em-dash', () => {
        mount([item({ id: 'zero', points: { count: 2, amount: 0 } })]);

        const cell = screen.getByTestId('review-fact-amount-zero');
        expect(cell).toHaveTextContent('₹0');
        expect(cell).not.toHaveTextContent('—');
    });
});

describe('DEFECT 2 — the badge and the list are the same set, and nothing is hidden', () => {
    it('renders work older than a fortnight instead of dropping it off every screen', () => {
        mount([
            item({ id: 'recent', detail: daysAgoIso(1) }),
            item({ id: 'old', detail: daysAgoIso(30) }),
            item({ id: 'ancient', detail: daysAgoIso(400) }),
        ]);

        expect(screen.getByTestId('review-card-recent')).toBeInTheDocument();
        expect(screen.getByTestId('review-card-old')).toBeInTheDocument();
        expect(screen.getByTestId('review-card-ancient')).toBeInTheDocument();
    });

    it('the sheet header states the same count the तपासा badge does', () => {
        const review = [
            item({ id: 'a', detail: daysAgoIso(0) }),
            item({ id: 'b', detail: daysAgoIso(20) }),
            item({ id: 'c', detail: daysAgoIso(90) }),
        ];
        const data = dataWith(review);

        render(React.createElement(ReviewSheet, {
            open: true, data, onClose: vi.fn(), onToast: vi.fn(),
        }));

        expect(screen.getByText(`${data.dashboard.pending} नोंदी — मंजूर करा`)).toBeInTheDocument();
    });

    it('never claims "तपासायला काही उरलं नाही" while unapproved work exists', () => {
        mount([item({ id: 'old-only', detail: daysAgoIso(45) })]);

        expect(screen.queryByText(/तपासायला काही उरलं नाही/)).toBeNull();
        expect(screen.queryByText('सगळं झालं ✓')).toBeNull();
    });

    it('still says "सगळं झालं" when the queue really is empty', () => {
        mount([]);

        expect(screen.getByText('सगळं झालं ✓')).toBeInTheDocument();
        expect(screen.getByText(/तपासायला काही उरलं नाही/)).toBeInTheDocument();
    });

    it('offers सगळं मंजूर over the WHOLE queue, not a silently narrowed slice', () => {
        mount([
            item({ id: 'x1', detail: daysAgoIso(2) }),
            item({ id: 'x2', detail: daysAgoIso(60) }),
        ]);

        expect(screen.getByTestId('review-approve-all')).toHaveTextContent('सगळं मंजूर (2)');
    });
});
