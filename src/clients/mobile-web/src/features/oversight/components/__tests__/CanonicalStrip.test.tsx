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

import CanonicalStrip, { FarmIdentityElement } from '../CanonicalStrip';
import type { CanonicalStripProps, FarmIdentityElementProps } from '../CanonicalStrip';
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

function baseFarmChipProps(overrides: Partial<FarmIdentityElementProps> = {}): FarmIdentityElementProps {
    return {
        language: 'mr',
        farmName: 'Arve Farm',
        plotCount: 4,
        farmCount: 1,
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

    it('matches the nav cards\' flat visual language — no gradient, no bespoke shadow (Task 14, change 8)', () => {
        // Founder: "that section still feels like overridden or not a part
        // of the application." The gradient background and the one-off
        // amber drop shadow were the cause — `OversightNavCards.tsx` (the
        // row directly above) is flat: `rounded-2xl`, one `border`, a
        // solid tint, no shadow at all. This proves the waiting state now
        // matches that, not Task 12's tray.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 4 })} />);
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        expect(waitingButton.className).toContain('rounded-2xl');
        expect(waitingButton.className).not.toContain('gradient');
        expect(waitingButton.className).not.toContain('shadow');
        expect(waitingButton.className).toContain('bg-amber-50');
    });

    it('english_language_renders_the_english_strings_not_the_marathi_placeholders', () => {
        render(<CanonicalStrip {...baseStripProps({ language: 'en', waitingCount: 2 })} />);

        expect(screen.getByText(oversightTranslations.en.waitingLabel)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.waitingLabel)).not.toBeInTheDocument();
    });

    it('marathi_mode_still_shows_the_placeholder_english_caption_for_the_still_pending_rest_state', () => {
        // Spec §6.2: unapproved placeholder copy "ship[s] ... with the
        // English fallback visible." `restState` is still pending (Task 13's
        // founder table covers the waiting state only), so this Task-4
        // behaviour is unchanged for it.
        render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 0 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-caption')).toHaveTextContent(
            oversightTranslations.en.restState.toUpperCase(),
        );
    });

    it('waiting_state_renders_the_founder_approved_subtitle_and_no_english_caption', () => {
        // Task 13 — `waitingLabel` graduated to founder-approved copy (his
        // own reference-image table), so the placeholder-caption pattern
        // must NOT render for it any more; the new subtitle line replaces
        // it. Both assertions matter: the subtitle actually being the real
        // approved string, and the caption actually being gone (not merely
        // additive) — proves `PENDING_FOUNDER_STRINGS.includes(primaryKey)`
        // is driving the caption, not a hardcoded language check.
        render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 6 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-subtitle')).toHaveTextContent(
            oversightTranslations.mr.waitingSubtitle,
        );
        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
    });

    it('rest_state_never_renders_the_waiting_subtitle', () => {
        // The founder's table has no subtitle for the rest state — proves
        // `subtitleText` is gated on `isWaiting`, not rendered unconditionally.
        render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 0 })} />);
        expect(screen.queryByTestId('canonical-strip-waiting-subtitle')).not.toBeInTheDocument();
    });

    it('english_mode_waiting_state_also_shows_the_real_subtitle_translation', () => {
        // `waitingSubtitle` is a fully-approved key with a real `en` value
        // (not a placeholder) — it should render in English mode too, same
        // as `waitingLabel` itself.
        render(<CanonicalStrip {...baseStripProps({ language: 'en', waitingCount: 6 })} />);
        expect(screen.getByTestId('canonical-strip-waiting-subtitle')).toHaveTextContent(
            oversightTranslations.en.waitingSubtitle,
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

describe('FarmIdentityElement — row 1 farm-identity element (Task 12)', () => {
    describe('farmCount === 1 — a label, never a control', () => {
        it('a_single_farm_account_renders_no_farm_switcher_control', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 1 })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            // Not a button at all — the element itself must be a <span>,
            // not merely styled to look like one.
            expect(el.tagName).not.toBe('BUTTON');
            expect(screen.queryByRole('button', { name: /./ })).not.toBeInTheDocument();
            expect(screen.queryByTestId('canonical-strip-farm-count-badge')).not.toBeInTheDocument();
            // No click handler, not focusable.
            expect(el).not.toHaveAttribute('tabindex');
            expect(el.onclick).toBeNull();
        });

        it('shows the farm name and plot count as real visible text', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 1, farmName: 'Bhosale Vasti', plotCount: 7 })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el).toHaveTextContent('Bhosale Vasti');
            expect(el).toHaveTextContent('7');
            expect(el.getAttribute('title')).toBe('Bhosale Vasti');
        });

        it('clicking the label does nothing — onOpenFarmSwitcher is never called', () => {
            const onOpenFarmSwitcher = vi.fn();
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 1, onOpenFarmSwitcher })} />);

            fireEvent.click(screen.getByTestId('canonical-strip-farm-chip'));

            expect(onOpenFarmSwitcher).not.toHaveBeenCalled();
        });

        // spec: farmCount === 0 (an honest empty account, not yet a real
        // farm) must NOT be treated as "multi" — same label presentation.
        it('farmCount 0 also renders the label, not the switcher button', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 0 })} />);

            expect(screen.getByTestId('canonical-strip-farm-chip').tagName).not.toBe('BUTTON');
        });
    });

    describe('farmCount >= 2 — a button, with a count badge', () => {
        it('a_multi_farm_account_renders_the_switcher_with_a_count', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 3 })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el.tagName).toBe('BUTTON');
            expect(el).toHaveClass('rounded-full');
            expect(el.className).toContain('emerald');

            const badge = screen.getByTestId('canonical-strip-farm-count-badge');
            expect(badge).toHaveTextContent('3');
        });

        it('tapping_the_farm_button_calls_onOpenFarmSwitcher', () => {
            const onOpenFarmSwitcher = vi.fn();
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2, onOpenFarmSwitcher })} />);

            fireEvent.click(screen.getByTestId('canonical-strip-farm-chip'));

            expect(onOpenFarmSwitcher).toHaveBeenCalledTimes(1);
        });

        it('the count badge reflects the real farmCount — never a literal', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 5 })} />);
            expect(screen.getByTestId('canonical-strip-farm-count-badge')).toHaveTextContent('5');

            cleanup();

            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2 })} />);
            expect(screen.getByTestId('canonical-strip-farm-count-badge')).toHaveTextContent('2');
            expect(screen.queryByText('5')).not.toBeInTheDocument();
        });

        it('carries the real farm name and plot count as visible text too', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2, farmName: 'Bhosale Vasti', plotCount: 7 })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el).toHaveTextContent('Bhosale Vasti');
            expect(el).toHaveTextContent('7');
        });

        it('english_language_resolves_yourFarms_from_translations_not_a_literal', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2, language: 'en' })} />);
            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el.getAttribute('aria-label')).toContain(oversightTranslations.en.yourFarms);
        });
    });
});
