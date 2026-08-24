/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop — §6, "No agent may invent farmer-facing
 * Marathi."
 *
 * The two strings that stand where the log-approval controls used to be.
 * They SHIPPED as category (c) in `oversightTranslations.ts`'s taxonomy:
 * `mr: ''`, English populated, read through a resolver. The founder ruled on
 * both on 2026-08-24 — see `approvalAvailabilityTranslations.ts`'s header,
 * "BOTH KEYS GRADUATE" — so `mr` is real text now and
 * `PENDING_FOUNDER_STRINGS` is empty.
 *
 * The old `no_marathi_is_invented_for_either_key` test said, in its own
 * words, that it was "what he must delete, deliberately, alongside the
 * `PENDING_FOUNDER_STRINGS` entry" if he supplied Marathi. He did; it is
 * deleted; and it is REPLACED by the stronger guard, not simply dropped —
 * a byte-pinning oracle, the same defence `oversightTranslations.test.ts`
 * adopted under finding F7(b):
 *
 *   EXPECTED_MR is typed `Record<keyof ApprovalAvailabilityTranslations,
 *   string>`, so a key declared without a pinned literal is a `tsc --noEmit`
 *   error, not a forgotten test. It is a second, hand-written copy of the
 *   founder's words — changing the module alone fails; changing both is a
 *   deliberate act with his copy in the diff, which is the whole point.
 *
 * The other properties are unchanged in intent:
 *
 *   a_resolved_string_is_never_a_blank_label
 *     — reading `translations.mr[key]` directly used to render "" (a blank
 *       label); and `i18n/translations.ts`'s own `t()` would fall back to
 *       the KEY, showing a farmer the literal text
 *       `approvalUnavailableTitle`. Neither is acceptable, which is why this
 *       module has its own resolver at all. The resolver's fallback branch
 *       is unexercised today; the property it guarantees is asserted over
 *       every key regardless.
 *
 *   the_pending_list_and_the_hollow_set_cannot_drift
 *     — a typo'd entry silently stops flagging a string for the founder, and
 *       a hollow key missing from the list silently stops asking him for it.
 */
import { describe, it, expect } from 'vitest';

import {
    approvalAvailabilityTranslations,
    resolveApprovalAvailabilityString,
    PENDING_FOUNDER_STRINGS,
    type ApprovalAvailabilityTranslations,
} from '../approvalAvailabilityTranslations';
import type { Language } from '../language';

const LANGUAGES: Language[] = ['en', 'mr'];

const KEYS = Object.keys(
    approvalAvailabilityTranslations.en,
) as (keyof ApprovalAvailabilityTranslations)[];

// THE ORACLE. One literal per key, for EVERY key — a missing entry is a
// `tsc` error, not an uncovered string. Hand-written as a second copy of the
// founder's 2026-08-24 message on purpose.
const EXPECTED_MR: Record<keyof ApprovalAvailabilityTranslations, string> = {
    // His own words, verbatim: the Latin-script `approval` is his deliberate
    // choice and his spelling is "आजून", not "अजून". Neither is to be
    // "fixed".
    approvalUnavailableTitle: 'approval आजून उपलब्ध नाहीये',
    // Coordinator-written, approved by him in the same message after he read
    // the previous English and called it too complicated.
    approvalUnavailableBody: 'इथे सगळं बघू शकता. approval नंतर देता येईल.',
};

// English is not founder-gated in general, but this pair is: he ruled the
// old body line ("Your approval cannot be recorded yet, so there is no
// approve button") too complicated and approved the replacement, so a
// regression to the old register is a regression against a ruling.
const EXPECTED_EN: Record<keyof ApprovalAvailabilityTranslations, string> = {
    approvalUnavailableTitle: 'Approving is not available yet',
    approvalUnavailableBody: 'You can see everything here. Approving will come later.',
};

