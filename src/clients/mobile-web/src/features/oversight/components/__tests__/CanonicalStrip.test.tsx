// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 4 pinned the ORIGINAL two-button strip's locked behaviours (design
 * doc §2). Task 11 restructures the strip under a DIRECT FOUNDER
 * INSTRUCTION that supersedes that mock's layout — the farm chip moves to
 * row 1 (`CompactFarmChip`), and `CanonicalStrip` becomes row 2's waiting
 * button ALONE, full width. This file is rewritten to match: every Task-4
 * invariant that still applies (rest-state place/size, `waitingCount` from
 * props only, §P-G colour rule, translations-only copy) is re-proven below
 * against the NEW shapes, not silently dropped.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import CanonicalStrip, { CompactFarmChip } from '../CanonicalStrip';
import type { CanonicalStripProps, CompactFarmChipProps } from '../CanonicalStrip';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

afterEach(() => {
    cleanup();
});

function baseStripProps(overrides: Partial<CanonicalStripProps> = {}): CanonicalStripProps {
    return {
        language: 'mr',
        waitingCount: 0,
        onToggleWaiting: vi.fn(),
        ...overrides,
    };
}

function baseFarmChipProps(overrides: Partial<CompactFarmChipProps> = {}): CompactFarmChipProps {
    return {
        language: 'mr',
        farmName: 'Arve Farm',
        plotCount: 4,
        onOpenFarmSwitcher: vi.fn(),
        ...overrides,
    };
}

describe('CanonicalStrip — row 2, the waiting button alone, full width', () => {
    it('waiting_button_keeps_its_height_in_both_states', () => {
        // Spec §2.2: "Rest state keeps its exact place and size ... The
        // layout never reshuffles, so the strip is a fixed landmark." The
        // scenario this protects against is `waitingCount` changing on a
        // LIVE header instance (0 -> 6 as records arrive), not two
        // isolated mounts — so this uses `rerender()` on one instance, not
        // two separate `render()` calls.
        const { rerender } = render(<CanonicalStrip {...baseStripProps({ waitingCount: 0 })} />);
        const restButton = screen.getByTestId('canonical-strip-waiting-button');
        expect(restButton).toHaveStyle({ minHeight: '52px' });

        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 6 })} />);
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
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 37 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('37');

        cleanup();

        render(<CanonicalStrip {...baseStripProps({ waitingCount: 9 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('9');
        expect(screen.queryByText('37')).not.toBeInTheDocument();
    });

    it('rest_state_shows_the_rest_label_and_no_count', () => {
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0 })} />);

        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
    });

    it('tapping_the_waiting_button_calls_onToggleWaiting', () => {
        const onToggleWaiting = vi.fn();
        render(<CanonicalStrip {...baseStripProps({ onToggleWaiting, waitingCount: 3 })} />);

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        expect(onToggleWaiting).toHaveBeenCalledTimes(1);
    });

    it('waiting_state_never_uses_the_approve_colour_emerald', () => {
        // Spec §P-G: "The Seen control is never emerald ... Amber = what
        // needs you." `bg-emerald-600` already means Approve elsewhere in
        // this app (ReviewInbox.tsx:97, AttentionCard.tsx:121) — the
        // waiting/attention state must never borrow that colour.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 6 })} />);
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        expect(waitingButton.className).not.toContain('emerald');
        expect(waitingButton.className).toMatch(/amber/);
    });

    it('rest_state_tick_is_allowed_to_be_emerald_per_spec', () => {
        // Spec §2.2/§P-G explicitly allow emerald on the rest-state tick
        // (identity/"nothing outstanding"), unlike the waiting state above.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0 })} />);
        const tick = screen.getByTestId('canonical-strip-waiting-rest-tick');

        expect(tick.className).toMatch(/emerald/);
    });

    it('english_language_renders_the_english_strings_not_the_marathi_placeholders', () => {
        render(<CanonicalStrip {...baseStripProps({ language: 'en', waitingCount: 2 })} />);

        expect(screen.getByText(oversightTranslations.en.waitingLabel)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.waitingLabel)).not.toBeInTheDocument();
    });

    it('marathi_mode_shows_an_english_caption_that_derives_from_the_same_placeholder_key', () => {
        // Spec §6.2: unapproved placeholder copy "ship[s] ... with the
        // English fallback visible." Proves the caption is literally
        // `oversightTranslations.en[<same key as the primary Marathi
        // line>]` (uppercased) — not a second, independently-invented
        // literal — for both the waiting and the rest label.
        const { rerender } = render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 6 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-caption')).toHaveTextContent(
            oversightTranslations.en.waitingLabel.toUpperCase(),
        );

        rerender(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 0 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-caption')).toHaveTextContent(
            oversightTranslations.en.restState.toUpperCase(),
        );
    });

    it('english_mode_does_not_double_up_the_caption', () => {
        // In English mode the primary label already IS
        // `oversightTranslations.en.waitingLabel` — a second, uppercase copy
        // directly beneath it would be a literal duplicate, so no caption
        // node should render at all.
        render(<CanonicalStrip {...baseStripProps({ language: 'en', waitingCount: 6 })} />);

        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
        expect(screen.getAllByText(oversightTranslations.en.waitingLabel)).toHaveLength(1);
    });

    it('renders full width — the farm chip is no longer a sibling inside this component (Task 11)', () => {
        render(<CanonicalStrip {...baseStripProps()} />);

        expect(screen.queryByTestId('canonical-strip-farm-chip')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-button').className).toContain('w-full');
    });
});

