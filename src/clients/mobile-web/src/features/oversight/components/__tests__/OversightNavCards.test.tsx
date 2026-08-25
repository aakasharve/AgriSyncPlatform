// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13)
 *
 * Pins `OversightNavCards`'s replacement of `PageToggle` inside `AppHeader`:
 * three cards, founder-approved Marathi labels, one active tint + underline
 * at a time, `onChange` fired with the tapped card's real `PageView` — never
 * a hardcoded literal.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import OversightNavCards from '../OversightNavCards';
import type { OversightNavCardsProps } from '../OversightNavCards';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

afterEach(() => {
    cleanup();
});

function baseProps(overrides: Partial<OversightNavCardsProps> = {}): OversightNavCardsProps {
    return {
        language: 'mr',
        view: 'log',
        onChange: vi.fn(),
        ...overrides,
    };
}

describe('OversightNavCards — three cards replacing the segmented toggle (Task 13)', () => {
    it('renders the founder-approved Marathi label on all three cards', () => {
        render(<OversightNavCards {...baseProps()} />);

        expect(screen.getByText(oversightTranslations.mr.navToday)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.navMyFarm)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.navCompare)).toBeInTheDocument();
    });

    it('english_language_resolves_the_english_labels_not_the_marathi', () => {
        render(<OversightNavCards {...baseProps({ language: 'en' })} />);

        expect(screen.getByText(oversightTranslations.en.navToday)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.navToday)).not.toBeInTheDocument();
    });

    it('only_the_active_view_card_carries_the_emerald_underline', () => {
        render(<OversightNavCards {...baseProps({ view: 'reflect' })} />);

        expect(screen.getByTestId('oversight-nav-card-reflect-underline')).toBeInTheDocument();
        expect(screen.queryByTestId('oversight-nav-card-log-underline')).not.toBeInTheDocument();
        expect(screen.queryByTestId('oversight-nav-card-compare-underline')).not.toBeInTheDocument();

        expect(screen.getByTestId('oversight-nav-card-reflect').className).toContain('emerald');
        expect(screen.getByTestId('oversight-nav-card-log').className).not.toContain('emerald');
    });

    it('tapping_a_card_calls_onChange_with_its_real_PageView_never_a_literal', () => {
        const onChange = vi.fn();
        render(<OversightNavCards {...baseProps({ view: 'log', onChange })} />);

        fireEvent.click(screen.getByTestId('oversight-nav-card-compare'));
        expect(onChange).toHaveBeenCalledExactlyOnceWith('compare');

        fireEvent.click(screen.getByTestId('oversight-nav-card-reflect'));
        expect(onChange).toHaveBeenCalledWith('reflect');
    });

    it('disabled_prop_disables_every_card', () => {
        render(<OversightNavCards {...baseProps({ disabled: true })} />);

        expect(screen.getByTestId('oversight-nav-card-log')).toBeDisabled();
        expect(screen.getByTestId('oversight-nav-card-reflect')).toBeDisabled();
        expect(screen.getByTestId('oversight-nav-card-compare')).toBeDisabled();
    });
});
