// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 5 — pins `WaitingDrawer`'s locked behaviours (design doc §3, task-5
 * brief). Presentational component: every test renders with a hand-built
 * `OversightModel`, no providers, no Dexie. §9.4 and §9.5 of the spec are
 * proven here — the two rules this component exists to enforce:
 *
 *   RULE 1 (spec §P-A) — Seeing is never approving. Pinned by
 *   `acknowledging_does_not_change_any_decision_row`: clicking Seen must
 *   call ONLY `onAcknowledge`, must never mutate the `model` object, and
 *   every decision row rendered before the click must still be rendered,
 *   byte-identical, after it.
 *
 *   RULE 2 (spec §P-G) — The Seen control is never emerald. Pinned by
 *   `the_seen_control_is_not_emerald`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import WaitingDrawer from '../WaitingDrawer';
import type { WaitingDrawerProps } from '../WaitingDrawer';
import type { OversightDecision, OversightModel, OversightPerson } from '../../oversightSelectors';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

afterEach(() => {
    cleanup();
});

function makePerson(overrides: Partial<OversightPerson> = {}): OversightPerson {
    return {
        operatorId: 'op-1',
        name: 'Rokade',
        recordCount: 6,
        plotNames: ['Grapes A', 'Grapes B', 'Sugarcane B'],
        workCategories: ['irrigation', 'labour'],
        ...overrides,
    };
}

function baseModel(overrides: Partial<OversightModel> = {}): OversightModel {
    return {
        people: [],
        unattributed: null,
        totalRecords: 0,
        totalPlots: 0,
        decisions: [],
        waitingCount: 0,
        sinceDays: 3,
        boundaryApproximate: true,
        ...overrides,
    };
}

function baseProps(overrides: Partial<WaitingDrawerProps> = {}): WaitingDrawerProps {
    return {
        language: 'mr',
        model: baseModel(),
        status: 'idle',
        onAcknowledge: vi.fn(),
        ...overrides,
    };
}

