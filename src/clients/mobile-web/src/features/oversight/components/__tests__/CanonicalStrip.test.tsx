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
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import CanonicalStrip, { FarmIdentityElement } from '../CanonicalStrip';
import type { CanonicalStripProps, FarmIdentityElementProps } from '../CanonicalStrip';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
import { dataFreshnessTranslations } from '../../../../i18n/dataFreshnessTranslations';

afterEach(() => {
    cleanup();
});

function baseStripProps(overrides: Partial<CanonicalStripProps> = {}): CanonicalStripProps {
    return {
        language: 'mr',
        waitingCount: 0,
        // Finding F7(a) — the DEFAULT here is "the data behind the count has
        // been read", so every pre-existing test keeps exercising the two
        // states it was written for. The `false` case has its own describe
        // block at the bottom of this file.
        dataResolved: true,
        // Change 3 — the DEFAULT is a single-farm account, which is what
        // most farmers have and what every pre-existing test was written
        // against, so those keep exercising the states they were written
        // for. The `>= 2` case has its own describe block below.
        farmCount: 1,
        // Founder decision 2026-08-26 — the freshness chip. The DEFAULT is
        // a device that has never completed a pull, because that is the
        // honest default for a test that supplies no sync state: it renders
        // the unknown form, which claims nothing. The known form has its own
        // describe block below.
        lastSyncAt: null,
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
        // Truth audit question 3 — the default is the ONE case in which the
        // plot count is a statable fact (data read, exactly one farm), so the
        // pre-existing tests below keep exercising what they were written for.
        // The two cases that make it unstatable each have their own test.
        dataResolved: true,
        onOpenFarmSwitcher: vi.fn(),
        ...overrides,
    };
}

