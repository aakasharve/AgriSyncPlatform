// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12-V1-M1, LP-03) — the review of a parsed entry
 * is no longer a dead end: a big labelled "मागे", and Android hardware Back takes the same one step.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReviewBackBar } from '../ReviewBackBar';
import { dismissTopOverlay, __resetBackStackForTests } from '../../../../../core/navigation/backStack';

afterEach(() => { cleanup(); __resetBackStackForTests(); });

describe('ReviewBackBar', () => {
    it('is a big labelled "मागे" (no bare arrow) that takes the step back', () => {
        const onBack = vi.fn();
        render(<ReviewBackBar onBack={onBack} />);
        const back = screen.getByTestId('review-back');
        expect(back).toHaveTextContent('मागे');
        expect(back).toHaveAccessibleName('मागे');
        fireEvent.click(back);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('Android hardware Back on the review takes the same step instead of leaving the app', () => {
        const onBack = vi.fn();
        render(<ReviewBackBar onBack={onBack} />);
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('once the review is gone, hardware Back is no longer held by it', () => {
        const onBack = vi.fn();
        const { unmount } = render(<ReviewBackBar onBack={onBack} />);
        unmount();
        expect(dismissTopOverlay()).toBe(false);
        expect(onBack).not.toHaveBeenCalled();
    });
});
