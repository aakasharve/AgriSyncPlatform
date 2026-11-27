// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R3 lane S2, the founder's pick V6a-B (27 Nov; R1 plan §05-§06).
 * "माझं शेत सुरू करायचं" opens ONE card on the first-run dawn look that changes in place:
 *   - card 1: "तुमच्या शेताचं नाव काय आहे?", one field, one button "शेत तयार करा" (the same server call as before);
 *   - card 2, ONLY after the server answered "created": the gold "अभिनंदन!", the farm's new nameboard with the name the
 *     SERVER sent back, "तुमचं ‹नाव› श्रमसफलमध्ये तयार आहे. चला, सुरुवात करूया." and "सुरू करूया";
 *   - never "मालक" on either card; a failed save keeps card 1 with the honest reason and no congratulations;
 *   - a farm the server says it had made BEFORE (`wasAlreadyBootstrapped`) is not congratulated as new: straight on.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
    calls: [] as unknown[][],
    impl: (..._a: unknown[]): Promise<unknown> => Promise.resolve({}),
    english: false,
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.english ? { language: 'en', setLanguage: () => undefined, t: (k: string) => k } : undefined),
}));
vi.mock('../../qr/inviteApi', () => ({
    bootstrapFirstFarm: (...a: unknown[]) => { h.calls.push(a); return h.impl(...a); },
    isInviteApiError: (v: unknown) => typeof v === 'object' && v !== null && 'error' in v && 'status' in v,
}));
vi.mock('../../../../pages/onboarding/DawnScene', () => ({ default: () => null }));

import MinimalOnboarding from '../MinimalOnboarding';

const CREATED = { farmId: 'f-new', farmName: 'आर्वे शेती', farmCode: 'ABC123', ownerAccountId: 'o', subscription: null, wasAlreadyBootstrapped: false };

beforeEach(() => {
    h.calls = [];
    h.impl = () => Promise.resolve(CREATED);
    h.english = false;
});
afterEach(cleanup);

function openCard(extra: Partial<React.ComponentProps<typeof MinimalOnboarding>> = {}) {
    const props = { isOpen: true, onComplete: vi.fn(), onJoinViaQr: vi.fn(), onBack: vi.fn(), ...extra };
    render(<MinimalOnboarding {...props} />);
    fireEvent.click(screen.getByTestId('door-own-farm'));
    return props;
}
const nameField = () => screen.getByRole('textbox');
const latinWords = (el: HTMLElement) => (el.textContent ?? '').match(/[A-Za-z]{3,}/g);

