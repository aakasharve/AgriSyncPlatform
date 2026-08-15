// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 4 — pins `CanonicalStrip`'s locked behaviours (design doc §2, task-4
 * brief). Presentational component: every test renders with plain props,
 * no providers, no Dexie.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import CanonicalStrip from '../CanonicalStrip';
import type { CanonicalStripProps } from '../CanonicalStrip';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

afterEach(() => {
    cleanup();
});

function baseProps(overrides: Partial<CanonicalStripProps> = {}): CanonicalStripProps {
    return {
        language: 'mr',
        farmName: 'Arve Farm',
        plotCount: 4,
        waitingCount: 0,
        onOpenFarmSwitcher: vi.fn(),
        onToggleWaiting: vi.fn(),
        ...overrides,
    };
}

describe('CanonicalStrip', () => {
    it('waiting_button_keeps_its_height_in_both_states', () => {
        // Spec §2.2: "Rest state keeps its exact place and size ... The
        // layout never reshuffles, so the strip is a fixed landmark." The
        // scenario this protects against is `waitingCount` changing on a
        // LIVE header instance (0 -> 6 as records arrive), not two
        // isolated mounts — so this uses `rerender()` on one instance, not
        // two separate `render()` calls.
        const { rerender } = render(<CanonicalStrip {...baseProps({ waitingCount: 0 })} />);
        const restButton = screen.getByTestId('canonical-strip-waiting-button');
        expect(restButton).toHaveStyle({ minHeight: '52px' });

        rerender(<CanonicalStrip {...baseProps({ waitingCount: 6 })} />);
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        // The identity assertion is the one that actually catches a
        // conditional unmount/remount across the branch — a node that
        // merely happens to carry the same height, but is a NEW node, would
        // still be a reflow a farmer can see.
        expect(waitingButton).toBe(restButton);
        expect(waitingButton).toHaveStyle({ minHeight: '52px' });
    });

    it('the_count_comes_from_props', () => {
        // A hardcoded literal in the component would pass a naive render
        // check; rendering an unusual, distinctive count and asserting it
        // appears verbatim proves the pill is reading `waitingCount`, not
        // echoing a number the component invented itself.
        render(<CanonicalStrip {...baseProps({ waitingCount: 37 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('37');

        cleanup();

        render(<CanonicalStrip {...baseProps({ waitingCount: 9 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('9');
        expect(screen.queryByText('37')).not.toBeInTheDocument();
    });

    it('rest_state_shows_the_rest_label_and_no_count', () => {
        render(<CanonicalStrip {...baseProps({ waitingCount: 0 })} />);

        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
    });

    it('tapping_the_farm_chip_calls_onOpenFarmSwitcher', () => {
        const onOpenFarmSwitcher = vi.fn();
        const onToggleWaiting = vi.fn();
        render(<CanonicalStrip {...baseProps({ onOpenFarmSwitcher, onToggleWaiting })} />);

        fireEvent.click(screen.getByTestId('canonical-strip-farm-chip'));

        expect(onOpenFarmSwitcher).toHaveBeenCalledTimes(1);
        expect(onToggleWaiting).not.toHaveBeenCalled();
    });

    it('tapping_the_waiting_button_calls_onToggleWaiting', () => {
        const onOpenFarmSwitcher = vi.fn();
        const onToggleWaiting = vi.fn();
        render(<CanonicalStrip {...baseProps({ onOpenFarmSwitcher, onToggleWaiting, waitingCount: 3 })} />);

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        expect(onToggleWaiting).toHaveBeenCalledTimes(1);
        expect(onOpenFarmSwitcher).not.toHaveBeenCalled();
    });

    it('waiting_state_never_uses_the_approve_colour_emerald', () => {
        // Spec §P-G: "The Seen control is never emerald ... Amber = what
        // needs you." `bg-emerald-600` already means Approve elsewhere in
        // this app (ReviewInbox.tsx:97, AttentionCard.tsx:121) — the
        // waiting/attention state must never borrow that colour.
        render(<CanonicalStrip {...baseProps({ waitingCount: 6 })} />);
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        expect(waitingButton.className).not.toContain('emerald');
        expect(waitingButton.className).toMatch(/amber/);
    });

    it('rest_state_tick_is_allowed_to_be_emerald_per_spec', () => {
        // Spec §2.2/§P-G explicitly allow emerald on the rest-state tick
        // (identity/"nothing outstanding"), unlike the waiting state above.
        render(<CanonicalStrip {...baseProps({ waitingCount: 0 })} />);
        const tick = screen.getByTestId('canonical-strip-waiting-rest-tick');

        expect(tick.className).toMatch(/emerald/);
    });

    it('farm_chip_renders_the_farm_name_and_plot_count_from_props', () => {
        render(<CanonicalStrip {...baseProps({ farmName: 'Bhosale Vasti', plotCount: 7 })} />);

        expect(screen.getByText('Bhosale Vasti')).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('7');
    });

    it('english_language_renders_the_english_strings_not_the_marathi_placeholders', () => {
        render(<CanonicalStrip {...baseProps({ language: 'en', waitingCount: 2 })} />);

        expect(screen.getByText(oversightTranslations.en.waitingLabel)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.waitingLabel)).not.toBeInTheDocument();
    });

    it('marathi_mode_shows_an_english_caption_that_derives_from_the_same_placeholder_key', () => {
        // Spec §6.2: unapproved placeholder copy "ship[s] ... with the
        // English fallback visible." Proves the caption is literally
        // `oversightTranslations.en[<same key as the primary Marathi
        // line>]` (uppercased) — not a second, independently-invented
        // literal — for both the waiting and the rest label.
        const { rerender } = render(<CanonicalStrip {...baseProps({ language: 'mr', waitingCount: 6 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-caption')).toHaveTextContent(
            oversightTranslations.en.waitingLabel.toUpperCase(),
        );

        rerender(<CanonicalStrip {...baseProps({ language: 'mr', waitingCount: 0 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-caption')).toHaveTextContent(
            oversightTranslations.en.restState.toUpperCase(),
        );
    });

    it('english_mode_does_not_double_up_the_caption', () => {
        // In English mode the primary label already IS
        // `oversightTranslations.en.waitingLabel` — a second, uppercase copy
        // directly beneath it would be a literal duplicate, so no caption
        // node should render at all.
        render(<CanonicalStrip {...baseProps({ language: 'en', waitingCount: 6 })} />);

        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
        expect(screen.getAllByText(oversightTranslations.en.waitingLabel)).toHaveLength(1);
    });
});
