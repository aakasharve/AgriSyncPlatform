// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and
// when"). One bill's मंजूर line, as every door that shows a bill draws it:
//   - "मंजूर करा" only for a reviewer, only on a bill no stamp covers at its version, never while one is on its way;
//   - the stamp words in Marathi and their English twin — one language at a time;
//   - the "this bill changed" screen (the L4b pattern): the new version is shown, and approvable only once it is here;
//   - withheld money reads "—", never ₹0.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveMoneyEvent } from '../../finance.types';
import type { BillApprovalOutbox } from '../../billApproval';

const h = vi.hoisted(() => ({ approveBill: vi.fn() }));
vi.mock('../../billApproval', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../billApproval')>()),
    approveBill: h.approveBill,
}));

import { BillApprovalLine } from '../BillApprovalLine';

const FARM = '11111111-1111-4111-8111-111111111111';
const NONE: BillApprovalOutbox = { pending: new Set(), changed: new Map(), refused: new Map() };

const bill = (over: Partial<EffectiveMoneyEvent> = {}): EffectiveMoneyEvent => ({
    id: 'bill-1', farmId: FARM, dateTime: '2026-11-06T00:00:00Z', type: 'Expense', category: 'Input', amount: 31234.56,
    sourceType: 'Manual', sourceId: 'bill-1', createdByUserId: 'u-1', trustStatus: 'Unverified', reviewStatus: 'NeedsReview',
    priceSource: 'Unknown', createdAt: '2026-11-06T00:00:00Z', effectiveAmount: 31234.56, adjustments: [], billVersion: 1,
    ...over,
});

const approval = (billVersion: number, approvedByName: string | null = 'मुकादम-गणेश') => ({
    id: 'a-1', approvedByUserId: 'u-2', approvedAtUtc: '2026-11-07T05:30:00Z', billVersion,
    ...(approvedByName ? { approvedByName } : {}),
});

function draw(props: Partial<React.ComponentProps<typeof BillApprovalLine>> = {}) {
    const onQueued = vi.fn();
    render(<BillApprovalLine bill={bill()} mayApprove={true} outbox={NONE} language="mr" onQueued={onQueued} {...props} />);
    return { onQueued };
}

beforeEach(() => { h.approveBill.mockReset(); h.approveBill.mockResolvedValue({}); });
afterEach(cleanup);