describe('CompactFarmChip — row 1 farm-identity trigger (Task 11)', () => {
    it('tapping_the_farm_chip_calls_onOpenFarmSwitcher', () => {
        const onOpenFarmSwitcher = vi.fn();
        render(<CompactFarmChip {...baseFarmChipProps({ onOpenFarmSwitcher })} />);

        fireEvent.click(screen.getByTestId('canonical-strip-farm-chip'));

        expect(onOpenFarmSwitcher).toHaveBeenCalledTimes(1);
    });

    it('carries the real farm name in its accessible label and title — MEASURED: visible text collided with the toggle at 390px, so the name is not rendered as text (see the component\'s own header comment)', () => {
        render(<CompactFarmChip {...baseFarmChipProps({ farmName: 'Bhosale Vasti' })} />);

        const chip = screen.getByTestId('canonical-strip-farm-chip');
        expect(chip.getAttribute('aria-label')).toContain('Bhosale Vasti');
        expect(chip.getAttribute('title')).toBe('Bhosale Vasti');
        // Not lost, just not VISIBLE text — the full name still shows inside
        // the `FarmSwitcherSheet` this chip opens (spec §2.1).
        expect(chip).not.toHaveTextContent('Bhosale Vasti');
    });

    it('carries the real plot count in its accessible label — never a literal, never silently dropped', () => {
        render(<CompactFarmChip {...baseFarmChipProps({ plotCount: 7 })} />);

        const chip = screen.getByTestId('canonical-strip-farm-chip');
        expect(chip.getAttribute('aria-label')).toContain('7');

        cleanup();

        render(<CompactFarmChip {...baseFarmChipProps({ plotCount: 12 })} />);
        expect(screen.getByTestId('canonical-strip-farm-chip').getAttribute('aria-label')).toContain('12');
    });

    it('meets the 44px minimum tap target even though it is visually small', () => {
        render(<CompactFarmChip {...baseFarmChipProps()} />);

        // `h-11 w-11` is Tailwind's 44px utility on both axes — the exact
        // minimum this task's brief requires ("do NOT reduce any tap
        // target below 44px").
        const chip = screen.getByTestId('canonical-strip-farm-chip');
        expect(chip).toHaveClass('h-11');
        expect(chip).toHaveClass('w-11');
    });

    it('renders no plot-count text — the design doc\'s second line does not fit a 44px-tall row-1 chip', () => {
        render(<CompactFarmChip {...baseFarmChipProps({ plotCount: 4 })} />);

        // The digit must not appear as VISIBLE text content (only in the
        // accessible label, asserted above) — proves the chip really did
        // drop the second line rather than just shrinking its font.
        expect(screen.getByTestId('canonical-strip-farm-chip')).not.toHaveTextContent('4');
    });

    it('english_language_resolves_yourFarms_from_translations_not_a_literal', () => {
        render(<CompactFarmChip {...baseFarmChipProps({ language: 'en' })} />);
        const chip = screen.getByTestId('canonical-strip-farm-chip');
        expect(chip.getAttribute('aria-label')).toContain(oversightTranslations.en.yourFarms);
    });
});
