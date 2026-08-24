// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * THE APP MAY NOT OFFER AN APPROVAL IT CANNOT DELIVER.
 *
 * `ReviewInboxSheet` is where the waiting drawer's "N कामे तपासायची आहेत"
 * row lands (`AppHeader.handleOpenDecision` -> `requestOpenReviewInbox()` ->
 * `AppRouter` -> `globalSheets.tsx`). It used to carry four approve/dispute
 * affordances, all of which queued `verify_log_v2` — a mutation
 * `PushSyncBatchHandler.cs` answers with `MUTATION_TYPE_UNIMPLEMENTED` and
 * `RejectionPolicy.ts` classifies as PERMANENT. Every tap produced a
 * durable `REJECTED_USER_REVIEW` row while the owner was shown a tick.
 *
 * These tests pin the two halves of the repair:
 *
 *   the_sheet_offers_no_approve_or_dispute_control
 *     — none of the four affordances renders, for a sheet holding TWO
 *       entries (two, because "Verify now" and "Approve all" only appeared
 *       above one).
 *
 *   the_sheet_says_why_there_is_no_approve_button
 *     — the absence is explained, not silent (`P5`). A removed control with
 *       no words leaves the owner hunting for it.
 *
 * The list itself must survive both: reading what happened on the farm is
 * the oversight loop's entire purpose and needs no server write.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { t as translate, type Language } from '../../../../i18n/translations';
import { approvalAvailabilityTranslations } from '../../../../i18n/approvalAvailabilityTranslations';
import { APPROVAL_UNAVAILABLE_NOTICE_TESTID } from '../../../../shared/components/ApprovalUnavailableNotice';

const langRef = { current: 'en' as Language };

// The real `useLanguage` throws outside `<LanguageProvider>`, and `render`
// mounts none. Same stand-in `FarmWideTodayPanel.test.tsx` beside this file
// uses, so the shipped strings — not keys — are what gets asserted.
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

import { ReviewInboxSheet } from '../ReviewInboxSheet';
import { LogVerificationStatus } from '../../../../types';
import type { DailyLog, FarmOperator } from '../../../../types';

afterEach(() => {
    cleanup();
    langRef.current = 'en';
});

function makeLog(id: string): DailyLog {
    return {
        id,
        date: '2026-08-20',
        context: {
            selection: [{
                cropId: 'crop-1',
                cropName: 'Grapes',
                selectedPlotIds: ['plot-1'],
                selectedPlotNames: ['Grapes A'],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        meta: {
            createdAtISO: '2026-08-20T05:00:00.000Z',
            // Created by SOMEONE ELSE — `getLogsNeedingReview`'s own filter.
            createdByOperatorId: 'op-mukadam',
        },
        verification: { status: LogVerificationStatus.CONFIRMED, required: true },
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            totalActivityExpenses: 0,
            grandTotal: 0,
        },
    };
}

const OPERATORS: FarmOperator[] = [{
    id: 'op-mukadam',
    name: 'Ganesh',
    role: 'MUKADAM',
    capabilities: [],
    isVerifier: false,
}];

function renderSheet() {
    return render(
        <ReviewInboxSheet
            isOpen
            onClose={() => { }}
            logs={[makeLog('log-1'), makeLog('log-2')]}
            operators={OPERATORS}
            currentOperatorId="op-owner"
        />,
    );
}

describe('ReviewInboxSheet — no approval it cannot deliver', () => {
    it('the_sheet_offers_no_approve_or_dispute_control', () => {
        renderSheet();

        // Sanity: the two entries really are in the review set, so a passing
        // assertion below cannot be an empty-list false positive.
        expect(screen.getByText(/2 entries awaiting verification/i)).toBeInTheDocument();

        // The batch affordances, by their own shipped labels.
        expect(screen.queryByRole('button', { name: /verify now/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();

        // The per-card tick + dispute bubble were `<button>`s too. With all
        // four affordances gone, the ONLY <button> this sheet still renders
        // is its close control — the card's own expand/collapse header is a
        // clickable <div> (pre-existing; not this change's to fix). Counting
        // is what makes this survive a renaming of any one of them.
        const sheetButtons = screen.getAllByRole('button');
        expect(sheetButtons).toHaveLength(1);

        // And none of them is styled as the app's approve colour (`P-G`:
        // emerald already means Approve — `ReviewInbox.tsx`, `AttentionCard.tsx`).
        for (const button of sheetButtons) {
            expect(button.className).not.toMatch(/emerald/);
        }
    });

    it('the_sheet_says_why_there_is_no_approve_button', () => {
        renderSheet();

        const notice = screen.getByTestId(APPROVAL_UNAVAILABLE_NOTICE_TESTID);
        expect(notice).toBeInTheDocument();
        expect(
            within(notice).getByText(approvalAvailabilityTranslations.en.approvalUnavailableTitle),
        ).toBeInTheDocument();
        expect(
            within(notice).getByText(approvalAvailabilityTranslations.en.approvalUnavailableBody),
        ).toBeInTheDocument();
    });

    it('the_entries_are_still_readable', () => {
        renderSheet();

        // The point of keeping the sheet: the owner can still see who did
        // what. Two cards, both naming the person who recorded them.
        expect(screen.getAllByText('Ganesh')).toHaveLength(2);
    });
});