describe('CanonicalStrip — row 2, the waiting button alone, full width', () => {
    it('the_waiting_button_is_ONE_node_across_states_and_changes_only_its_dress', () => {
        // FOUNDER RULING 2026-08-30 supersedes spec §2.2's "rest state keeps
        // its exact place and SIZE". He saw the fixed 52px floor on his own
        // phone and ruled that the strip "must not occupy that much space...
        // it is a banner that pops out when there is something to give
        // attention to", and that an empty state "must show only one line".
        // A locked height and a one-line rest state cannot both be true.
        //
        // What SURVIVES the ruling is the half that was actually protecting
        // the farmer: ONE node across the branch. A conditional
        // unmount/remount is a flicker he can see, and it is what this
        // rerender (rather than two isolated mounts) exists to catch.
        const { rerender } = render(<CanonicalStrip {...baseStripProps({ waitingCount: 0 })} />);
        const restButton = screen.getByTestId('canonical-strip-waiting-button');
        // Rest is the compact green line he asked for.
        expect(restButton.className).toContain('bg-emerald-50');
        expect(restButton.className).toContain('py-2');
        expect(restButton.className).not.toContain('amber');

        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 6 })} />);
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        // Same node — no remount, no flicker.
        expect(waitingButton).toBe(restButton);
        // ...wearing the amber banner dress, with room for its subtitle.
        expect(waitingButton.className).toContain('bg-amber-50');
        expect(waitingButton.className).toContain('py-2.5');
        expect(waitingButton.className).not.toContain('emerald');
        // And no fixed floor survives to re-inflate the quiet state.
        expect(waitingButton.getAttribute('style') ?? '').not.toContain('min-height');
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

    it('marathi_mode_rest_state_shows_the_founder_approved_copy_and_no_english_caption', () => {
        // A later founder message (2026-08-23) graduated `restState` to
        // founder-approved copy the same way Task 13 graduated
        // `waitingLabel` — so the placeholder-caption pattern must NOT
        // render for it any more (spec §6.2's caption only exists for
        // unapproved copy). Both assertions matter: the primary label
        // actually being the real approved string, and the caption actually
        // being gone (not merely additive) — proves
        // `PENDING_FOUNDER_STRINGS.includes(primaryKey)` is driving the
        // caption, not a hardcoded language check.
        render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 0 })} />);
        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
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

    it('the_waiting_subtitle_wraps_and_is_never_clipped', () => {
        // CHANGE 1. MEASURED in a real browser: the founder's Marathi
        // subtitle needs ~212px and the slot gives it 176px at 320px wide,
        // so `truncate` cut 36px of the sentence into an ellipsis on the
        // narrowest phones this app supports. A semi-literate reader loses
        // the words that say what is wanted of him and gets no usable signal
        // that anything was removed.
        //
        // Asserted as CLASSES because jsdom does no layout — there is no
        // width, no line box and no ellipsis to observe here. The three
        // classes below are exactly the three mechanisms in this codebase
        // that can clip a line, so their absence is the whole claim:
        // `truncate` (overflow-hidden + text-ellipsis + whitespace-nowrap),
        // `text-ellipsis` on its own, and `line-clamp-*` (a clamp is the
        // same defect deferred — it would clip a THREE-line string exactly
        // as `truncate` clipped this two-line one). The measured widths at
        // 390/360/320 are in the task report; this test is what stops the
        // class coming back.
        render(<CanonicalStrip {...baseStripProps({ language: 'mr', waitingCount: 6 })} />);

        const subtitle = screen.getByTestId('canonical-strip-waiting-subtitle');
        expect(subtitle.className).not.toMatch(/\btruncate\b/);
        expect(subtitle.className).not.toMatch(/\btext-ellipsis\b/);
        expect(subtitle.className).not.toMatch(/\bline-clamp-/);
        // The whole sentence is still the rendered content, not a prefix.
        expect(subtitle).toHaveTextContent(oversightTranslations.mr.waitingSubtitle);
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

describe('CanonicalStrip — the rest state is a claim, and a claim needs evidence (F7a)', () => {
    it('the_rest_state_is_not_rendered_while_dataResolved_is_false', () => {
        // The rest state says, in the founder's own words, "आज पर्यन्त सर्व
        // कामे पूर्ण आहेत" — all work is complete as of today. Every input
        // behind `waitingCount` starts empty and fills in asynchronously
        // (`useSyncQueueStatus` at `EMPTY_STATUS`, `useAppData` at `[]`), so
        // a zero that has not been measured yet must not reach that
        // sentence, nor the green tick that carries it for a farmer reading
        // colour before text.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />);

        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-checking-icon')).toBeInTheDocument();
    });

    it('the_checking_state_never_borrows_the_completion_colour', () => {
        // §P-G's own reasoning: colour is read before text. Emerald already
        // means "approved/complete" in this app, so it may not appear until
        // the claim is actually true. The waiting amber is equally wrong —
        // nothing has been shown to need him either.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />);

        const icon = screen.getByTestId('canonical-strip-waiting-checking-icon');
        expect(icon.className).not.toContain('emerald');
        expect(icon.className).not.toContain('amber');
        expect(icon.className).toMatch(/stone/);
        expect(screen.getByTestId('canonical-strip-waiting-button').className).not.toContain('amber');
    });

    it('the_checking_state_is_one_node_with_the_rest_state_and_shows_no_count', () => {
        // The height half of spec §2.2 is overruled (see the rerender test at
        // the top of this file). The no-remount half and the no-count half are
        // untouched and are what this still holds.
        const { rerender } = render(
            <CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />,
        );
        const checkingButton = screen.getByTestId('canonical-strip-waiting-button');
        // Checking is neutral: it is neither an alert nor an all-clear, so it
        // must not borrow the amber banner or the green completion colour.
        expect(checkingButton.className).not.toContain('amber');
        expect(checkingButton.className).not.toContain('emerald');
        // No badge: there is no measured number to show.
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();

        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: true })} />);
        const restButton = screen.getByTestId('canonical-strip-waiting-button');
        expect(restButton).toBe(checkingButton);
        expect(restButton.className).toContain('bg-emerald-50');
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
    });

    it('a_real_derived_count_still_shows_while_the_data_is_still_resolving', () => {
        // The gate covers the REST state only. A non-zero count mid-load is
        // a real, derived number that may still grow — reporting it early
        // understates, which is a different and far smaller sin than
        // claiming completion. Suppressing it would hide real work.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 4, dataResolved: false })} />);

        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('4');
        expect(screen.getByTestId('canonical-strip-waiting-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-checking-icon')).not.toBeInTheDocument();
    });

    it('the_checking_label_is_the_founders_marathi_and_carries_no_english_caption', () => {
        // `checkingState` shipped as category (c) (`mr: ''`) and read
        // through to English. The founder supplied his own Marathi on
        // 2026-08-24, so it graduated out of `PENDING_FOUNDER_STRINGS` — a
        // Marathi farmer now reads Marathi here, and the placeholder caption
        // (which exists only to show English beside UNAPPROVED copy) must
        // not render for it.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false, language: 'mr' })} />);

        expect(screen.getByText(oversightTranslations.mr.checkingState)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.en.checkingState)).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
    });
});