describe('V6a-B card 1: the farm name', () => {
    it('asks ONE question with ONE field and ONE button, and claims nothing about owning', () => {
        openCard();
        const card = screen.getByTestId('first-farm-create');
        expect(screen.getByTestId('farm-name-question')).toHaveTextContent('तुमच्या शेताचं नाव काय आहे?');
        expect(screen.getAllByRole('textbox')).toHaveLength(1);
        expect(nameField()).toHaveAttribute('placeholder', 'उदा. रामू पाटील शेत');
        expect(nameField()).toHaveAttribute('maxLength', '120');
        // The field is named by the question (a screen reader hears what to type).
        expect(screen.getByRole('textbox', { name: 'तुमच्या शेताचं नाव काय आहे?' })).toBeInTheDocument();
        expect(screen.queryByLabelText('तुमचे नाव')).toBeNull();
        expect(card.textContent).not.toMatch(/मालक/);
        expect(latinWords(card)).toBeNull();
        const submit = screen.getByTestId('first-farm-create-submit');
        expect(submit).toHaveTextContent('शेत तयार करा');
        expect(submit).toBeDisabled();
        fireEvent.change(nameField(), { target: { value: '   ' } });
        expect(submit).toBeDisabled();
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती' } });
        expect(submit).toBeEnabled();
    });

    it('saves through the same server call, with the farm name only', async () => {
        openCard();
        fireEvent.change(nameField(), { target: { value: '  आर्वे शेती ' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        await screen.findByTestId('farm-ready');
        expect(h.calls).toEqual([['आर्वे शेती']]);
    });

    it('while the server has not answered: "सुरू होत आहे…", no second tap, and NO congratulations yet', async () => {
        let answer: (v: unknown) => void = () => undefined;
        h.impl = () => new Promise(resolve => { answer = resolve; });
        const p = openCard();
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        const submit = screen.getByTestId('first-farm-create-submit');
        expect(submit).toHaveTextContent('सुरू होत आहे…');
        expect(submit).toBeDisabled();
        fireEvent.click(submit);
        expect(h.calls).toHaveLength(1);
        expect(screen.queryByTestId('farm-ready')).toBeNull();
        expect(screen.queryByText('अभिनंदन!')).toBeNull();
        await act(async () => { answer(CREATED); });
        expect(screen.getByTestId('farm-ready')).toBeInTheDocument();
        expect(p.onComplete).not.toHaveBeenCalled();
    });
});

describe('V6a-B card 2: the congratulations, only after the server said "created"', () => {
    it('the same card changes in place: gold "अभिनंदन!", the nameboard and the line with the SERVER\'s name, "सुरू करूया"', async () => {
        h.impl = () => Promise.resolve({ ...CREATED, farmName: 'आर्वे शेती (सर्व्हर)' });
        const p = openCard();
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        const ready = await screen.findByTestId('farm-ready');
        expect(screen.getByTestId('farm-ready-heading')).toHaveTextContent('अभिनंदन!');
        expect(screen.getByTestId('farm-nameboard-name')).toHaveTextContent('आर्वे शेती (सर्व्हर)');
        // Not a control, and no English subtitle on the board.
        expect(screen.getByTestId('farm-nameboard')).toHaveAttribute('data-can-switch', 'false');
        expect(screen.queryByTestId('farm-nameboard-subtitle')).toBeNull();
        expect(screen.getByTestId('farm-ready-line')).toHaveTextContent('तुमचं आर्वे शेती (सर्व्हर) श्रमसफलमध्ये तयार आहे. चला, सुरुवात करूया.');
        expect(screen.getByTestId('farm-ready-name')).toHaveTextContent('आर्वे शेती (सर्व्हर)');
        expect(ready.textContent).not.toMatch(/मालक/);
        expect(latinWords(ready)).toBeNull();
        // Card 1 is gone; there is no way back to it (the farm is made on the server).
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('button', { name: 'मागे' })).toBeNull();
        expect(p.onComplete).not.toHaveBeenCalled();

        const go = screen.getByTestId('farm-ready-start');
        expect(go).toHaveTextContent('सुरू करूया');
        fireEvent.click(go);
        expect(p.onComplete).toHaveBeenCalledTimes(1);
        expect(p.onComplete).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'f-new', farmName: 'आर्वे शेती (सर्व्हर)' }));
    });

    it('a failed save: card 1 stays with the honest reason and what he typed — no congratulations', async () => {
        h.impl = () => Promise.reject(new TypeError('Failed to fetch'));
        const p = openCard();
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('शेत तयार करता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.');
        expect(screen.queryByTestId('farm-ready')).toBeNull();
        expect(screen.queryByText('अभिनंदन!')).toBeNull();
        expect(nameField()).toHaveValue('आर्वे शेती');
        expect(screen.getByTestId('first-farm-create-submit')).toHaveTextContent('शेत तयार करा');
        expect(p.onComplete).not.toHaveBeenCalled();
        // Typing again clears the reason.
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती २' } });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a farm the server had ALREADY made is not congratulated as new: the first run goes straight on', async () => {
        h.impl = () => Promise.resolve({ ...CREATED, wasAlreadyBootstrapped: true });
        const p = openCard();
        fireEvent.change(nameField(), { target: { value: 'आर्वे शेती' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        await waitFor(() => expect(p.onComplete).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('farm-ready')).toBeNull();
        expect(screen.queryByText('अभिनंदन!')).toBeNull();
    });

    it('card 1\'s "मागे" goes back to the two doors', () => {
        openCard();
        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();
    });

    it('in English (chosen on स्वागत) both cards are English only', async () => {
        h.english = true;
        h.impl = () => Promise.resolve({ ...CREATED, farmName: 'Arve farm' });
        const p = openCard();
        expect(screen.getByTestId('farm-name-question')).toHaveTextContent("What is your farm's name?");
        expect(screen.getByTestId('first-farm-create-submit')).toHaveTextContent('Create the farm');
        expect(screen.getByTestId('first-farm-create').textContent).not.toMatch(/[ऀ-ॿ]/);
        fireEvent.change(nameField(), { target: { value: 'Arve farm' } });
        fireEvent.click(screen.getByTestId('first-farm-create-submit'));
        const ready = await screen.findByTestId('farm-ready');
        expect(screen.getByTestId('farm-ready-heading')).toHaveTextContent('Congratulations!');
        expect(screen.getByTestId('farm-ready-line')).toHaveTextContent("Your Arve farm is ready in Shram Safal. Let's begin.");
        expect(screen.getByTestId('farm-ready-start')).toHaveTextContent("Let's start");
        expect(ready.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(ready.textContent).not.toMatch(/owner/i);
        fireEvent.click(screen.getByTestId('farm-ready-start'));
        expect(p.onComplete).toHaveBeenCalledTimes(1);
    });
});
