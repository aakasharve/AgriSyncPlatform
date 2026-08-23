/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3)
 *
 * SathiGuideCard — the centrepiece of the founder's reference image (`log
 * screen re design reference.png`): a wide card above the plot selector,
 * soft green field gradient, carrying his own greeting/headline/instruction
 * copy (all in `oversightTranslations.ts`, category (d) — see that file's
 * header) and the Sathi character bled to the card's bottom-right edge.
 *
 * A REAL COMPONENT, not inlined into `mainView.tsx` — two independent
 * reasons: (1) `mainView.tsx`'s render functions are plain functions, not
 * components (`routeContext.ts` keeps them hook-free so the render cascade
 * can call them conditionally — see `mainViewComponents.tsx`'s own header
 * for this exact convention), so anything calling `useLanguage()` has to be
 * a real component in the tree; (2) `check:file-sizes`' 800-line cap —
 * `mainView.tsx` sat at 636 before this task.
 *
 * `sathi-guide.png` (~1MB, per the task brief) is the default asset — his
 * open-hand/thumbs-up gesture composes naturally beside this card's own
 * text. The second asset, `sathi-point-down.png`, points at a green arrow
 * below him; this card has no such arrow to point at, so it does not apply
 * here (the founder's brief names it optional, "use it only if it composes
 * better").
 *
 * IMAGE WEIGHT — flagged, not silently shipped: both PNGs are ~1MB
 * (1086×1448 source). `loading="lazy"` plus explicit `width`/`height`
 * (the source's real intrinsic pixels, so the browser can reserve the
 * correct aspect ratio before the file loads — CSS controls the actual
 * rendered size) avoid layout shift, per the task brief. Optimising the
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
            className="relative mb-6 overflow-hidden rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-lime-50 to-emerald-100/70 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500"
        >
            <div className="relative z-10 min-h-[248px] py-5 pl-5 pr-[150px]">
                <p
                    className="flex items-center gap-1.5 text-[15px] font-extrabold text-stone-800"
                    style={fontStyleFor(greeting)}
                >
                    {greeting}
                    <Leaf size={14} className="text-emerald-600" strokeWidth={2.5} />
                </p>

                <h2
                    className="mt-2 text-[25px] font-black leading-[1.18] text-stone-900"
                    style={headlineFontStyleFor(headline)}
                >
                    {headlineNode}
                </h2>

                <span aria-hidden="true" className="mt-3 block h-[3px] w-10 rounded-full bg-emerald-700/25" />

                <div className="mt-3 space-y-1.5">
                    <p className="text-[12.5px] leading-snug text-stone-700" style={fontStyleFor(line1)}>
                        {line1}
                    </p>
                    <p className="text-[12.5px] leading-snug text-stone-700" style={fontStyleFor(line2)}>
                        {line2}
                    </p>
                </div>
            </div>

            {/* Decorative — bled to the card's bottom-right edge per the
                reference. Adds nothing a screen reader needs beyond the
                greeting/headline text above, so `alt=""`. */}
            <img
                src="/images/sathi/sathi-guide.png"
                alt=""
                loading="lazy"
                width={1086}
                height={1448}
                className="pointer-events-none absolute bottom-0 right-1 h-[196px] w-auto object-contain object-bottom sm:h-[220px]"
            />
        </div>
    );
};

export default SathiGuideCard;
