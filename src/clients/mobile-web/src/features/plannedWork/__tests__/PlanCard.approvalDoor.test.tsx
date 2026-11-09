// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-5; founder D-24d, D-3 "one approval path", D-30, TAP-1, P10) - the task card's
 * "मंजुरी बाकी" is one more door to THE review sheet. Over the card with the approval module's hook and door replaced by spies, so these
 * facts are about the card only:
 *   - the door shows only on a task in the Waiting state AND only when `useApprovalQueue(farm).mayConfirm` (the server's own answer) is true;
 *   - it calls `openApprovalReview` with the newest linked record the one list still holds, or with no record when none of them is in it;
 *   - the card has NO मंजूर / शंका / approve control and reads no role or authority of its own.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
    queue: { mayConfirm: true, data: null as null | { review: Array<{ id: string }> } },
    useQueue: vi.fn(),
    open: vi.fn(),
}));

vi.mock('../../approval/useApprovalQueue', () => ({
    useApprovalQueue: (...args: unknown[]) => { h.useQueue(...args); return h.queue; },
}));
vi.mock('../../approval/openApprovalReview', () => ({
    openApprovalReview: (...args: unknown[]) => h.open(...args),
}));

import { PlanCard } from '../components/PlanCard';
import type { LocalPlannedWork } from '../data/plannedWorkStore';

const ME = '22222222-2222-4222-8222-222222222222';
const RAJU = '11111111-1111-4111-8111-111111111111';
const FARM = '55555555-5555-4555-8555-555555555551';
const TODAY = new Date(2026, 10, 8);
const L1 = '66666666-6666-4666-8666-666666666661';
const L2 = '66666666-6666-4666-8666-666666666662';
const L3 = '66666666-6666-4666-8666-666666666663';

const task = (over: Partial<LocalPlannedWork> = {}): LocalPlannedWork => ({
    id: '33333333-3333-4333-8333-333333333331', farmId: FARM, title: 'फवारणी', scope: 'Plot', plotIds: ['p1'],
    plannedDate: '2026-11-10', looseWhen: null, plannedTime: null, assigneeUserId: RAJU, crewText: null, expectedHeadcount: null,
    quantityText: null, payMode: null, note: null, status: 'Done', sourceKind: 'PlanForm', recordedOn: '2026-11-08',
    createdByUserId: ME, modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false,
    plots: [{ plotId: 'p1', status: 'Done', confirmationState: 'Waiting' }], confirmationState: 'Waiting', linkedDailyLogIds: [L1],
    ...over,
});

const draw = (t: LocalPlannedWork, language = 'mr') =>
    render(<ul><PlanCard task={t} today={TODAY} me={ME} language={language} whereText="ऊस 1" assigneeName="राजू" assigneeRole="Worker" /></ul>);

const waiting = (ids: string[], mayConfirm = true) => { h.queue = { mayConfirm, data: { review: ids.map(id => ({ id })) } }; };
const door = () => screen.queryByTestId('plan-card-approval-door');

beforeEach(() => { vi.clearAllMocks(); waiting([L1]); });
afterEach(cleanup);

