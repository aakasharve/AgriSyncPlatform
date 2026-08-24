// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * The founder supplied Marathi for both approval-unavailable strings on
 * 2026-08-24. Until then this component only ever rendered English (both
 * keys were `mr: ''`), so the two properties that only matter in Marathi had
 * never been exercised anywhere:
 *
 *   1. A Marathi farmer actually reads Marathi here — not the English
 *      fallback `resolveApprovalAvailabilityString()` used to return.
 *   2. Both of his lines are MIXED SCRIPT (they carry the Latin word
 *      `approval`, his deliberate choice), and this component picks a font
 *      from the text. Root CLAUDE.md forbids `system-ui`, `Arial` and bare
 *      generics for visible text, so the family must be the locked
 *      Devanagari body stack — which carries Latin glyphs too, so the word
 *      `approval` renders in that face rather than falling through.
 *
 * jsdom does no font loading, so what is provable HERE is the declared
 * `font-family`. Which physical face Chrome then used for the Latin run was
 * checked separately, in headless Chromium via
 * `CSS.getPlatformFontsForNode`; see the task report.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import ApprovalUnavailableNotice, {
    APPROVAL_UNAVAILABLE_NOTICE_TESTID,
} from '../ApprovalUnavailableNotice';
import { approvalAvailabilityTranslations } from '../../../i18n/approvalAvailabilityTranslations';

const MARATHI_BODY_FONT = "'Noto Sans Devanagari', sans-serif";
const ENGLISH_FONT = "'DM Sans', sans-serif";

afterEach(() => {
    cleanup();
});

describe('ApprovalUnavailableNotice — the founder\'s Marathi (2026-08-24)', () => {
    it('a_marathi_farmer_reads_marathi_not_the_english_fallback', () => {
        render(<ApprovalUnavailableNotice language="mr" />);

        const notice = screen.getByTestId(APPROVAL_UNAVAILABLE_NOTICE_TESTID);
        expect(notice).toHaveTextContent(approvalAvailabilityTranslations.mr.approvalUnavailableTitle);
        expect(notice).toHaveTextContent(approvalAvailabilityTranslations.mr.approvalUnavailableBody);
        expect(notice.textContent ?? '').not.toContain(
            approvalAvailabilityTranslations.en.approvalUnavailableBody,
        );
    });

    it('both_mixed_script_lines_render_in_the_locked_marathi_body_font', () => {
        // The failure this stops: a future edit that drops the explicit
        // `style` and lets the line inherit, or a string that stops carrying
        // Devanagari and silently flips `fontStyleFor` to DM Sans.
        render(<ApprovalUnavailableNotice language="mr" />);

        const title = screen.getByText(approvalAvailabilityTranslations.mr.approvalUnavailableTitle);
        const body = screen.getByText(approvalAvailabilityTranslations.mr.approvalUnavailableBody);

        expect(title).toHaveStyle({ fontFamily: MARATHI_BODY_FONT });
        expect(body).toHaveStyle({ fontFamily: MARATHI_BODY_FONT });
        // Never a generic or a system stack for visible text (root CLAUDE.md).
        for (const node of [title, body]) {
            const family = node.getAttribute('style') ?? '';
            expect(family).not.toContain('system-ui');
            expect(family).not.toContain('Arial');
        }
    });

    it('english_mode_still_uses_the_english_font', () => {
        // Control case — proves the font is chosen from the TEXT, not
        // hardcoded to Devanagari now that Marathi exists.
        render(<ApprovalUnavailableNotice language="en" />);

        const title = screen.getByText(approvalAvailabilityTranslations.en.approvalUnavailableTitle);
        expect(title).toHaveStyle({ fontFamily: ENGLISH_FONT });
    });
});
