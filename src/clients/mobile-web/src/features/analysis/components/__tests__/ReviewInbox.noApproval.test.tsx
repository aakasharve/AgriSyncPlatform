// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * The SECOND surface that offered an approval the server refuses.
 *
 * `ReviewInbox` sits on Reflect (`ReflectPage.tsx`, gated on
 * `currentOperator.isVerifier`). Its `bg-emerald-600` "Approve" button
 * called `ReflectPage`'s `onVerifyLog` -> `useTrustLayer` ->
 * `application/usecases/VerifyLog.ts` -> `verify_log_v2`, whose handler
 * returns `MUTATION_TYPE_UNIMPLEMENTED`. Same defect as
 * `ReviewInboxSheet`'s, on a different screen — so it gets its own pin,
 * because "the other file's test passes" has never stopped this one
 * regressing.
 *
 *   the_reflect_inbox_offers_no_approve_button
 *   the_reflect_inbox_says_why_there_is_no_approve_button
 *   the_reflect_inbox_can_still_open_an_entry   (View survives; reading is
 *     the point and needs no server write)
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import ReviewInbox from '../ReviewInbox';
import { LogVerificationStatus } from '../../../../types';
import type { DailyLog, FarmOperator } from '../../../../types';
import { approvalAvailabilityTranslations } from '../../../../i18n/approvalAvailabilityTranslations';
import { APPROVAL_UNAVAILABLE_NOTICE_TESTID } from '../../../../shared/components/ApprovalUnavailableNotice';

afterEach(() => {
    cleanup();
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
            createdByOperatorId: 'op-mukadam',
        },
        verification: { status: LogVerificationStatus.PENDING, required: true },
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

describe('ReviewInbox (Reflect) — read-only, and says so', () => {
    it('the_reflect_inbox_offers_no_approve_button', () => {
        render(
            <ReviewInbox pendingLogs={[makeLog('log-1')]} operators={OPERATORS} onViewLog={() => { }} />,
        );

        // Sanity: the row really rendered, so a null query below is not an
        // empty-list false positive.
        expect(screen.getByText(/1 log pending verification/i)).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();

        // `P-G`: emerald means Approve in this app. No control in this card
        // may carry it any more.
        for (const button of screen.getAllByRole('button')) {
            expect(button.className).not.toMatch(/emerald/);
        }
    });

    it('the_reflect_inbox_says_why_there_is_no_approve_button', () => {
        render(
            <ReviewInbox pendingLogs={[makeLog('log-1')]} operators={OPERATORS} onViewLog={() => { }} />,
        );

        const notice = screen.getByTestId(APPROVAL_UNAVAILABLE_NOTICE_TESTID);
        expect(
            within(notice).getByText(approvalAvailabilityTranslations.en.approvalUnavailableTitle),
        ).toBeInTheDocument();
        expect(
            within(notice).getByText(approvalAvailabilityTranslations.en.approvalUnavailableBody),
        ).toBeInTheDocument();
    });

    it('the_reflect_inbox_can_still_open_an_entry', () => {
        const onViewLog = vi.fn();
        render(
            <ReviewInbox pendingLogs={[makeLog('log-1')]} operators={OPERATORS} onViewLog={onViewLog} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'View' }));

        expect(onViewLog).toHaveBeenCalledTimes(1);
        expect(onViewLog.mock.calls[0][0].id).toBe('log-1');
    });
});
