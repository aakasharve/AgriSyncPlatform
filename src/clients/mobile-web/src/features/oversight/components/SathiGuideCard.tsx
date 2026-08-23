/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3; Task 14, changes 1-2)
 *
 * SathiGuideCard — the centrepiece of the founder's reference image (`log
 * screen re design reference.png`): a wide card above the plot selector,
 * soft green field gradient, carrying his own greeting/headline/instruction
 * copy (all in `oversightTranslations.ts`, category (d) — see that file's
 * header).
 *
 * A REAL COMPONENT, not inlined into `mainView.tsx` — two independent
 * reasons: (1) `mainView.tsx`'s render functions are plain functions, not
 * components (`routeContext.ts` keeps them hook-free so the render cascade
 * can call them conditionally — see `mainViewComponents.tsx`'s own header
 * for this exact convention), so anything calling `useLanguage()` has to be
 * a real component in the tree; (2) `check:file-sizes`' 800-line cap —
 * `mainView.tsx` sat at 636 before this task.
 *
 * TASK 14, CHANGE 1 — CHARACTER MOVED LEFT, WHOLE FIGURE
 * ---------------------------------------------------------
 * Founder, on the built screen: "the position of character is misplaced,
 * that must be on left aside as his hands are directed at opposite
 * direction." Two fixes, not one:
 *
 *   1. Position — the character now sits FIRST in a flex row (screen
 *      LEFT), the text block second (right), reversing Task 13's
 *      absolute-bled-bottom-right placement.
 *
 *   2. Asset — `sathi-guide.png` (Task 13's default) is cropped at the
 *      waist; there is no plot-height at which it shows the WHOLE figure,
 *      which the founder now explicitly asks for ("use the WHOLE figure").
 *      `sathi-point-down.png` is the one asset in `/images/sathi/` that is
 *      a full standing figure, head to sandals, in the SAME 1086×1448
 *      frame — and his downward-pointing hand, placed on the LEFT of this
 *      card, points across and down at the plot-selector cards this card
 *      sits directly above (`mainView.tsx` renders `CropSelector`
 *      immediately after this component). That is the founder's own
 *      stated fix for the direction complaint ("that gesture points INTO
 *      the content"), and it is why the asset changes here, not just the
 *      side. `object-contain` inside a box matching the source's own
 *      1086:1448 ratio (`aspect-[1086/1448]`) means the box's own
 *      dimensions can never force a squash — the figure's true proportions
 *      are preserved regardless of the box size chosen for "a sensible
 *      card height".
 *
 * TASK 14, CHANGE 2 — LINE 1 OUTRANKS LINE 2
 * ---------------------------------------------
 * Founder ruling: keep BOTH instruction lines (do not cut the "संपूर्ण
 * शेत" caveat), but "एक किंवा अनेक प्लॉट निवडा" — the action — must read
 * as visually stronger than the caveat beneath it. `guideLine1` now carries
 * its own bolder/larger/darker treatment; `guideLine2` stays the quieter
 * second line. Same two translation keys as Task 13 — no copy changed,
 * only which one is louder.
 *
 * IMAGE WEIGHT — flagged, not silently shipped: both PNGs are ~1MB
 * (1086×1448 source). `loading="lazy"` plus explicit `width`/`height`
 * (the source's real intrinsic pixels, so the browser can reserve the
 * correct aspect ratio before the file loads — CSS controls the actual
 * rendered size) avoid layout shift, per the task-13 brief. Optimising the
 * asset itself (WebP/compression) is out of this task's scope and is
 * called out again in the task-13 report for a rural-bandwidth follow-up.
 */
import React from 'react';
import { Leaf } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { resolveOversightString } from '../../../i18n/oversightTranslations';

// Same font-selection convention every oversight component uses (root
// CLAUDE.md Font Rules). The headline gets its OWN variant — Noto Serif
// Devanagari — because it is, per the task brief, "the largest text on the
// screen": a hero/decorative headline, the same treatment `WelcomeScreen.tsx`
// gives its own "अभिनंदन!" headline, not the body-copy sans this feature
// otherwise uses everywhere (`CanonicalStrip.tsx`, `WaitingDrawer.tsx`,
// `OversightBriefingCard.tsx` — none of them declare a serif variant at all).
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const MARATHI_HEADING_FONT = { fontFamily: "'Noto Serif Devanagari', serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}
function headlineFontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_HEADING_FONT : ENGLISH_FONT;
}

// The founder's approved headline names the word he wants emerald-emphasised
// by using it verbatim inside the sentence itself ("...प्लॉटवर काम केलं?").
// Splitting on that substring at render time — rather than `guideHeadline`
// being three separate translation keys — keeps the FULL sentence the one
// source of truth in `oversightTranslations.ts`; there is no second place a
// future edit to the sentence could drift from its emphasis split.
const EMPHASIS_WORD: Record<'en' | 'mr', string> = { en: 'plot', mr: 'प्लॉटवर' };

const SathiGuideCard: React.FC = () => {
    const { language } = useLanguage();

    const greeting = resolveOversightString(language, 'guideGreeting');
    const headline = resolveOversightString(language, 'guideHeadline');
    const line1 = resolveOversightString(language, 'guideLine1');
    const line2 = resolveOversightString(language, 'guideLine2');

    const emphasisWord = EMPHASIS_WORD[language];
    const emphasisIdx = headline.indexOf(emphasisWord);
    const headlineNode: React.ReactNode = emphasisIdx === -1
        ? headline
        : (
            <>
                {headline.slice(0, emphasisIdx)}
                <span className="text-emerald-600">
                    {headline.slice(emphasisIdx, emphasisIdx + emphasisWord.length)}
                </span>
                {headline.slice(emphasisIdx + emphasisWord.length)}
            </>
        );

    return (
        <div
            data-testid="sathi-guide-card"
            className="relative mb-6 flex items-end overflow-hidden rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-lime-50 to-emerald-100/70 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500"
        >
            {/* Change 1 — LEFT, whole figure. `aspect-[1086/1448]` locks the
                box to the source's own ratio, so `h-*` alone decides the
                size and the figure can never be squashed. Bled flush to the
                card's left + bottom edges, same "bled" aesthetic Task 13
                gave the old bottom-right placement. */}
            <img
                src="/images/sathi/sathi-point-down.png"
                alt=""
                loading="lazy"
                width={1086}
                height={1448}
                className="h-[224px] w-auto shrink-0 aspect-[1086/1448] object-contain object-bottom sm:h-[248px]"
            />

            <div className="min-w-0 flex-1 py-5 pl-1 pr-5">
                <p
                    className="flex items-center gap-1.5 text-[14px] font-extrabold text-stone-800"
                    style={fontStyleFor(greeting)}
                >
                    {greeting}
                    <Leaf size={13} className="text-emerald-600" strokeWidth={2.5} />
                </p>

                <h2
                    className="mt-1.5 text-[21px] font-black leading-[1.2] text-stone-900 sm:text-[23px]"
                    style={headlineFontStyleFor(headline)}
                >
                    {headlineNode}
                </h2>

                <span aria-hidden="true" className="mt-2.5 block h-[3px] w-10 rounded-full bg-emerald-700/25" />

                <div className="mt-2.5 space-y-1.5">
                    {/* Change 2 — the action line outranks the caveat: larger,
                        bolder, darker. Same two keys as Task 13; only the
                        emphasis moved. */}
                    <p
                        className="text-[13.5px] font-extrabold leading-snug text-stone-800"
                        style={fontStyleFor(line1)}
                    >
                        {line1}
                    </p>
                    <p className="text-[11px] font-medium leading-snug text-stone-500" style={fontStyleFor(line2)}>
                        {line2}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SathiGuideCard;