describe('the door on a Waiting card', () => {
    it('Door_is_shown_when_mayConfirm_is_true', () => {
        waiting([L1], true);
        draw(task());
        expect(door()).not.toBeNull();
        expect(door()).toHaveTextContent('मंजुरी बाकी — तपासा');
        // The state line L8c-3 draws stays as it was.
        expect(screen.getByTestId('plan-card-confirmation')).toHaveTextContent('झालं · मंजुरी बाकी');
        // The hook is asked about the task's own farm.
        expect(h.useQueue).toHaveBeenCalledWith(FARM);
    });

    it('Door_is_hidden_when_mayConfirm_is_false', () => {
        waiting([L1], false);
        draw(task());
        expect(door()).toBeNull();
        // Plain text, exactly as L8c-3 draws it.
        expect(screen.getByTestId('plan-card-confirmation')).toHaveTextContent('झालं · मंजुरी बाकी');
        expect(within(screen.getByTestId('plan-card-done')).queryAllByRole('button')).toHaveLength(0);
        expect(h.open).not.toHaveBeenCalled();
    });

    it('Tapping_the_door_calls_openApprovalReview_with_the_waiting_linked_log', () => {
        // L1 was already decided (not in the one list any more); L2 still waits; L3 is not this task's.
        waiting([L3, L2], true);
        draw(task({ linkedDailyLogIds: [L1, L2] }));
        fireEvent.click(door()!);
        expect(h.open).toHaveBeenCalledTimes(1);
        expect(h.open).toHaveBeenCalledWith(L2);
    });

    it('A_task_with_two_waiting_records_opens_on_the_newest', () => {
        // Linked in the order the work was done (the server appends): L2 is the newest. The list's own order must not matter.
        for (const review of [[L1, L2], [L2, L1]]) {
            h.open.mockClear();
            waiting(review, true);
            const { unmount } = draw(task({ linkedDailyLogIds: [L1, L2] }));
            fireEvent.click(door()!);
            expect(h.open).toHaveBeenCalledWith(L2);
            unmount();
        }
    });

    it('opens the sheet with no record when none of the linked logs is in the list, or the list is not loaded', () => {
        waiting([L3], true);
        draw(task({ linkedDailyLogIds: [L1, L2] }));
        fireEvent.click(door()!);
        expect(h.open).toHaveBeenLastCalledWith(null);
        cleanup();

        h.queue = { mayConfirm: true, data: null };
        draw(task({ linkedDailyLogIds: [L1, L2] }));
        fireEvent.click(door()!);
        expect(h.open).toHaveBeenLastCalledWith(null);
        cleanup();

        // A task row from before the field existed carries no linked ids at all.
        waiting([L1], true);
        draw(task({ linkedDailyLogIds: undefined }));
        fireEvent.click(door()!);
        expect(h.open).toHaveBeenLastCalledWith(null);
    });

    it('is a big target (TAP-1) and sits inside the done block of the card', () => {
        draw(task());
        expect(door()!.tagName).toBe('BUTTON');
        expect(door()).toHaveAttribute('type', 'button');
        expect(door()!.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        expect(within(screen.getByTestId('plan-card-done')).getByTestId('plan-card-approval-door')).toBe(door());
    });

    it('A_confirmed_or_disputed_card_shows_no_door', () => {
        for (const state of ['Confirmed', 'Disputed'] as const) {
            waiting([L1], true);
            draw(task({ confirmationState: state, plots: [{ plotId: 'p1', status: 'Done', confirmationState: state }] }));
            expect(door()).toBeNull();
            expect(screen.getByTestId('plan-card-confirmation')).toHaveTextContent(state === 'Confirmed' ? 'मंजूर' : 'शंका');
            cleanup();
        }
        // A task with no linked log (null) and an open task have no door either.
        draw(task({ confirmationState: null }));
        expect(door()).toBeNull();
        cleanup();
        draw(task({ status: 'Accepted', plots: [{ plotId: 'p1', status: 'Pending', confirmationState: null }], confirmationState: null }));
        expect(door()).toBeNull();
    });
});

describe('the card never approves (D-3)', () => {
    it('Waiting_card_has_no_approve_or_dispute_control', () => {
        waiting([L1], true);
        draw(task());
        const card = screen.getByTestId(`plan-${task().id}`);
        // The one button on the card is the door. Nothing says मंजूर or शंका; nothing is an approve / dispute control.
        const buttons = within(card).queryAllByRole('button');
        expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual(['plan-card-approval-door']);
        expect(card.textContent).not.toMatch(/मंजूर|शंका/);
        expect(within(card).queryAllByRole('link')).toHaveLength(0);
        expect(card.querySelector('[data-testid*="approve"], [data-testid*="dispute"], [data-testid*="confirm-button"]')).toBeNull();
        // The same in English.
        cleanup();
        draw(task(), 'en');
        const en = screen.getByTestId(`plan-${task().id}`);
        expect(en.textContent).not.toMatch(/\bApprove\b|\bApproved\b|\bDoubt\b|\bDispute\b/);
        expect(within(en).queryAllByRole('button').map(b => b.getAttribute('data-testid'))).toEqual(['plan-card-approval-door']);
    });

    it('tapping the door only opens the sheet: nothing is sent, nothing is decided', () => {
        draw(task());
        fireEvent.click(door()!);
        // The only call made is the door; the card has no other module to call.
        expect(h.open).toHaveBeenCalledTimes(1);
    });

    it('The_card_reads_no_authority_of_its_own', () => {
        const src = readFileSync(join(__dirname, '..', 'components', 'PlanCard.tsx'), 'utf8');
        const imports = src.split('\n').filter(line => /^\s*import\b/.test(line)).join('\n');
        // No farm-context, session, role or authority reader is imported; the only approval imports are the hook and the door.
        expect(imports).not.toMatch(/FarmContext|meContext|\/me\/|AuthTokenStore|authorit|holdsAuthority|useAuth|rolesOf|permission/i);
        expect(src).not.toMatch(/useFarmContext|useOptionalFarmContext|meContext|holdsAuthority|ConfirmRecords|canConfirm|canManageLabour|isPrimaryOwner/);
        const approvalImports = imports.split('\n').filter(l => /approval\//.test(l));
        expect(approvalImports.length).toBe(2);
        expect(approvalImports.join('\n')).toMatch(/useApprovalQueue/);
        expect(approvalImports.join('\n')).toMatch(/openApprovalReview/);
        expect(approvalImports.join('\n')).not.toMatch(/approvalQueue'|approvalWords|ApprovalReviewHost|VerifyLog/);
        // And it draws with no provider around it at all (this test mounts none): the door's one input is the hook's answer.
        waiting([L1], true);
        draw(task());
        expect(door()).not.toBeNull();
        cleanup();
        waiting([L1], false);
        draw(task());
        expect(door()).toBeNull();
    });
});

describe('the words of the door', () => {
    it('Marathi mode shows Marathi only on the door', () => {
        draw(task(), 'mr');
        expect(door()!.textContent).toBe('मंजुरी बाकी — तपासा');
        expect(door()!.textContent).not.toMatch(/[A-Za-z]/);
        expect(door()!.getAttribute('aria-label') ?? '').not.toMatch(/[A-Za-z]/);
        expect(screen.getByTestId(`plan-${task().id}`).style.fontFamily).toContain('Noto Sans Devanagari');
    });

    it('English mode shows English only on the door', () => {
        draw(task(), 'en');
        expect(door()).toHaveTextContent('Approval pending - review');
        expect(door()!.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId('plan-card-confirmation').textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId(`plan-${task().id}`).style.fontFamily).toContain('DM Sans');
    });
});
