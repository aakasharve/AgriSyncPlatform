/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 5; Task 14, change 7)
 *
 * HelpBar — the small closing strip on the founder's reference image: a
 * circular Sathi avatar, "काही अडचण आहे का?" / "मी मदत करतो.", and an
 * emerald pill button "श्रम साथीशी बोला".
 *
 * TASK 14, CHANGE 7 — THE FACE DID NOT FIT
 * -------------------------------------------
 * Founder, on the built screen: "for help tab the face is not properly fit
 * there." Task 13's crop rendered the WHOLE `sathi-guide.png` image at
 * 142×190 (matching the source's own 1086:1448 ratio almost exactly, so
 * `object-cover` did no actual cropping/zooming at all) and only then
 * windowed a 44×44 circle out of its centre — the avatar showed a shrunken
 * slice of his whole upper body, not a face. This crops TIGHTER: the
 * rendered box is scaled up so the 44px circle only ever exposes roughly
 * the top ~39% of the source image (turban through the collar), which is
 * where the head actually sits, and drops the old vertical offset — the
 * window now starts flush at the image's own top edge instead of guessing
 * an 18px shift. Same asset, same `object-cover`, only the numbers change.
 *
 * THE BUTTON IS HONESTLY DISABLED — READ BEFORE RE-WIRING
 * ----------------------------------------------------------
 * The task brief: "Wire the button to the app's existing voice/assistant
 * entry point if one is reachable from this view; if it is not, render it
 * disabled with an honest state ... do not wire it to a no-op that looks
 * live." Checked, not assumed:
 *   - No dedicated "talk to Shram Sathi" chat/help screen exists anywhere
 *     in this codebase. `features/sathi/components/*` (SathiCard,
 *     SathiNudgeBanner, SathiQuickPickChips, SathiReadbackCard,
 *     SathiStepper) are all presentational pieces of the LOG WIZARD flow,
 *     not a help entry point.
 *   - `AppHeader.tsx`'s `onVoiceTrigger` prop exists but is never passed by
 *     any caller (`AppContent.tsx`, the real app shell, and
 *     `OversightAppPreview.tsx` both omit it) — it is dead code today, not
 *     a reachable trigger this component could hand off to.
 *   - `mainView.tsx`'s own voice toggle (`setMode('voice')`) starts a
 *     FARM-LOG recording, a different feature this button must not
 *     misrepresent as "help".
 * So the button renders with the native `disabled` attribute (no `onClick`
 * at all) — inert by construction, not merely styled to look inactive. See
 * the task-13 report for this same note handed to the founder.
 */
import React from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { resolveOversightString } from '../../../i18n/oversightTranslations';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

const HelpBar: React.FC = () => {
    const { language } = useLanguage();

    const title = resolveOversightString(language, 'helpTitle');
    const subtitle = resolveOversightString(language, 'helpSubtitle');
    const buttonLabel = resolveOversightString(language, 'helpButtonLabel');

    return (
        <div
            data-testid="help-bar"
            className="mb-4 mt-6 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-3"
        >
            {/* Head-and-shoulders crop (Task 14, change 7) — the rendered
                box (84×112) is deliberately far larger than the source's
                own ratio would need for a 44px circle, so `object-cover`
                zooms in: only the top ~39% of the 1448px-tall source is
                ever inside the circle (turban through the collar), flush
                with the image's own top edge (no vertical offset). Reads
                as a face in a circle, not a shrunken body. */}
            <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-white shadow-sm">
                <img
                    src="/images/sathi/sathi-guide.png"
                    alt=""
                    loading="lazy"
                    width={1086}
                    height={1448}
                    className="absolute left-1/2 top-0 h-[112px] w-[84px] -translate-x-1/2 object-cover"
                />
            </span>

            <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-extrabold text-stone-800" style={fontStyleFor(title)}>
                    {title}
                </p>
                <p className="truncate text-[11.5px] text-stone-500" style={fontStyleFor(subtitle)}>
                    {subtitle}
                </p>
            </div>

            <button
                type="button"
                disabled
                data-testid="help-bar-talk-button"
                title="Not wired yet — no reachable help/chat entry point exists in this app"
                className="shrink-0 cursor-not-allowed rounded-full bg-emerald-600 px-4 py-2.5 text-[12.5px] font-extrabold text-white opacity-50"
                style={fontStyleFor(buttonLabel)}
            >
                {buttonLabel}
            </button>
        </div>
    );
};

export default HelpBar;
