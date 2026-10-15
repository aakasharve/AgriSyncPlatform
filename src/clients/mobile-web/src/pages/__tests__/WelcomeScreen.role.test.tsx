// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JOURNEY FIX D10 (spec 2026-08-25-prod-cutover-waves) - a worker who joined
 * by QR was greeted with "सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!" ("on the
 * way to becoming the owner of a well-organised farm"). That line is for an
 * owner. It is shown unless the farm role says this person is NOT the owner:
 * a Worker or Mukadam. No role known yet (a brand-new account about to make
 * their first farm) keeps the greeting.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../onboarding/DawnScene', () => ({ default: () => null }));

import WelcomeScreen from '../WelcomeScreen';

const OWNER_LINE = 'सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!';

describe('WelcomeScreen - the owner greeting is for owners', () => {
    afterEach(() => cleanup());

    it.each(['Worker', 'Mukadam', 'worker'])('hidden for a %s; the rest of the welcome stays', (role) => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole={role} />);
        expect(screen.queryByText(OWNER_LINE)).toBeNull();
        expect(screen.getByText('अभिनंदन!')).toBeInTheDocument();
        expect(screen.getByText('आज काय केलं')).toBeInTheDocument();
    });

    it.each([undefined, 'Owner', 'PrimaryOwner', 'SecondaryOwner'])('kept for %s', (role) => {
        render(<WelcomeScreen onContinue={vi.fn()} farmRole={role} />);
        expect(screen.getByText(OWNER_LINE)).toBeInTheDocument();
    });
});
