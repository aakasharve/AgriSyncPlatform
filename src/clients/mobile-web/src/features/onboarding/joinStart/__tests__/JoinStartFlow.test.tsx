// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the first screens before sign-in.
//
// Pinned: the two groups and the two questions only pick the next screen (nothing is sent anywhere); the professional
// gets a plain "not built yet" and is asked nothing; "हो" opens the scanner BEFORE any number is asked; the typed code is
// driven with real typing (user-event) and the send stays grey until it is a whole farm code or invitation; one language.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.language, setLanguage: vi.fn(), t: (k: string) => k }),
    useLanguage: () => ({ language: h.language, setLanguage: vi.fn(), t: (k: string) => k }),
}));
vi.mock('../../../../pages/onboarding/DawnScene', () => ({ default: () => null }));

import JoinStartFlow from '../JoinStartFlow';
import { joinStartCopy } from '../joinStartCopy';

const fetchSpy = vi.fn();
beforeEach(() => {
    h.language = 'mr';
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const C = joinStartCopy('mr');

function renderFlow() {
    const onChoice = vi.fn();
    const onBack = vi.fn();
    render(<JoinStartFlow onBack={onBack} onChoice={onChoice} />);
    return { onChoice, onBack };
}

describe('"तुम्ही कोण?" — two groups, and the returning person\'s way in', () => {
    it('shows शेतकरी and संस्था / तज्ज्ञ, and "आधीच श्रमसफल वापरता? लॉगिन करा"', () => {
        renderFlow();
        expect(screen.getByTestId('join-start-who-title')).toHaveTextContent('तुम्ही कोण?');
        expect(screen.getByTestId('join-start-farmer')).toHaveTextContent('शेतकरी');
        expect(screen.getByTestId('join-start-org-door')).toHaveTextContent('संस्था / तज्ज्ञ');
        expect(screen.getByText(/आधीच श्रमसफल वापरता\?/)).toBeInTheDocument();
    });

    it('"लॉगिन करा" goes to the number with nothing chosen', async () => {
        const { onChoice } = renderFlow();
        await userEvent.click(screen.getByTestId('join-start-login'));
        expect(onChoice).toHaveBeenCalledWith({ kind: 'login' });
    });

    it('संस्था / तज्ज्ञ: "हा भाग अजून तयार होत आहे. लवकरच सुरू होईल." — nothing asked, nothing sent; back returns', async () => {
        const { onChoice } = renderFlow();
        await userEvent.click(screen.getByTestId('join-start-org-door'));
        expect(screen.getByTestId('join-start-soon')).toHaveTextContent(C.soon);
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(onChoice).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(screen.getByTestId('join-start-who-title')).toBeInTheDocument();
    });
});

describe('शेतकरी → "तुम्हाला कोणी श्रमसफलवर बोलावलं आहे का?"', () => {
    it('"नाही, मी स्वतः सुरू करतोय" goes to the number to make his own farm', async () => {
        const { onChoice } = renderFlow();
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        expect(screen.getByTestId('join-start-invited-title')).toHaveTextContent(C.invitedQuestion);
        await userEvent.click(screen.getByTestId('join-start-no'));
        expect(onChoice).toHaveBeenCalledWith({ kind: 'own' });
    });

    it('"हो" opens the scanner BEFORE any number: no phone field, the help line, and "कोड टाका"', async () => {
        renderFlow();
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        await userEvent.click(screen.getByTestId('join-start-yes'));
        expect(screen.getByTestId('join-start-scan')).toBeInTheDocument();
        expect(screen.getByTestId('join-start-scan-help')).toHaveTextContent('मालकाकडून कोड किंवा QR घ्या');
        expect(document.querySelector('input[type="tel"]')).toBeNull();
        // jsdom has no QR reader: the screen says so and points to the typed code.
        expect(screen.getByTestId('join-start-no-camera')).toHaveTextContent(C.noScanner);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('"कोड टाका" — real typing; grey until whole; nothing sent before sign-in', () => {
    async function openCode() {
        const flow = renderFlow();
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        await userEvent.click(screen.getByTestId('join-start-yes'));
        await userEvent.click(screen.getByTestId('join-start-type-code'));
        return flow;
    }

    it('a farm code typed letter by letter enables "पाठवा" only when whole; the role note is the owner\'s', async () => {
        const { onChoice } = await openCode();
        const input = screen.getByTestId('join-start-code-input');
        const send = screen.getByTestId('join-start-code-send');
        expect(screen.getByTestId('join-start-role-note')).toHaveTextContent('तुमची भूमिका मालक ठरवतील.');
        await userEvent.type(input, 'abc12');
        expect(input).toHaveValue('abc12');
        expect(send).toBeDisabled();
        await userEvent.type(input, '3');
        expect(send).toBeEnabled();
        await userEvent.click(send);
        expect(onChoice).toHaveBeenCalledWith({ kind: 'join', held: { kind: 'farmCode', code: 'ABC123' } });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the owner\'s 8-digit invitation is held as an invitation', async () => {
        const { onChoice } = await openCode();
        await userEvent.type(screen.getByTestId('join-start-code-input'), '4821 7730');
        await userEvent.click(screen.getByTestId('join-start-code-send'));
        expect(onChoice).toHaveBeenCalledWith({ kind: 'join', held: { kind: 'invitation', code: '48217730' } });
    });

    it('the typing stays in the box (focus is never taken away while he types)', async () => {
        await openCode();
        const input = screen.getByTestId('join-start-code-input');
        await userEvent.click(input);
        await userEvent.keyboard('K7M');
        expect(document.activeElement).toBe(input);
        await userEvent.keyboard('2QX');
        expect(document.activeElement).toBe(input);
        expect(input).toHaveValue('K7M2QX');
    });
});

describe('one language at a time', () => {
    it('English mode shows the English words only', async () => {
        h.language = 'en';
        renderFlow();
        expect(screen.getByTestId('join-start-who-title')).toHaveTextContent('Who are you?');
        expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/);
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        expect(screen.getByTestId('join-start-invited-title')).toHaveTextContent('Did someone invite you to ShramSafal?');
        expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
