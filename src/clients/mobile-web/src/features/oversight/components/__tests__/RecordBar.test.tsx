// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 8 — design doc §5.2, §5.3)
 *
 * Pins the five things about the pinned record bar that a future edit could
 * break silently, in the exact terms the spec and the task brief state them:
 *
 *   1. WHICH STRING. §5.2 — grey "saying what to do first" before a plot is
 *      chosen, "emerald and active the moment one is". The two strings are
 *      founder-supplied; swapping them is a change no compiler catches and
 *      no screenshot review would necessarily catch either, because both
 *      states LOOK plausible on their own.
 *   2. HOW IT IS READ. Both keys are in `PENDING_FOUNDER_STRINGS`, so they
 *      must come through `resolveOversightString()`. Reading
 *      `oversightTranslations.mr[key]` directly renders a blank label the
 *      day the founder blanks a key for rewording.
 *   3. THE COLOUR RULE. §P-G: `bg-emerald-600` already means APPROVE in this
 *      app. The idle bar may never be emerald — that is a colour-carried
 *      rule, so it gets a test, exactly like the Seen control's (DoD #5).
 *   4. INERT MEANS INERT. §5.2's "grey ... emerald and ACTIVE" — the idle
 *      bar is natively `disabled`, not merely dimmed. `P5`: never teach the
 *      farmer a button works when it does not.
 *   5. THE FONT RULE. Marathi body text renders in 'Noto Sans Devanagari';
 *      the step numeral is a number and renders in 'DM Sans'. Non-negotiable
 *      per root CLAUDE.md, and invisible to typecheck.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations, PENDING_FOUNDER_STRINGS } from '../../../../i18n/oversightTranslations';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => key,
    }),
}));

import RecordBar, {
    RECORD_BAR_HEIGHT_PX,
    RECORD_BAR_BLOCK_PX,
    NAV_CREST_RESERVE_PX,
    mainPaddingBottomFor,
    shouldShowRecordBar,
} from '../RecordBar';

afterEach(() => {
    cleanup();
});

const MARATHI_BODY_FONT = "'Noto Sans Devanagari', sans-serif";
const ENGLISH_FONT = "'DM Sans', sans-serif";