describe('CanonicalStrip — "Checking…" has a terminus (change 2)', () => {
    // Real timers would make these tests take 8 seconds each and would make
    // the boundary itself untestable. `vi.useFakeTimers()` lets the ONE
    // number that matters — `CHECKING_TIMEOUT_MS` — be crossed deliberately.
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('the_checking_state_stops_spinning_and_admits_it_cannot_confirm', () => {
        // The defect: `useAppData` runs ONE load pass with no retry, and
        // `useSyncQueueStatus.hasLoaded` flips only on a fully successful
        // Dexie read. Either failing left the strip spinning for the whole
        // session — which a farmer reads as "broken", with nothing said
        // about his own work.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />);
        expect(screen.getByTestId('canonical-strip-waiting-checking-icon')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(8000); });

        // Spinner gone, and NOT replaced by either of the two things that
        // would be a lie: a green tick, or a count.
        expect(screen.queryByTestId('canonical-strip-waiting-checking-icon')).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-unknown-icon')).toBeInTheDocument();
        // `baseStripProps` renders in Marathi; `unknownState` graduated to
        // the founder's own Marathi 2026-08-24, so that is what shows.
        expect(screen.getByText(oversightTranslations.mr.unknownState)).toBeInTheDocument();
    });

    it('the_unknown_state_never_claims_completion_and_never_asks_for_action', () => {
        // §P-G: colour is read before text. Emerald means approved/complete
        // — the one thing that is not true here. Amber means "this needs
        // you" — also wrong: the farmer can do nothing about a failed read,
        // and an amber strip he cannot resolve is exactly the blindness
        // spec §7 warns about. Stone is this strip's word for "we cannot
        // say", already carried by the checking state.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />);
        act(() => { vi.advanceTimersByTime(8000); });

        const icon = screen.getByTestId('canonical-strip-waiting-unknown-icon');
        expect(icon.className).not.toContain('emerald');
        expect(icon.className).not.toContain('amber');
        expect(icon.className).toMatch(/stone/);
        expect(screen.getByTestId('canonical-strip-waiting-button').className).not.toContain('amber');
        // The claim itself must not be on screen in either language.
        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.en.restState)).not.toBeInTheDocument();
    });

    it('the_timeout_never_fires_once_the_data_actually_resolves', () => {
        // The timeout is a terminus for an unanswered read, not a deadline
        // on the app. Data that lands at 7.9s must render the REAL state and
        // stay there — a pending timer that fired afterwards would flip a
        // truthful strip into "cannot confirm" for no reason.
        const { rerender } = render(
            <CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />,
        );
        act(() => { vi.advanceTimersByTime(7900); });
        expect(screen.getByTestId('canonical-strip-waiting-checking-icon')).toBeInTheDocument();

        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: true })} />);
        act(() => { vi.advanceTimersByTime(60000); });

        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-unknown-icon')).not.toBeInTheDocument();
    });

    it('a_second_read_gets_its_own_full_checking_window', () => {
        // `dataResolved` is not monotonic: it is `useAppData.dataLoaded &&
        // useSyncQueueStatus.hasLoaded`, and `useAppData` re-runs its load
        // pass (resetting `dataLoaded` to false) whenever its data source
        // changes. A give-up left over from an EARLIER read would then send
        // the strip straight to "cannot confirm" without ever trying — the
        // component would have stopped reading before the read began.
        const { rerender } = render(
            <CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />,
        );
        act(() => { vi.advanceTimersByTime(8000); });
        expect(screen.getByTestId('canonical-strip-waiting-unknown-icon')).toBeInTheDocument();

        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: true })} />);
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();

        // Second read starts. It must get the SPINNER and its own full
        // window, not inherit the first read's verdict.
        rerender(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false })} />);
        expect(screen.getByTestId('canonical-strip-waiting-checking-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-unknown-icon')).not.toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(8000); });
        expect(screen.getByTestId('canonical-strip-waiting-unknown-icon')).toBeInTheDocument();
    });

    it('the_unknown_label_is_the_founders_marathi_and_carries_no_english_caption', () => {
        // Same terms as `checkingState`: shipped `mr: ''`, graduated to the
        // founder's own Marathi 2026-08-24, out of `PENDING_FOUNDER_STRINGS`
        // — so the placeholder caption (which exists only to show English
        // beside UNAPPROVED copy) must not render.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false, language: 'mr' })} />);
        act(() => { vi.advanceTimersByTime(8000); });

        expect(screen.getByText(oversightTranslations.mr.unknownState)).toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.en.unknownState)).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-caption')).not.toBeInTheDocument();
    });

    it('the_unknown_label_renders_in_the_locked_marathi_body_font', () => {
        // Root CLAUDE.md's font rule, pinned where it can actually regress:
        // `CanonicalStrip` picks the font from the TEXT (`fontStyleFor`), so
        // a string that stopped containing Devanagari — or a component that
        // stopped setting the family — would silently hand a farmer DM Sans
        // or a generic fallback for Devanagari glyphs.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false, language: 'mr' })} />);
        act(() => { vi.advanceTimersByTime(8000); });

        const label = screen.getByText(oversightTranslations.mr.unknownState);
        expect(label).toHaveStyle({ fontFamily: "'Noto Sans Devanagari', sans-serif" });
    });

    it('the_unknown_label_is_still_clipped_by_truncate_at_every_supported_width', () => {
        // NOT an endorsement — a RECORD, so the founder's decision is
        // visible in code rather than only in a report.
        //
        // MEASURED at 390/360/320px in headless Chromium with the real
        // Google font (numbers in the task report): the founder's
        // `unknownState` needs ~336px and this slot gives 278/248/208px, so
        // `truncate` clips it on every phone this app supports. The brief
        // that applied his Marathi says "do not shrink a font or truncate to
        // make it fit; report the measurement" — so nothing here was
        // resized, and the class was NOT removed either: dropping it changes
        // how the shared title slot renders `waitingLabel` and `restState`
        // too, which is a layout decision he has not made.
        //
        // Asserted as a CLASS because jsdom does no layout — there is no
        // width, no line box and no ellipsis to observe here. When he rules
        // on the wrap, this test is the one to invert.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false, language: 'mr' })} />);
        act(() => { vi.advanceTimersByTime(8000); });

        const label = screen.getByText(oversightTranslations.mr.unknownState);
        expect(label.className).toMatch(/\btruncate\b/);
        // Whatever the CSS does to it, the DOM still carries the whole
        // sentence — nothing is shortened in the data.
        expect(label).toHaveTextContent(oversightTranslations.mr.unknownState);
    });
});

