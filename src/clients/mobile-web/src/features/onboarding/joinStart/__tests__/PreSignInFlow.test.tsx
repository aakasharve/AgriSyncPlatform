// @vitest-environment jsdom
// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the hand-over from the first questions
// to the number: the choice is held on the phone for after sign-in, the number screen shows what he gave, and back
// returns to the step he left from with nothing carried over.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
}));
vi.mock('../../../../pages/onboarding/DawnScene', () => ({ default: () => null }));
vi.mock('../../../../pages/LoginPage', () => ({
    default: ({ onBack, heldJoin }: { onBack?: () => void; heldJoin?: unknown }) => (
        <div data-testid="login-page" data-held={heldJoin ? JSON.stringify(heldJoin) : ''}>
            <button type="button" onClick={onBack}>login-back</button>
        </div>
    ),
}));

import PreSignInFlow from '../PreSignInFlow';
import { peekHeldJoin, takeOwnFarmStart } from '../heldJoin';

afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
});

describe('PreSignInFlow', () => {
    it('"आधीच वापरता? लॉगिन करा" → the number screen with nothing held; back returns to "तुम्ही कोण?"', async () => {
        render(<PreSignInFlow onBack={vi.fn()} />);
        await userEvent.click(screen.getByTestId('join-start-login'));
        expect(screen.getByTestId('login-page')).toHaveAttribute('data-held', '');
        expect(peekHeldJoin()).toBeNull();
        expect(takeOwnFarmStart()).toBe(false);
        await userEvent.click(screen.getByText('login-back'));
        expect(screen.getByTestId('join-start-who-title')).toBeInTheDocument();
    });

    it('a typed farm code → held for after sign-in and shown on the number screen; back returns to the code and drops it', async () => {
        render(<PreSignInFlow onBack={vi.fn()} />);
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        await userEvent.click(screen.getByTestId('join-start-yes'));
        await userEvent.click(screen.getByTestId('join-start-type-code'));
        await userEvent.type(screen.getByTestId('join-start-code-input'), 'K7M2QX');
        await userEvent.click(screen.getByTestId('join-start-code-send'));

        expect(peekHeldJoin()).toEqual({ kind: 'farmCode', code: 'K7M2QX' });
        expect(JSON.parse(screen.getByTestId('login-page').getAttribute('data-held') ?? '{}')).toEqual({ kind: 'farmCode', code: 'K7M2QX' });

        await userEvent.click(screen.getByText('login-back'));
        expect(screen.getByTestId('join-start-code')).toBeInTheDocument();
        expect(peekHeldJoin()).toBeNull();
    });

    it('"नाही, मी स्वतः सुरू करतोय" → the number screen, and after sign-in his own farm comes first', async () => {
        render(<PreSignInFlow onBack={vi.fn()} />);
        await userEvent.click(screen.getByTestId('join-start-farmer'));
        await userEvent.click(screen.getByTestId('join-start-no'));
        expect(screen.getByTestId('login-page')).toHaveAttribute('data-held', '');
        expect(takeOwnFarmStart()).toBe(true);
    });

    it('back from "तुम्ही कोण?" goes to स्वागत', async () => {
        const onBack = vi.fn();
        render(<PreSignInFlow onBack={onBack} />);
        await userEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
