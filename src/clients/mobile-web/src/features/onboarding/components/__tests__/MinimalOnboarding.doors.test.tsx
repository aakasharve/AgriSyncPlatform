// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-3 / MU-1, FR-7, FR-8, LANG-2).
 * A signed-in person with no farm sees two EQUAL doors and no role question (PLR-D7 §5):
 *   - "माझं शेत सुरू करायचं" opens the REAL create-farm form (his name kept + the farm's name →
 *     POST /bootstrap/first-farm);
 *   - "मला बोलावलं आहे" opens the REAL join door (the caller's `onJoinViaQr` → JoinByCodeScreen).
 * Each step has ONE "← मागे"; a request still waiting for the owner is said on top; Marathi only.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// A plain function, not a module-level vi.fn: with the vi.fn, a rejection the component HANDLED (the
// Marathi error was on screen, every assertion passed) was still reported as this test's failure.
// A plain function is not. The cause inside the spy was not pinned down; the behaviour under test is.
const h = vi.hoisted(() => ({
    calls: [] as unknown[][],
    impl: (..._a: unknown[]): Promise<unknown> => Promise.resolve({}),
    english: false,
}));
// No provider = the app's default, Marathi; `h.english` = a person who chose English on स्वागत.
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.english ? { language: 'en', setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
vi.mock('../../qr/inviteApi', () => ({
    bootstrapFirstFarm: (...a: unknown[]) => { h.calls.push(a); return h.impl(...a); },
    // The real predicate (inviteApi.ts): an answer from the server has `error` and `status`.
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));
vi.mock('../../../../pages/onboarding/DawnScene', () => ({ default: () => null }));

import MinimalOnboarding from '../MinimalOnboarding';

beforeEach(() => {
    h.calls = [];
    h.impl = () => Promise.resolve({});
});
afterEach(cleanup);

const latinWords = (el: HTMLElement) => (el.textContent ?? '').replace(/QR|OTP/g, '').match(/[A-Za-z]{3,}/g);

function mount(extra: Partial<React.ComponentProps<typeof MinimalOnboarding>> = {}) {
    const props = { isOpen: true, onComplete: vi.fn(), onJoinViaQr: vi.fn(), onBack: vi.fn(), ...extra };
    render(<MinimalOnboarding {...props} />);
    return props;
}

describe('the 0-farm screen: two equal doors', () => {
    it('opens on the two doors, the same size, with the approved words and no role question', () => {
        mount();
        const own = screen.getByTestId('door-own-farm');
        const invited = screen.getByTestId('door-invited');
        expect(screen.getByTestId('first-farm-doors-title')).toHaveTextContent('तुम्ही इथे कसे आलात?');
        expect(own).toHaveTextContent('माझं शेत सुरू करायचं');
        expect(own).toHaveTextContent('तुम्ही शेताचे मालक');
        expect(invited).toHaveTextContent('मला बोलावलं आहे');
        expect(invited).toHaveTextContent('QR स्कॅन करा किंवा शेत कोड टाका — भूमिका मालक ठरवतो');
        // EQUAL doors: the same height and width classes.
        for (const cls of ['min-h-[132px]', 'w-full', 'rounded-[28px]']) {
            expect(own.className).toContain(cls);
            expect(invited.className).toContain(cls);
        }
        // No role question at all: nothing to pick a role with, no form yet.
        expect(screen.queryByText(/भूमिका निवडा|तुमची भूमिका काय/)).toBeNull();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(latinWords(screen.getByTestId('first-farm-doors'))).toBeNull();
    });

    it('"मला बोलावलं आहे" opens the real join door (code or QR)', () => {
        const p = mount();
        fireEvent.click(screen.getByTestId('door-invited'));
        expect(p.onJoinViaQr).toHaveBeenCalledTimes(1);
    });

    it('"माझं शेत सुरू करायचं" opens the real create form; his name is kept; it creates the farm', async () => {
        h.impl = async () => ({ farmId: 'f-new', farmName: 'आर्वे शेती', farmCode: 'ABC123', ownerAccountId: 'o', subscription: null, wasAlreadyBootstrapped: false });
        const p = mount();
        fireEvent.click(screen.getByTestId('door-own-farm'));

        const form = screen.getByTestId('first-farm-create');
        expect(screen.getByLabelText('तुमचे नाव')).toBeInTheDocument();
        expect(screen.getByLabelText('शेताचे नाव')).toBeInTheDocument();
        expect(latinWords(form)).toBeNull();

        const submit = screen.getByTestId('first-farm-create-submit');
        expect(submit).toHaveTextContent('शेत तयार करा');
        expect(submit).toBeDisabled();

        fireEvent.change(screen.getByLabelText('तुमचे नाव'), { target: { value: 'पुरुषोत्तम' } });
        fireEvent.change(screen.getByLabelText('शेताचे नाव'), { target: { value: 'आर्वे शेती' } });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        await waitFor(() => expect(p.onComplete).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'f-new' })));
        expect(h.calls).toEqual([['आर्वे शेती', undefined, 'पुरुषोत्तम']]);
    });

    it('a failed create says so in Marathi (never the server\'s English) and keeps what he typed', async () => {
        h.impl = () => Promise.reject(Object.assign(new Error('Farm name already exists'), { status: 409 }));
        mount();
        fireEvent.click(screen.getByTestId('door-own-farm'));
        fireEvent.change(screen.getByLabelText('तुमचे नाव'), { target: { value: 'पुरुषोत्तम' } });
        fireEvent.change(screen.getByLabelText('शेताचे नाव'), { target: { value: 'आर्वे शेती' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('शेत तयार करता आलं नाही');
        expect(alert.textContent).not.toMatch(/[A-Za-z]{3,}/);
        expect(screen.getByLabelText('शेताचे नाव')).toHaveValue('आर्वे शेती');
    });

    it('ONE "← मागे" on each step: the form goes back to the doors; the doors go back to the phone number', () => {
        const p = mount();
        expect(screen.getAllByRole('button', { name: 'मागे' })).toHaveLength(1);
        fireEvent.click(screen.getByTestId('door-own-farm'));
        expect(screen.getAllByRole('button', { name: 'मागे' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();
        expect(p.onBack).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        fireEvent.click(screen.getByRole('button', { name: 'बाहेर पडा' }));
        expect(p.onBack).toHaveBeenCalledTimes(1);
    });

    it('the doors\' back signs out only after asking: one mis-tap does not cost a new OTP', () => {
        const p = mount();
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        // Asked, not done.
        expect(p.onBack).not.toHaveBeenCalled();
        const ask = screen.getByRole('alertdialog');
        expect(ask).toHaveTextContent('बाहेर पडायचं?');
        expect(ask).toHaveTextContent('पुन्हा आत येताना फोन नंबर आणि OTP लागेल.');
        // "इथेच राहा" keeps him on the doors, signed in.
        fireEvent.click(screen.getByRole('button', { name: 'इथेच राहा' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.getByTestId('door-own-farm')).toBeInTheDocument();
        expect(p.onBack).not.toHaveBeenCalled();
        // "बाहेर पडा" is the sign-out.
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        fireEvent.click(screen.getByRole('button', { name: 'बाहेर पडा' }));
        expect(p.onBack).toHaveBeenCalledTimes(1);
    });

    // Round-2 review A11Y-1: a screen-reader or keyboard user is moved to the question.
    it('the "बाहेर पडायचं?" question takes the focus on the safe answer; Escape or "इथेच राहा" gives it back to मागे', () => {
        const p = mount();
        const back = screen.getByRole('button', { name: 'मागे' });
        back.focus();
        fireEvent.click(back);
        expect(screen.getByRole('button', { name: 'इथेच राहा' })).toHaveFocus();

        fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(back).toHaveFocus();

        fireEvent.click(back);
        expect(screen.getByRole('button', { name: 'इथेच राहा' })).toHaveFocus();
        fireEvent.click(screen.getByRole('button', { name: 'इथेच राहा' }));
        expect(back).toHaveFocus();
        expect(p.onBack).not.toHaveBeenCalled();
    });

    it('each known refusal of the farm creation has its own Marathi line ("internet" only when nothing answered)', async () => {
        const failWith = async (err: unknown) => {
            cleanup();
            h.impl = () => Promise.reject(err);
            mount();
            fireEvent.click(screen.getByTestId('door-own-farm'));
            fireEvent.change(screen.getByLabelText('तुमचे नाव'), { target: { value: 'पुरुषोत्तम' } });
            fireEvent.change(screen.getByLabelText('शेताचे नाव'), { target: { value: 'आर्वे शेती' } });
            fireEvent.click(screen.getByTestId('first-farm-create-submit'));
            return (await screen.findByRole('alert')).textContent;
        };
        expect(await failWith({ error: 'bootstrap.phone_not_verified', message: 'Verify your phone first.', status: 403 }))
            .toBe('शेत तयार करता आलं नाही. आधी फोन नंबर OTP ने पडताळा.');
        expect(await failWith({ error: 'invite.unknown', message: 'Server returned 401.', status: 401 }))
            .toBe('शेत तयार करता आलं नाही. मागे जाऊन पुन्हा लॉग इन करा.');
        expect(await failWith({ error: 'invite.unknown', message: 'Server returned 500.', status: 500 }))
            .toBe('शेत तयार करता आलं नाही. थोड्या वेळाने पुन्हा प्रयत्न करा.');
        // fetch itself threw: the request never reached the server.
        expect(await failWith(new TypeError('Failed to fetch')))
            .toBe('शेत तयार करता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.');
    });

    it('a request still waiting for the owner is said on top (the waiting message), and the doors stay', () => {
        mount({ pendingSeats: [{ farmId: 'f-req', name: 'पवार शेती', status: 'PendingApproval' }], onWithdrawRequest: vi.fn() });
        const waiting = screen.getByTestId('first-farm-waiting');
        expect(waiting).toHaveTextContent('विनंती पाठवली');
        expect(waiting).toHaveTextContent('मालक तुमची भूमिका ठरवतील आणि मंजूर करतील');
        expect(screen.getByTestId('pending-seat-f-req')).toHaveTextContent('पवार शेती');
        expect(screen.getByTestId('door-invited')).toBeInTheDocument();
    });

    it('in English (chosen on स्वागत) the doors screen is English throughout — the waiting card and the request list too', () => {
        cleanup();
        h.english = true;
        try {
            mount({ pendingSeats: [{ farmId: 'f-req', name: 'Pawar farm', status: 'PendingApproval' }], onWithdrawRequest: vi.fn() });
            const doors = screen.getByTestId('first-farm-doors');
            expect(screen.getByTestId('first-farm-waiting')).toHaveTextContent('Request sent');
            expect(screen.getByTestId('pending-seat-f-req')).toHaveTextContent('waiting for the owner');
            expect(screen.getByTestId('withdraw-request-f-req')).toHaveTextContent('Withdraw the request');
            expect(doors.textContent).not.toMatch(/[ऀ-ॿ]/);
        } finally {
            h.english = false;
        }
    });

    it('a paused seat is not called a waiting request', () => {
        mount({ pendingSeats: [{ farmId: 'f-p', name: 'जाधव मळा', status: 'Suspended' }] });
        expect(screen.queryByTestId('first-farm-waiting')).toBeNull();
        expect(screen.getByTestId('pending-seat-f-p')).toHaveTextContent('काम थांबवलं आहे');
    });

    it('opening again starts at the doors with an empty form', () => {
        const props = { onComplete: vi.fn(), onJoinViaQr: vi.fn() };
        const { rerender } = render(<MinimalOnboarding isOpen {...props} />);
        fireEvent.click(screen.getByTestId('door-own-farm'));
        fireEvent.change(screen.getByLabelText('शेताचे नाव'), { target: { value: 'x' } });
        rerender(<MinimalOnboarding isOpen={false} {...props} />);
        rerender(<MinimalOnboarding isOpen {...props} />);
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();
        // Without an onBack there is no back on the doors (no control that cannot act).
        expect(screen.queryByRole('button', { name: 'मागे' })).toBeNull();
    });
});
