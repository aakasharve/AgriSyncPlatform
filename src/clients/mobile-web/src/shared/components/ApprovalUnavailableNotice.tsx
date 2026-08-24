/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * The one notice that stands where a log-approval control used to be.
 *
 * WHY ONE COMPONENT FOR TWO CALLERS
 * ---------------------------------
 * Both `features/logs/components/ReviewInboxSheet.tsx` and
 * `features/analysis/components/ReviewInbox.tsx` lost their Approve
 * affordance for the SAME reason (see
 * `i18n/approvalAvailabilityTranslations.ts` for the full evidence trail:
 * `verify_log_v2` has no server handler). If the two surfaces carried their
 * own copies of this sentence they could drift, and the day one of them is
 * re-enabled the other would keep telling the owner approval is off — or,
 * far worse, the reverse. One component, one string pair, one truth.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a disabled button, and it is not a nag. `P5` asks for "disable
 * it or make it real"; a greyed-out tick with no words teaches a farmer the
 * app is broken, and a silent removal leaves him hunting for a control that
 * is not there. This is the third option: say what is true, once, in the
 * place the control used to occupy.
 *
 * COLOUR: stone/neutral, deliberately. Amber in this app means "this needs
 * you" and emerald means "approve" (spec §P-G, `ReviewInbox.tsx`'s own
 * approve button was `bg-emerald-600`). Neither is what this says — it
 * says "there is nothing here for you to do" — so it takes neither colour.
 *
 * FONTS: `font-family` is set explicitly per string, chosen from the text
 * itself. That mattered the day the founder supplied Marathi for both keys
 * (2026-08-24) — a CSS-inherited font would have rendered his Devanagari in
 * DM Sans. Both of his lines are MIXED SCRIPT: they carry the Latin word
 * `approval`, deliberately (see `i18n/approvalAvailabilityTranslations.ts`).
 * `fontStyleFor` therefore selects the Marathi body font for the whole
 * line, which is correct rather than a compromise — 'Noto Sans Devanagari'
 * carries Latin glyphs of its own, so the Latin word renders IN that face
 * and never falls through to a generic `sans-serif`. Verified with Chrome's
 * `CSS.getPlatformFontsForNode`, not assumed; pinned by
 * `__tests__/ApprovalUnavailableNotice.marathi.test.tsx`.
 */
import React from 'react';
import { Info } from 'lucide-react';

import type { Language } from '../../i18n/language';
import { resolveApprovalAvailabilityString } from '../../i18n/approvalAvailabilityTranslations';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

export interface ApprovalUnavailableNoticeProps {
    /** Drives both strings via `resolveApprovalAvailabilityString`. */
    language: Language;
    /** Optional extra classes for the caller's own spacing. */
    className?: string;
}

export const APPROVAL_UNAVAILABLE_NOTICE_TESTID = 'approval-unavailable-notice';

const ApprovalUnavailableNotice: React.FC<ApprovalUnavailableNoticeProps> = ({
    language,
    className = '',
}) => {
    const title = resolveApprovalAvailabilityString(language, 'approvalUnavailableTitle');
    const body = resolveApprovalAvailabilityString(language, 'approvalUnavailableBody');

    return (
        <div
            data-testid={APPROVAL_UNAVAILABLE_NOTICE_TESTID}
            className={`flex items-start gap-2.5 rounded-xl border border-stone-300 bg-stone-50 p-3 ${className}`}
        >
            <span className="mt-0.5 shrink-0 text-stone-500">
                <Info size={16} strokeWidth={2.25} />
            </span>
            <div className="min-w-0">
                <p
                    className="text-[13px] font-bold leading-snug text-stone-700"
                    style={fontStyleFor(title)}
                >
                    {title}
                </p>
                <p
                    className="mt-1 text-[12px] leading-relaxed text-stone-500"
                    style={fontStyleFor(body)}
                >
                    {body}
                </p>
            </div>
        </div>
    );
};

export default ApprovalUnavailableNotice;