describe('CanonicalStrip — a multi-farm account gets no completion claim (change 3)', () => {
    it('the_rest_state_never_renders_on_a_multi_farm_account', () => {
        // "आज पर्यन्त सर्व कामे पूर्ण आहेत" names a subject as well as a
        // fact, and the subject a farmer reads it against is the farm named
        // in the chip beside it. The app cannot make that scoped claim:
        // `app/helpers/appContentOversightInputs.ts` states in its own words
        // that `history`/`crops` come from `dataSource.{logs,crops}.getAll()`
        // and are "NOT scoped to `currentFarmId` for an account with more
        // than one farm". Same strip already prints a cross-farm plot sum
        // under one farm's name, so the frame is mis-scoped too.
        //
        // Suppressed, NOT filtered: `meta.farmId` is present on synced logs
        // and absent on locally-created ones whose farm was unknown at save
        // time, so filtering on it would hide the farmer's own unsynced work.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: true, farmCount: 2 })} />);

        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.en.restState)).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        // Lands on the SAME non-claiming surface the timed-out read uses —
        // its wording names the outcome, never the cause, so one key carries
        // both. Never a spinner: nothing here is still being read.
        expect(screen.getByTestId('canonical-strip-waiting-unknown-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-checking-icon')).not.toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.unknownState)).toBeInTheDocument();
    });

    it('a_single_farm_account_still_gets_the_rest_state', () => {
        // The other half, and the one that stops the fix from being "delete
        // the rest state". Most farmers have exactly one farm and the claim
        // is scopeable for them — spec §2.2's rest state must survive intact.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: true, farmCount: 1 })} />);

        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-unknown-icon')).not.toBeInTheDocument();
    });

    it('a_multi_farm_account_still_sees_its_real_waiting_count', () => {
        // Only the CLAIM is suppressed. A non-zero count is a derived,
        // real number; hiding it would hide work the owner has to act on,
        // which is a far worse trade than a strip that declines to say
        // "everything is done".
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 6, dataResolved: true, farmCount: 3 })} />);

        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('6');
        expect(screen.getByTestId('canonical-strip-waiting-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-unknown-icon')).not.toBeInTheDocument();
    });

    it('a_multi_farm_account_still_shows_the_spinner_while_its_data_loads', () => {
        // Ordering matters: the multi-farm verdict must come AFTER the
        // checking state, not instead of it. Otherwise an account with two
        // farms would render "cannot confirm" before a single row had been
        // read — the right words for the wrong reason, and it would mask a
        // genuinely stuck read behind a permanent structural one.
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 0, dataResolved: false, farmCount: 2 })} />);

        const icon = screen.getByTestId('canonical-strip-waiting-checking-icon');
        expect(icon).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-unknown-icon')).not.toBeInTheDocument();
        // The testid alone is NOT enough here, and this is the assertion
        // that proves it: the testid lives on the shared wrapper span, so a
        // state machine whose branches overlap would keep the right testid
        // while rendering BOTH glyphs inside it — a spinner with a question
        // mark stacked on top. Exactly one icon, always.
        expect(icon.querySelectorAll('svg')).toHaveLength(1);
    });

    it('exactly_one_mark_renders_in_the_ring_in_every_state', () => {
        // The four states are mutually exclusive by construction, not by
        // the order of the ternaries that pick the label. This walks every
        // combination that can reach the ring and asserts ONE mark in each —
        // the general form of the overlap the test above catches for one
        // case.
        //
        // FOUNDER RULING 2026-08-27 — the slot is now a 44px RING (`h-11`,
        // was the 28px `h-7` glyph chip), and in the WAITING state its mark
        // is `waitingCount` itself rather than an icon: the ring the founder
        // asked for carries the strip's own fact, which is why the
        // right-hand count pill is gone. So the invariant is no longer "one
        // svg" but "one mark, glyph XOR number, never both and never
        // neither" — a state machine with overlapping branches would show a
        // number stacked on a tick, and that is what this catches.
        const cases: Partial<CanonicalStripProps>[] = [
            { waitingCount: 6, dataResolved: true, farmCount: 1 },
            { waitingCount: 6, dataResolved: false, farmCount: 4 },
            { waitingCount: 0, dataResolved: false, farmCount: 1 },
            { waitingCount: 0, dataResolved: false, farmCount: 4 },
            { waitingCount: 0, dataResolved: true, farmCount: 1 },
            { waitingCount: 0, dataResolved: true, farmCount: 4 },
        ];
        for (const props of cases) {
            const label = JSON.stringify(props);
            const { container } = render(<CanonicalStrip {...baseStripProps(props)} />);
            // Selected by the ring's own four testids, NOT by `h-11`: the
            // 2026-08-30 ruling shrank the disc to 24px in the three states
            // that hold a glyph rather than a number, so a size-based selector
            // would silently match only the waiting case and pass the other
            // five by never asserting them.
            const ring = container.querySelector(
                '[data-testid="canonical-strip-waiting-icon"],'
                + '[data-testid="canonical-strip-waiting-checking-icon"],'
                + '[data-testid="canonical-strip-waiting-unknown-icon"],'
                + '[data-testid="canonical-strip-waiting-rest-tick"]',
            );
            expect(ring, label).not.toBeNull();

            const glyphs = ring!.querySelectorAll('svg').length;
            const numbers = ring!.querySelectorAll('[data-testid="canonical-strip-waiting-count"]').length;
            expect(glyphs + numbers, label).toBe(1);
            // ...and which of the two it is follows the count, never the
            // render order.
            expect(numbers, label).toBe((props.waitingCount ?? 0) > 0 ? 1 : 0);
            cleanup();
        }
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

        // TRUTH FIX (truth audit, question 3), half 2 of 2 — UNREAD IS NOT ZERO.
        //
        // WHAT IT CLAIMED: "० प्लॉट" under the farm name — that this farm has
        // no plots.
        // WHY THE DATA CANNOT BACK IT: `AppHeader.tsx` computes
        // `oversightData?.plotCount ?? 0`, so before the first load resolves
        // the 0 is "not read yet", not "none" — the same distinction
        // `dataResolved` already draws for the strip's completion claim.
        // Doctrine P4 — no fabricated numbers.
        it('states no plot count before the data behind it has been read', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 1, plotCount: 0, dataResolved: false })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            // The farm's own identity is not in doubt and still renders.
            expect(el).toHaveTextContent('Arve Farm');
            expect(el.textContent).not.toContain(oversightTranslations.mr.plotsUnit);
            expect(el.textContent).not.toContain('0');
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

        // TRIPWIRE, not a deletion. This assertion used to require the plot
        // count to be PRESENT on the multi-farm chip. It is now required to be
        // ABSENT, so re-adding it fails here rather than shipping a number
        // scoped to the wrong subject.
        //
        // WHAT IT CLAIMED: "7 प्लॉट" printed under ONE farm's name reads as
        // that farm's plot count.
        // WHY THE DATA CANNOT BACK IT: `appContentOversightInputs.ts` sums
        // `crop.plots.length` over `dataSource.crops.getAll()` — every crop of
        // the SIGNED-IN USER — and says so itself: this data "is NOT scoped to
        // `currentFarmId` for an account with more than one farm". With 2+
        // farms the number counts every farm while the name picks one.
        // `CanonicalStrip` already suppressed the completion SENTENCE for this
        // exact reason (CHANGE 3); the number 100px away was not.
        // Doctrine P4 — no fabricated numbers. Truth audit, question 3.
        it('never states a plot count when more than one farm is summed into it', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2, farmName: 'Bhosale Vasti', plotCount: 7 })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            // The farm name and the switcher itself are untouched — only the
            // claim the app cannot scope is gone.
            expect(el).toHaveTextContent('Bhosale Vasti');
            expect(screen.getByTestId('canonical-strip-farm-count-badge')).toHaveTextContent('2');

            expect(el.textContent).not.toContain('7');
            expect(el.textContent).not.toContain(oversightTranslations.mr.plotsUnit);
            // A screen reader is told the same untrue thing, so the accessible
            // name must drop it too — not merely the visible text.
            expect(el.getAttribute('aria-label')).not.toContain('7');
            expect(el.getAttribute('aria-label')).toContain('Bhosale Vasti');
        });

        // `dataResolved` alone must not buy the claim back: resolved data on a
        // 3-farm account is still summed across all three.
        it('resolved data does not re-enable the plot count on a multi-farm account', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 3, plotCount: 12, dataResolved: true })} />);

            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el.textContent).not.toContain('12');
            expect(el.textContent).not.toContain(oversightTranslations.mr.plotsUnit);
        });

        it('english_language_resolves_yourFarms_from_translations_not_a_literal', () => {
            render(<FarmIdentityElement {...baseFarmChipProps({ farmCount: 2, language: 'en' })} />);
            const el = screen.getByTestId('canonical-strip-farm-chip');
            expect(el.getAttribute('aria-label')).toContain(oversightTranslations.en.yourFarms);
        });
    });
});