describe('the action shows only for reviewers', () => {
    it('a reviewer sees "मंजूर करा" on a bill nobody approved, and it queues the version on screen', async () => {
        const { onQueued } = draw({ bill: bill({ billVersion: 4 }) });
        fireEvent.click(screen.getByTestId('bill-approve-bill-1'));
        await waitFor(() => expect(onQueued).toHaveBeenCalled());
        expect(screen.getByTestId('bill-approve-bill-1')).toHaveTextContent('मंजूर करा');
        expect(h.approveBill).toHaveBeenCalledWith(expect.objectContaining({ id: 'bill-1', billVersion: 4 }), undefined);
    });

    it('anyone else sees the stamp where he sees the bill, and never the action', () => {
        draw({ mayApprove: false, bill: bill({ approval: approval(1) }) });
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveTextContent('मंजूर · मुकादम-गणेश ·');
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('no action on a bill already approved at its version, on one still on its way, or one the server has no version for', () => {
        draw({ bill: bill({ approval: approval(1), trustStatus: 'Verified', reviewStatus: 'OK' }) });
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
        cleanup();
        draw({ outbox: { ...NONE, pending: new Set(['bill-1']) } });
        expect(screen.getByTestId('bill-pending-bill-1')).toHaveTextContent('मंजुरी पाठवायची आहे');
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
        cleanup();
        draw({ bill: bill({ billVersion: undefined }) });
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
    });
});

describe('the stamp words, one language at a time', () => {
    it('Marathi: मंजूर · ‹नाव› · ‹दिवस› (the farm\'s calendar)', () => {
        draw({ mayApprove: false, bill: bill({ approval: approval(1) }) });
        const line = screen.getByTestId('bill-stamp-bill-1');
        expect(line).toHaveTextContent(/^मंजूर · मुकादम-गणेश · 7 नोव्हें\.?,? 2026$/);
        expect(line.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('English: Approved · ‹name› · ‹day›', () => {
        draw({ mayApprove: false, language: 'en', bill: bill({ approval: approval(1, 'Ganesh') }) });
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveTextContent(/^Approved · Ganesh · 7 Nov 2026$/);
    });

    it('a stamp for an older version says so, in both languages, and the reviewer may approve the new one', () => {
        draw({ bill: bill({ billVersion: 2, approval: approval(1) }) });
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveTextContent('आधीच्या रूपाला मंजूर · मुकादम-गणेश');
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveAttribute('data-stamp', 'approvedOlder');
        // fix round 1 (review L1) — a version also moves with the place or day, so the words say the BILL changed.
        expect(screen.getByText('नंतर बिल बदललं — पुन्हा पाहून मंजूर करा')).toBeInTheDocument();
        expect(screen.getByTestId('bill-approve-bill-1')).toBeInTheDocument();
        cleanup();
        draw({ language: 'en', bill: bill({ billVersion: 2, approval: approval(1, 'Ganesh') }) });
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveTextContent('Approved for an earlier version · Ganesh');
        expect(screen.getByTestId('bill-approve-bill-1')).toHaveTextContent('Approve');
    });

    it('a name this person is not sent is left out, never guessed', () => {
        draw({ mayApprove: false, bill: bill({ approval: approval(1, null) }) });
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveTextContent(/^मंजूर · 7 नोव्हें/);
    });
});

describe('the "this bill changed" screen (the L4b pattern)', () => {
    const changed = (seenVersion: number): BillApprovalOutbox => ({ ...NONE, changed: new Map([['bill-1', { rowId: 41, seenVersion }]]) });

    it('shows the new amount and approves the NEW version, settling the parked row', async () => {
        const { onQueued } = draw({ bill: bill({ billVersion: 2, effectiveAmount: 32109.87 }), outbox: changed(1) });
        const screenOfIt = screen.getByTestId('bill-changed-bill-1');
        expect(screenOfIt).toHaveTextContent('हे बिल बदललं आहे — नवीन रूप पाहून पुन्हा मंजूर करा');
        expect(screenOfIt).toHaveTextContent('आताची रक्कम: ₹ 32,110');
        fireEvent.click(screen.getByTestId('bill-approve-bill-1'));
        await waitFor(() => expect(onQueued).toHaveBeenCalled());
        expect(h.approveBill).toHaveBeenCalledWith(expect.objectContaining({ billVersion: 2 }), 41);
    });

    it('until the new version reaches this phone, it says so and offers nothing to tap', () => {
        draw({ bill: bill({ billVersion: 1 }), outbox: changed(1) });
        expect(screen.getByTestId('bill-changed-bill-1')).toHaveTextContent('नवीन रूप अजून या फोनवर आलं नाही');
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
    });

    it('in English mode, the English twin', () => {
        draw({ language: 'en', bill: bill({ billVersion: 2 }), outbox: changed(1) });
        expect(screen.getByTestId('bill-changed-bill-1')).toHaveTextContent('This bill changed — look at the new version and approve again');
        expect(screen.getByTestId('bill-changed-bill-1').textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('withheld money reads "—", never ₹0', () => {
        draw({ bill: bill({ billVersion: 2, effectiveAmount: Number.NaN }), outbox: changed(1) });
        expect(screen.getByTestId('bill-changed-bill-1')).toHaveTextContent('आताची रक्कम: —');
        expect(screen.getByTestId('bill-changed-bill-1')).not.toHaveTextContent('₹ 0');
    });

    it('fix round 1 (review L5): once someone stamped the version it stands at, the old "changed" box is gone', () => {
        draw({ bill: bill({ billVersion: 2, approval: approval(2), trustStatus: 'Verified', reviewStatus: 'OK' }), outbox: changed(1) });
        expect(screen.queryByTestId('bill-changed-bill-1')).toBeNull();
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveAttribute('data-stamp', 'approved');
        expect(screen.queryByTestId('bill-approve-bill-1')).toBeNull();
    });

    it('a refusal for another reason is said as a ShramSafal rule, by its code', () => {
        draw({ outbox: { ...NONE, refused: new Map([['bill-1', 'ShramSafal.PlotScope.Forbidden']]) } });
        expect(screen.getByTestId('bill-refused-bill-1')).toHaveTextContent('श्रमसफलच्या नियमानुसार हे बिल तुम्ही मंजूर करू शकत नाही');
    });
});

// lane BILL-1b (founder D-105 (b), 2026-11-08): once a bill is approved only the main owner changes its price, and the bill then
// shows "मालकाने बदलला" / "Changed by owner" (PROPOSED words) with the date to EVERYONE who sees it, the owner included.
describe('the mark "changed by owner"', () => {
    const OWNER_CHANGE = '2026-11-08T05:30:00Z';
    const changedByOwner = (over: Partial<EffectiveMoneyEvent> = {}) =>
        bill({ billVersion: 2, approval: approval(1), changedByOwnerAtUtc: OWNER_CHANGE, ...over });

    it('Marathi: मालकाने बदलला · ‹दिवस›, shown to a reviewer AND to a seat that cannot approve (the owner sees it the same way)', () => {
        draw({ bill: changedByOwner() });
        const mark = screen.getByTestId('bill-owner-change-bill-1');
        expect(mark).toHaveTextContent(/^मालकाने बदलला · 8 नोव्हें\.?,? 2026$/);
        expect(mark.textContent).not.toMatch(/[A-Za-z]/);
        // The old stamp stays in the history beside it.
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveAttribute('data-stamp', 'approvedOlder');
        cleanup();
        draw({ mayApprove: false, bill: changedByOwner() });
        expect(screen.getByTestId('bill-owner-change-bill-1')).toHaveTextContent('मालकाने बदलला');
    });

    it('English: Changed by owner · ‹day›', () => {
        draw({ language: 'en', bill: changedByOwner({ approval: approval(1, 'Ganesh') }) });
        expect(screen.getByTestId('bill-owner-change-bill-1')).toHaveTextContent(/^Changed by owner · 8 Nov 2026$/);
        expect(screen.getByTestId('bill-owner-change-bill-1').textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('it stays after the new version is approved (the bill\'s history never lies), and a bill with no such change shows no mark', () => {
        draw({ mayApprove: false, bill: changedByOwner({ billVersion: 2, approval: approval(2), trustStatus: 'Verified', reviewStatus: 'OK' }) });
        expect(screen.getByTestId('bill-owner-change-bill-1')).toBeInTheDocument();
        expect(screen.getByTestId('bill-stamp-bill-1')).toHaveAttribute('data-stamp', 'approved');
        cleanup();
        draw({ bill: bill({ approval: approval(1) }) });
        expect(screen.queryByTestId('bill-owner-change-bill-1')).toBeNull();
    });
});
