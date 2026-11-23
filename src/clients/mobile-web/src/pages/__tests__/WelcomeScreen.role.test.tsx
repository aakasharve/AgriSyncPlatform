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
 *
 * The owner path is now the founder's welcome voice note, which starts by
 * itself after a short intro. It speaks to the owner, so a worker or mukadam
 * never gets it: they keep the light greeting and one continue button.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('../onboarding/DawnScene', () => ({ default: () => null }));

import WelcomeScreen from '../WelcomeScreen';

const OWNER_LINE = 'सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!';

beforeEach(() => {
    // jsdom has no media playback: give the audio element a quiet stand-in.
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

describe('WelcomeScreen - the owner greeting is for owners', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

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

describe('WelcomeScreen - the owner voice note', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

    it('a worker never gets the voice note; one button continues', () => {
        const onContinue = vi.fn();
        render(<WelcomeScreen onContinue={onContinue} farmRole="Worker" />);
        expect(screen.queryByTestId('welcome-story')).toBeNull();
        fireEvent.click(screen.getByTestId('welcome-continue'));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('an owner gets the intro, then the voice starts with no tap', () => {
        vi.useFakeTimers();
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="Owner" />);
        expect(screen.getByTestId('welcome-intro')).toBeInTheDocument();
        expect(play).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(9500); });
        expect(play).toHaveBeenCalled();
    });

    it('skipping asks once, honestly, then continues', () => {
        const onContinue = vi.fn();
        render(<WelcomeScreen onContinue={onContinue} farmRole="Owner" />);
        fireEvent.click(screen.getByTestId('welcome-story-skip'));
        expect(screen.getByText('एक छोटी विनंती')).toBeInTheDocument();
        expect(screen.getByText('फक्त 2 मिनिटं लागतील')).toBeInTheDocument();
        expect(screen.queryByText(/नंतर ऐक/)).toBeNull(); // no promise of a "listen later" place that does not exist
        fireEvent.click(screen.getByTestId('welcome-skip-confirm'));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('choosing to listen from the sheet starts the voice', () => {
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="Owner" />);
        fireEvent.click(screen.getByTestId('welcome-story-skip'));
        fireEvent.click(screen.getByTestId('welcome-skip-stay'));
        expect(play).toHaveBeenCalled();
    });
});