describe('approvalAvailabilityTranslations', () => {
    it('every_marathi_value_is_byte_pinned_to_the_founders_message', () => {
        for (const key of KEYS) {
            expect(
                approvalAvailabilityTranslations.mr[key],
                `mr.${key} drifted from the founder's words — if this was intentional, he changed them and the oracle must be updated with them`,
            ).toBe(EXPECTED_MR[key]);
        }
    });

    it('the_oracle_and_the_module_declare_exactly_the_same_key_set', () => {
        expect(Object.keys(EXPECTED_MR).sort()).toEqual(Object.keys(approvalAvailabilityTranslations.mr).sort());
        expect(Object.keys(approvalAvailabilityTranslations.en).sort())
            .toEqual(Object.keys(approvalAvailabilityTranslations.mr).sort());
    });

    it('the_title_keeps_his_latin_approval_and_his_spelling_आजून', () => {
        // Both are the kind of thing a well-meant agent "corrects". The
        // Latin word is his chosen term for the control the farmer is
        // hunting for; the spelling is his.
        expect(approvalAvailabilityTranslations.mr.approvalUnavailableTitle).toContain('approval');
        expect(approvalAvailabilityTranslations.mr.approvalUnavailableTitle).toContain('आजून');
        expect(approvalAvailabilityTranslations.mr.approvalUnavailableTitle).not.toContain('अजून');
        // And the body echoes the same Latin term, so the two lines name the
        // same thing rather than teaching two words for it.
        expect(approvalAvailabilityTranslations.mr.approvalUnavailableBody).toContain('approval');
    });

    it('neither_line_promises_a_date_or_names_the_records_as_the_problem', () => {
        // `P4` — no claim about the future the repo cannot support. "नंतर"
        // is a sequence, not a schedule. And both lines name the state of
        // the FEATURE; the records' own (true) unverified state is a
        // separate sentence shown beside this notice.
        for (const language of LANGUAGES) {
            for (const key of KEYS) {
                const value = approvalAvailabilityTranslations[language][key];
                expect(value.toLowerCase()).not.toContain('soon');
                expect(value).not.toContain('लवकर');
            }
        }
    });

    it('a_resolved_string_is_never_a_blank_label', () => {
        for (const language of LANGUAGES) {
            for (const key of KEYS) {
                expect(resolveApprovalAvailabilityString(language, key)).not.toBe('');
            }
        }
    });

    it('marathi_no_longer_reads_through_to_english', () => {
        // The 2026-08-24 graduation, stated as behaviour rather than as
        // data: a Marathi farmer now gets Marathi from the resolver.
        for (const key of KEYS) {
            expect(resolveApprovalAvailabilityString('mr', key)).toBe(approvalAvailabilityTranslations.mr[key]);
            expect(resolveApprovalAvailabilityString('mr', key)).not.toBe(approvalAvailabilityTranslations.en[key]);
        }
    });

    it('the_pending_list_and_the_hollow_set_cannot_drift', () => {
        for (const key of PENDING_FOUNDER_STRINGS) {
            expect(KEYS).toContain(key);
        }
        // Everything hollow is listed, and nothing listed is populated —
        // the two halves cannot drift apart. Both are empty as of
        // 2026-08-24; this is what asserts that, rather than assuming it.
        const hollow = KEYS.filter((key) => approvalAvailabilityTranslations.mr[key] === '');
        expect([...PENDING_FOUNDER_STRINGS].sort()).toEqual(hollow.sort());
        expect(PENDING_FOUNDER_STRINGS).toHaveLength(0);
    });

    it('every_english_string_is_non_empty_and_matches_the_approved_wording', () => {
        for (const key of KEYS) {
            expect(approvalAvailabilityTranslations.en[key].length).toBeGreaterThan(0);
            expect(approvalAvailabilityTranslations.en[key]).toBe(EXPECTED_EN[key]);
        }
        expect(approvalAvailabilityTranslations.en.approvalUnavailableBody)
            .not.toContain('there is no approve button');
    });
});