describe('CanonicalStrip — the bar is TWO LINES (founder ruling 2026-08-29)', () => {
    // His words, on the built screen: *"for oversight strip as well then size is
    // becoming bigger. Only Two lines must be there and the grey part must go
    // inside it not as visible as it is now."*
    //
    // The grey part is the freshness sentence added on 2026-08-26. It is NOT
    // deleted — that decision's reasoning still stands (it is the timestamp the
    // strip's four states must be read against). It MOVED into the overlay this
    // bar opens; `OversightOverlay.test.tsx` now owns the properties that used
    // to live in this file (the two honest forms, the no-"sync" rule, the
    // locked Devanagari font). What is asserted here is only what leaving does
    // to the bar.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T06:30:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders no freshness chip, in any state', () => {
        for (const props of [
            baseStripProps({ lastSyncAt: '2026-08-26T05:30:00Z' }),
            baseStripProps({ lastSyncAt: null }),
            baseStripProps({ waitingCount: 4, lastSyncAt: '2026-08-26T05:30:00Z' }),
        ]) {
            const { unmount } = render(<CanonicalStrip {...props} />);
            expect(screen.queryByTestId('canonical-strip-freshness-chip')).toBeNull();
            unmount();
        }
    });

    it('leaves at most two text lines in the slot — the title and its subtitle', () => {
        render(<CanonicalStrip {...baseStripProps({ waitingCount: 4, lastSyncAt: '2026-08-26T05:30:00Z' })} />);

        // The waiting state is the tallest one: it is the only state carrying a
        // subtitle, and it was the state the founder measured.
        expect(screen.getByText(oversightTranslations.mr.waitingLabel)).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-subtitle')).toBeInTheDocument();
        // ...and nothing else. A third line here is the regression.
        expect(screen.queryByTestId('canonical-strip-freshness-chip')).toBeNull();
    });

    it('still tells a screen reader how recent the picture is — the fact is relocated, not dropped', () => {
        // The chip left the screen; it must not leave the accessible name, or
        // the one owner who cannot see the overlay's header would be the only
        // person never told. Same reasoning the 2026-08-26 decision used to put
        // it in this label in the first place.
        render(<CanonicalStrip {...baseStripProps({ lastSyncAt: '2026-08-26T05:30:00Z' })} />);
        const label = screen.getByTestId('canonical-strip-waiting-button').getAttribute('aria-label') ?? '';

        expect(label).toContain('11:00');
        expect(label).toContain(dataFreshnessTranslations.mr.dayToday);
        expect(label.toLowerCase()).not.toContain('sync');
    });
});