describe('WaitingDrawer', () => {
    it('acknowledging_does_not_change_any_decision_row', () => {
        // Spec §P-A: "Seeing must never change decision state." This is the
        // single most important behaviour in the feature. A hand-built
        // model with all three decision kinds present is rendered, its
        // decision-row text is captured, Seen is clicked, and every row
        // must still be there, unchanged — proven, not inspected.
        const decisions: OversightDecision[] = [
            { kind: 'approval', count: 6, holderName: null },
            { kind: 'dayNotClosed', count: 1, holderName: null },
            { kind: 'failedSend', count: 2, holderName: null },
        ];
        const model = baseModel({ decisions, waitingCount: 3 });
        const modelSnapshotBefore = JSON.stringify(model);

        const onAcknowledge = vi.fn();
        const onOpenDecision = vi.fn();
        const onOpenPerson = vi.fn();

        render(
            <WaitingDrawer
                {...baseProps({ model, onAcknowledge, onOpenDecision, onOpenPerson })}
            />,
        );

        const rowsBefore = screen.getAllByTestId(/^waiting-drawer-decision-/).map((el) => el.textContent);
        expect(rowsBefore).toHaveLength(3);

        fireEvent.click(screen.getByTestId('waiting-drawer-seen-button'));

        // ONLY onAcknowledge fires — nothing that could touch a decision.
        expect(onAcknowledge).toHaveBeenCalledTimes(1);
        expect(onOpenDecision).not.toHaveBeenCalled();
        expect(onOpenPerson).not.toHaveBeenCalled();

        // The model object itself was never mutated as a side effect.
        expect(JSON.stringify(model)).toBe(modelSnapshotBefore);

        // Every decision row is still rendered, byte-identical.
        const rowsAfter = screen.getAllByTestId(/^waiting-drawer-decision-/).map((el) => el.textContent);
        expect(rowsAfter).toEqual(rowsBefore);
    });

    it('the_seen_control_is_not_emerald', () => {
        // Spec §P-G: "The Seen control is never emerald ... White with a
        // 2px neutral (stone-400) border." bg-emerald-600 already means
        // Approve elsewhere in this app (ReviewInbox.tsx:97,
        // AttentionCard.tsx:121).
        render(<WaitingDrawer {...baseProps()} />);
        const seenButton = screen.getByTestId('waiting-drawer-seen-button');

        expect(seenButton.className).not.toContain('emerald');
        expect(seenButton.className).toMatch(/border-stone-400/);
        expect(seenButton.className).toMatch(/bg-white/);
    });

    it('a_delegated_decision_renders_no_action_and_names_the_holder', () => {
        // Spec §3: "same row, same position, no action affordance — it
        // names who holds the authority instead."
        const decisions: OversightDecision[] = [
            { kind: 'approval', count: 6, holderName: 'Ganesh Mukadam' },
        ];
        const onOpenDecision = vi.fn();
        render(<WaitingDrawer {...baseProps({ model: baseModel({ decisions }), onOpenDecision })} />);

        const row = screen.getByTestId('waiting-drawer-decision-approval');

        // No action affordance: not a button, and clicking it does nothing.
        expect(row.tagName).not.toBe('BUTTON');
        fireEvent.click(row);
        expect(onOpenDecision).not.toHaveBeenCalled();

        // The owner keeps full visibility: the holder's name is named.
        expect(row).toHaveTextContent('Ganesh Mukadam');
    });

    it('a_non_delegated_decision_renders_an_action_affordance', () => {
        // Control case for the test above: a decision with NO holderName
        // renders as an interactive row that calls onOpenDecision.
        const decisions: OversightDecision[] = [
            { kind: 'approval', count: 6, holderName: null },
        ];
        const onOpenDecision = vi.fn();
        render(<WaitingDrawer {...baseProps({ model: baseModel({ decisions }), onOpenDecision })} />);

        const row = screen.getByTestId('waiting-drawer-decision-approval');
        expect(row.tagName).toBe('BUTTON');

        fireEvent.click(row);
        expect(onOpenDecision).toHaveBeenCalledTimes(1);
        expect(onOpenDecision).toHaveBeenCalledWith(decisions[0]);
    });

    it('the_unsendable_row_icon_is_a_concrete_object_not_a_cloud', () => {
        // CHANGE 5. `CloudOff` said nothing to the reader this row exists
        // for: a smallholder farmer has no mental model in which a cloud
        // holds his records, and at this row's 14px its thin
        // slash-over-cloud collapses into a smudge. `FileX` — a written page
        // with a cross through it — names two things he can name, and
        // matches the app's own metaphor for the destination (the farm book,
        // शेतनोंद / `farmBookOpen`), which is what
        // `unsendableRecordsLine` describes in words.
        //
        // Asserted through lucide's own per-icon class, which is the only
        // thing distinguishing one rendered <svg> from another here.
        const decisions: OversightDecision[] = [
            { kind: 'unqueueable', count: 2, holderName: null },
            { kind: 'failedSend', count: 1, holderName: null },
        ];
        render(<WaitingDrawer {...baseProps({ model: baseModel({ decisions }) })} />);

        const row = screen.getByTestId('waiting-drawer-decision-unqueueable');
        const icon = row.querySelector('svg');
        expect(icon).not.toBeNull();
        expect(icon!.getAttribute('class') ?? '').not.toContain('cloud');
        expect(icon!.getAttribute('class') ?? '').toContain('lucide-file-x');

        // Finding F6's own constraint, re-proven rather than assumed: this
        // row must NOT share the "act on me" glyph `failedSend` owns, or the
        // owner reads two different facts as one thing said twice.
        const failedIcon = screen.getByTestId('waiting-drawer-decision-failedSend').querySelector('svg');
        expect(failedIcon!.getAttribute('class')).not.toEqual(icon!.getAttribute('class'));
        expect(icon!.getAttribute('class') ?? '').not.toContain('triangle');
    });

    it('the_unattributed_row_renders_and_is_excluded_from_the_people_tally', () => {
        // Spec §P-F: "The people tally counts named people only." A model
        // with 2 named people + 1 unattributed bucket must tally 2, not 3.
        const people = [
            makePerson({ operatorId: 'op-1', name: 'Rokade' }),
            makePerson({ operatorId: 'op-2', name: 'Jadhav' }),
        ];
        const unattributed = makePerson({
            operatorId: null,
            name: '',
            recordCount: 2,
            plotNames: ['Plot 1'],
        });
        const model = baseModel({
            people,
            unattributed,
            totalRecords: people[0].recordCount + people[1].recordCount + unattributed.recordCount,
            totalPlots: 4,
        });

        render(<WaitingDrawer {...baseProps({ model })} />);

        // Tally reads people.length (2), never people.length + 1.
        expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('2');
        expect(screen.getByTestId('waiting-drawer-tally-people')).not.toHaveTextContent('3');

        // The unattributed row itself still renders, separately, named अज्ञात.
        const unattributedRow = screen.getByTestId('waiting-drawer-unattributed-row');
        expect(unattributedRow).toBeInTheDocument();
        expect(unattributedRow).toHaveTextContent(oversightTranslations.mr.unknown);

        // Only 2 named person rows exist (op-1, op-2) — the unattributed
        // row is not a third "person" row.
        expect(screen.getByTestId('waiting-drawer-person-row-op-1')).toBeInTheDocument();
        expect(screen.getByTestId('waiting-drawer-person-row-op-2')).toBeInTheDocument();
        expect(screen.queryByTestId('waiting-drawer-person-row-op-3')).not.toBeInTheDocument();
    });

    it('a_failed_acknowledgement_shows_a_retry_affordance', () => {
        // Spec §P-D: "On failure ... a small, clear retry state appears."
        // `retryAffordance` graduated to founder-approved Marathi 2026-08-23
        // (oversightTranslations.ts header, "OVERSIGHT-LOOP STRING
        // GRADUATION") — `baseProps`'s default `language: 'mr'` now renders
        // the real mr copy, not the en fallback.
        const { rerender } = render(<WaitingDrawer {...baseProps({ status: 'idle' })} />);
        expect(screen.queryByTestId('waiting-drawer-seen-retry')).not.toBeInTheDocument();

        rerender(<WaitingDrawer {...baseProps({ status: 'failed' })} />);
        const retry = screen.getByTestId('waiting-drawer-seen-retry');
        expect(retry).toBeInTheDocument();
        expect(retry).toHaveTextContent(oversightTranslations.mr.retryAffordance);

        // The Seen button itself must stay clickable while failed (only
        // 'saving' disables it) so retrying is possible.
        expect(screen.getByTestId('waiting-drawer-seen-button')).not.toBeDisabled();
    });

    it('the_seen_button_is_disabled_only_while_saving', () => {
        const { rerender } = render(<WaitingDrawer {...baseProps({ status: 'saving' })} />);
        expect(screen.getByTestId('waiting-drawer-seen-button')).toBeDisabled();

        rerender(<WaitingDrawer {...baseProps({ status: 'idle' })} />);
        expect(screen.getByTestId('waiting-drawer-seen-button')).not.toBeDisabled();
    });

    it('zero_decisions_renders_no_decision_band', () => {
        // Spec: "the drawer holds only what is unresolved and actionable."
        render(<WaitingDrawer {...baseProps({ model: baseModel({ decisions: [] }) })} />);
        expect(screen.queryByTestId(/^waiting-drawer-decision-/)).not.toBeInTheDocument();
    });

    // TRIPWIRE, UPDATED — NOT DELETED, AND NOT LOOSENED.
    //
    // Three revisions, and the reason for each is why the assertions below
    // are shaped the way they are:
    //
    //   1. Originally it required the tail to be PRESENT and to carry the
    //      number.
    //   2. Commit `aacdd16c` inverted it to require the tail to be ABSENT,
    //      because the day count is measured from each record's CREATION
    //      time, not from when it reached the owner's phone
    //      (`oversightSelectors.ts`'s `effectiveArrivalISO()` is
    //      `meta.createdAtISO`), so a record written offline on Tuesday and
    //      synced on Friday is classified already-seen and never listed.
    //   3. THE FOUNDER OVERRULED THAT DELETION (2026-08-26): he wants the
    //      line back, softened — *"we can't be always true for this too"*.
    //
    // So the tripwire now guards the SOFTENING rather than the absence. The
    // regression it exists to catch is unchanged in spirit: a future edit
    // that re-states a CONFIDENT day count. That is why the approximation
    // word is asserted in the same breath as the number, and why the exact
    // form is asserted to appear ONLY when the model itself says the
    // boundary is exact — which `oversightSelectors.ts:316` never does today.
    //
    // Doctrine P4 — no fabricated numbers. A number the app cannot stand
    // behind may be shown as an approximation; it may never be shown as a
    // fact.
    it('never states how many days since the owner last looked — the boundary is approximate', () => {
        // The wording comes from the translations table, never a literal here,
        // so a tail re-added under a different testid is still measured
        // against the founder's own copy.
        const tailPrefixMr = oversightTranslations.mr.sinceLastLookedTail.split('{days}')[0].trim();
        const tailPrefixEn = oversightTranslations.en.sinceLastLookedTail.split('{days}')[0].trim();
        const approxMr = oversightTranslations.mr.approximately;
        const approxEn = oversightTranslations.en.approximately;

        const { rerender } = render(<WaitingDrawer {...baseProps({ model: baseModel({ sinceDays: 3 }) })} />);
        const tail = screen.getByTestId('waiting-drawer-since-tail');
        // The founder's sentence, his number, and the softening word — all three.
        expect(tail).toHaveTextContent(tailPrefixMr);
        expect(tail).toHaveTextContent('3');
        expect(tail).toHaveTextContent(approxMr);
        // THE REGRESSION THIS CATCHES: the approximation word immediately
        // PRECEDES the count. `अंदाजे` after the number, or anywhere else in
        // the sentence, is a different claim from the one the founder ruled on.
        expect(tail.textContent).toContain(`${approxMr} 3`);

        // ENGLISH CARRIES THE SAME SOFTENING. A tail that hedges in one
        // language and asserts in the other is the exact two-languages-one-key
        // defect `restState`'s English was reconciled for.
        rerender(<WaitingDrawer {...baseProps({ language: 'en', model: baseModel({ sinceDays: 12 }) })} />);
        const tailEn = screen.getByTestId('waiting-drawer-since-tail');
        expect(tailEn).toHaveTextContent(tailPrefixEn);
        expect(tailEn.textContent).toContain(`${approxEn} 12`);

        // THE ONLY WAY TO THE EXACT FORM is a model that says the boundary is
        // exact. `oversightSelectors.ts:316` hardcodes `true`, so nothing in
        // production reaches this branch today — it is asserted so the flag
        // has a proven meaning the day a server-received timestamp exists,
        // and so `boundaryApproximate` cannot quietly become decorative again.
        rerender(
            <WaitingDrawer
                {...baseProps({ language: 'en', model: baseModel({ sinceDays: 12, boundaryApproximate: false }) })}
            />,
        );
        const tailExact = screen.getByTestId('waiting-drawer-since-tail');
        expect(tailExact).toHaveTextContent('12');
        expect(tailExact.textContent).not.toContain(approxEn);

        // NO CHECKPOINT, NO TAIL. "0 days since you last looked" is a
        // fabricated number, and `अंदाजे` does not make a fabricated number
        // honest.
        rerender(<WaitingDrawer {...baseProps({ model: baseModel({ sinceDays: null }) })} />);
        expect(screen.queryByTestId('waiting-drawer-since-tail')).not.toBeInTheDocument();
    });
});