describe('RecordBar — the second tap, pinned (Task 8, §5.2)', () => {
    it('the_record_bar_reads_the_idle_string_before_a_plot_is_chosen', () => {
        render(<RecordBar active={false} onActivate={vi.fn()} />);

        expect(screen.getByTestId('record-bar-label')).toHaveTextContent(
            oversightTranslations.mr.recordBarIdle,
        );
        // Guards the swap: the ACTIVE string must not be on screen at all.
        expect(screen.queryByText(oversightTranslations.mr.recordBarActive)).toBeNull();
    });

    it('the_record_bar_reads_the_active_string_once_a_plot_is_chosen', () => {
        render(<RecordBar active onActivate={vi.fn()} />);

        expect(screen.getByTestId('record-bar-label')).toHaveTextContent(
            oversightTranslations.mr.recordBarActive,
        );
        expect(screen.queryByText(oversightTranslations.mr.recordBarIdle)).toBeNull();
    });

    it('both_record_bar_strings_are_still_founder_pending_and_read_through_the_resolver', () => {
        // If either key ever ships `mr: ''` (the "founder has not written
        // this yet" encoding, `oversightTranslations.ts` Ruling 7), reading
        // it directly would paint a BLANK bar. This asserts the two facts
        // that together make that impossible: the keys are declared pending,
        // and what renders is never the empty string.
        expect(PENDING_FOUNDER_STRINGS).toContain('recordBarIdle');
        expect(PENDING_FOUNDER_STRINGS).toContain('recordBarActive');

        render(<RecordBar active={false} onActivate={vi.fn()} />);
        expect(screen.getByTestId('record-bar-label').textContent).not.toBe('');
    });

    it('the_idle_record_bar_is_never_emerald', () => {
        // spec §P-G — `bg-emerald-600` already means APPROVE in this app
        // (`ReviewInbox.tsx`, `AttentionCard.tsx`). A farmer reads colour
        // before text, so an emerald "choose a plot first" would say
        // "approved" whatever the words said.
        render(<RecordBar active={false} onActivate={vi.fn()} />);

        const button = screen.getByTestId('record-bar-button');
        expect(button.className).not.toContain('emerald');
        expect(button.className).toContain('bg-stone-200');
    });

    it('the_active_record_bar_is_emerald', () => {
        render(<RecordBar active onActivate={vi.fn()} />);

        expect(screen.getByTestId('record-bar-button').className).toContain('bg-emerald-600');
    });

    it('the_idle_record_bar_is_inert_not_merely_dimmed', () => {
        const onActivate = vi.fn();
        render(<RecordBar active={false} onActivate={onActivate} />);

        const button = screen.getByTestId('record-bar-button') as HTMLButtonElement;
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(onActivate).not.toHaveBeenCalled();
    });

    it('the_active_record_bar_runs_its_one_action_on_tap', () => {
        const onActivate = vi.fn();
        render(<RecordBar active onActivate={onActivate} />);

        fireEvent.click(screen.getByTestId('record-bar-button'));
        expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('the_record_bar_tap_target_is_at_least_44px', () => {
        // Brief constraint 3. jsdom lays nothing out, so the class that
        // carries the floor is what gets pinned — the browser check
        // measured the rendered button at 56px at both 390x844 and 360x800.
        render(<RecordBar active onActivate={vi.fn()} />);

        const className = screen.getByTestId('record-bar-button').className;
        const match = /min-h-\[(\d+)px\]/.exec(className);
        expect(match).not.toBeNull();
        expect(Number(match?.[1])).toBeGreaterThanOrEqual(44);
    });

    it('the_record_bar_renders_marathi_in_noto_sans_devanagari_and_the_step_numeral_in_dm_sans', () => {
        // Root CLAUDE.md, non-negotiable: Marathi body text is 'Noto Sans
        // Devanagari'; numbers are 'DM Sans'. Never `system-ui`/`Arial`/a
        // generic fallback for visible text.
        render(<RecordBar active onActivate={vi.fn()} />);

        expect(screen.getByTestId('record-bar-label')).toHaveStyle({ fontFamily: MARATHI_BODY_FONT });
        expect(screen.getByTestId('record-bar-step')).toHaveStyle({ fontFamily: ENGLISH_FONT });
    });

    it('the_record_bar_is_pinned_above_the_navigation_not_left_in_the_scroll_flow', () => {
        // §5.2 — "pinned above the navigation so it never scrolls away".
        // The whole point of Task 8: `position: fixed`, offset by the nav's
        // own 5rem height, so no amount of page scrolling can move it. The
        // browser check confirmed the rendered box stays at y=664 with the
        // scrollport at scrollTop 0 and at scrollTop 2966.
        render(<RecordBar active onActivate={vi.fn()} />);

        const bar = screen.getByTestId('record-bar');
        expect(bar.className).toContain('fixed');
        expect(bar.style.bottom).toContain('5rem');
        expect(bar.style.bottom).toContain('safe-area-inset-bottom');
    });

    it('the_record_bar_carries_step_two_of_the_two_tap_sequence', () => {
        // spec §5.3 — "② on the record bar". Drawn as a circled DM Sans
        // digit, never the pre-composed "②" glyph (which would render in
        // whatever font the device happens to have it in).
        render(<RecordBar active onActivate={vi.fn()} />);

        expect(screen.getByTestId('record-bar-step')).toHaveTextContent('2');
        expect(screen.getByTestId('record-bar-step').textContent).not.toContain('②');
    });
});

describe('RecordBar — where it is allowed on screen (Task 8)', () => {
    const base = {
        currentRoute: 'main' as const,
        mainView: 'log' as const,
        status: 'idle' as const,
        recordingSegment: null,
        mode: 'voice',
    };

    it('the_record_bar_shows_on_the_log_home_screen', () => {
        expect(shouldShowRecordBar(base)).toBe(true);
    });

    it('the_record_bar_is_hidden_off_the_log_screen', () => {
        expect(shouldShowRecordBar({ ...base, mainView: 'reflect' })).toBe(false);
        expect(shouldShowRecordBar({ ...base, mainView: 'compare' })).toBe(false);
        expect(shouldShowRecordBar({ ...base, currentRoute: 'labour' })).toBe(false);
    });

    it('the_record_bar_is_hidden_once_the_parse_takes_over_the_screen', () => {
        // Mirrors `renderLogView`'s own idle-branch condition: these three
        // statuses REPLACE the home screen with the parse-result screens,
        // and a bar reading "बोला" pinned over a confirmation card invites
        // the farmer to speak over work he is being asked to check.
        expect(shouldShowRecordBar({ ...base, status: 'processing' })).toBe(false);
        expect(shouldShowRecordBar({ ...base, status: 'confirming' })).toBe(false);
        expect(shouldShowRecordBar({ ...base, status: 'success' })).toBe(false);
    });

    it('the_record_bar_stays_on_screen_while_a_recording_is_live', () => {
        // Brief constraint 2. `status` is never 'recording' at app level —
        // `AudioRecorder` keeps `isRecording` internally — so a live
        // recording presents here as 'idle'. The bar must therefore keep
        // rendering, unchanged, through the whole recording: a predicate
        // that flipped it off mid-record would remount the pinned block
        // under the farmer's thumb while the mic is open.
        expect(shouldShowRecordBar({ ...base, status: 'idle' })).toBe(true);
        expect(shouldShowRecordBar({ ...base, status: 'error' })).toBe(true);
    });

    it('the_record_bar_stands_down_rather_than_mislabel_itself_in_manual_entry', () => {
        // The only two founder-approved strings are "choose a plot first"
        // and "speak". There is no approved Marathi for "write" and §6
        // forbids inventing one.
        expect(shouldShowRecordBar({ ...base, mode: 'manual' })).toBe(false);
    });

    it('the_record_bar_stands_down_during_a_segment_re_record_and_under_the_keyboard', () => {
        expect(shouldShowRecordBar({ ...base, recordingSegment: 'labour' })).toBe(false);
        expect(shouldShowRecordBar({ ...base, keyboardOpen: true })).toBe(false);
    });
});

describe('RecordBar — the room it takes from the page (Task 8, DoD #8)', () => {
    it('the_page_reserves_the_whole_record_bar_block_so_the_last_card_is_not_hidden_under_it', () => {
        const withBar = mainPaddingBottomFor(true);
        const withoutBar = mainPaddingBottomFor(false);

        expect(withoutBar).toContain('6rem');
        expect(withoutBar).not.toContain(`${RECORD_BAR_BLOCK_PX}px`);
        // The BLOCK, not just the control: the reserve band under the
        // control is opaque too, so content behind it is equally hidden.
        expect(withBar).toContain(`${RECORD_BAR_BLOCK_PX}px`);
        expect(RECORD_BAR_BLOCK_PX).toBe(RECORD_BAR_HEIGHT_PX + NAV_CREST_RESERVE_PX);
    });

    it('the_reserve_band_clears_the_raised_schedule_button', () => {
        // MEASURED at 390x844: `BottomNavigation`'s centre button's circle
        // spans y 740-820 against a nav top edge of 763 — a 23px crest. A
        // reserve smaller than that puts the button through the control.
        const MEASURED_NAV_CREST_PX = 23;
        expect(NAV_CREST_RESERVE_PX).toBeGreaterThan(MEASURED_NAV_CREST_PX);
    });
});
