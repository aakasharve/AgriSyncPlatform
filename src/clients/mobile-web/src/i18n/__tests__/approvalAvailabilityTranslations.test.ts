/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop — §6, "No agent may invent farmer-facing
 * Marathi."
 *
 * The two strings that stand where the log-approval controls used to be.
 * They are category (c) in `oversightTranslations.ts`'s taxonomy: `mr: ''`,
 * English populated, read through a resolver.
 *
 * Three properties, each one a way this file has gone wrong before
 * elsewhere in the repo:
 *
 *   no_marathi_is_invented_for_either_key
 *     — a well-meant future agent filling `mr` with its own Devanagari is
 *       the exact failure spec §6 exists to stop (an invented string once
 *       shipped with the word order inverted and passed every test). If the
 *       FOUNDER supplies real Marathi, this test is what he must delete,
 *       deliberately, alongside the `PENDING_FOUNDER_STRINGS` entry.
 *
 *   an_empty_marathi_value_resolves_to_english_not_to_a_blank
 *     — reading `translations.mr[key]` directly renders "" (a blank label);
 *       and `i18n/translations.ts`'s own `t()` would fall back to the KEY,
 *       showing a farmer the literal text `approvalUnavailableTitle`.
 *       Neither is acceptable, which is why this module has its own
 *       resolver at all.
 *
 *   the_pending_list_names_only_real_keys
 *     — a typo'd entry silently stops flagging a string for the founder.
 */
import { describe, it, expect } from 'vitest';

import {
    approvalAvailabilityTranslations,
    resolveApprovalAvailabilityString,
    PENDING_FOUNDER_STRINGS,
    type ApprovalAvailabilityTranslations,
} from '../approvalAvailabilityTranslations';

const KEYS = Object.keys(
    approvalAvailabilityTranslations.en,
) as (keyof ApprovalAvailabilityTranslations)[];

describe('approvalAvailabilityTranslations', () => {
    it('no_marathi_is_invented_for_either_key', () => {
        for (const key of PENDING_FOUNDER_STRINGS) {
            expect(approvalAvailabilityTranslations.mr[key]).toBe('');
        }
    });

    it('an_empty_marathi_value_resolves_to_english_not_to_a_blank', () => {
        for (const key of KEYS) {
            const resolved = resolveApprovalAvailabilityString('mr', key);
            expect(resolved).not.toBe('');
            expect(resolved).toBe(approvalAvailabilityTranslations.en[key]);
        }
    });

    it('the_pending_list_names_only_real_keys', () => {
        for (const key of PENDING_FOUNDER_STRINGS) {
            expect(KEYS).toContain(key);
        }
        // Everything hollow is listed, and nothing listed is populated —
        // the two halves cannot drift apart.
        const hollow = KEYS.filter((key) => approvalAvailabilityTranslations.mr[key] === '');
        expect([...PENDING_FOUNDER_STRINGS].sort()).toEqual(hollow.sort());
    });

    it('every_english_string_is_non_empty', () => {
        for (const key of KEYS) {
            expect(approvalAvailabilityTranslations.en[key].length).toBeGreaterThan(0);
        }
    });
});
