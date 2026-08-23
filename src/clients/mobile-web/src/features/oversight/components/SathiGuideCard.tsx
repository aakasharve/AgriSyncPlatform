/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3; Task 14; Task 15; Task 16; Task 17)
 *
 * SathiGuideCard — the centrepiece of the founder's reference image: a wide
 * card above the plot selector, soft green field gradient, carrying his own
 * greeting/headline/instruction copy (all in `oversightTranslations.ts`,
 * category (d) — see that file's header for the exact provenance of every
 * string rendered here).
 *
 * A REAL COMPONENT, not inlined into `mainView.tsx` — two independent
 * reasons: (1) `mainView.tsx`'s render functions are plain functions, not
 * components (`routeContext.ts` keeps them hook-free so the render cascade
 * can call them conditionally), so anything calling `useLanguage()` has to
 * be a real component in the tree; (2) `check:file-sizes`'s 800-line cap.
 *
 * HISTORY (compressed — see git blame for the full per-task rationale)
 * -----------------------------------------------------------------------
 * Task 13 shipped the card bottom-right, absolute-positioned. Task 14 moved
 * the character to the LEFT as a whole standing figure so his downward
 * point read as "pointing into the content below," not away from it. Task
 * 15 swapped in a new symmetric both-hands-pointing-down asset and
 * re-composed the card as text-on-top, character-full-width-beneath. Task
 * 16 reversed that again on founder ruling ("character is helper, not
 * hero"): headline promoted to the card's biggest text, character shrunk to
 * a small fixed-width accent beside the instruction lines.
 *
 * TASK 17 — THE FOUNDER'S FINISHED VISUAL, MATCHED EXACTLY
 * ------------------------------------------------------------------------
 * The founder supplied a finished reference image and asked to match it,
 * not iterate toward it. Three changes from Task 16, all sourced from that
 * image (`FINAL-log-screen-reference.png`), not from a fresh interpretation:
 *
 *   1. CHARACTER LEFT, LARGE, FULL HEIGHT — Task 16's "character is an
 *      accent" ruling is superseded by the founder's own finished layout:
 *      the character now sits FIRST in the row (screen LEFT), sized to
 *      roughly 40% of the card's width (measured off the reference image
 *      directly — his silhouette spans ~40-42% of the card's own width),
 *      and stretches the full height of the row (`self-stretch` on his
 *      column, `object-contain object-bottom` on the `<img>` itself so the
 *      source's true 1086:1448 ratio can never be squashed regardless of
 *      how tall the text column beside him makes the row). The text column
 *      is second (RIGHT), `flex-1`, occupying the remaining ~60%.
 *
 *   2. THE HILL — a green curved hill/field shape rises from the card's
 *      bottom-left in the reference, and the character stands on it. Built
 *      with inline SVG (`GuideCardHill`, `SathiGuideCardDecor.tsx`) — no
 *      new image asset, per the task brief. It sits behind the character
 *      image in the same relatively-positioned column.
 *
 *   3. THREE INSTRUCTION LINES, NOT TWO — `guideLine2` is a genuinely new
 *      key (you may pick more than one plot for the SAME task); the old
 *      `guideLine2` ("Entire Farm" caveat) is reworded by the founder and
 *      renumbered to `guideLine3`. Full transcription/provenance lives in
 *      `oversightTranslations.ts`'s own header, "TASK 17" section — this
 *      file only renders whatever that module resolves. Each line gets its
 *      own small circular outline icon on the left, matching the
 *      reference; line 1 stays visually strongest (unchanged founder
 *      ruling from Task 14), lines 2 and 3 are the quieter supporting
 *      detail — not flattened to identical weight with line 1, but equal
 *      to each other since neither outranks the other in the reference.
 *
 * The faint background leaf watermarks (task brief §3) live in the same
 * sibling file as the hill — `SathiGuideCardDecor.tsx` — split out
 * specifically so this file (which also carries the copy/layout logic and
 * a large chunk of provenance doc-comment) stays comfortably under the
 * 800-line cap rather than pushing right up against it.
 *
 * IMAGE WEIGHT — flagged, not silently shipped: the PNG is ~1.3MB
 * (1086×1448 source). `loading="lazy"` plus explicit `width`/`height` (the
 * source's real intrinsic pixels) avoid layout shift; optimising the asset
 * itself (WebP/compression) remains out of this task's scope.
 */
import React from 'react';
import { Leaf, Layers, Sprout, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { GuideCardHill, GuideCardLeafWatermarks } from './SathiGuideCardDecor';

// Same font-selection convention every oversight component uses (root
// CLAUDE.md Font Rules). The headline gets its OWN variant — Noto Serif
// Devanagari — because it is the largest, most decorative text on the
// screen, the same treatment `WelcomeScreen.tsx` gives "अभिनंदन!"; the body
// copy elsewhere in this feature stays sans (`CanonicalStrip.tsx`,
// `WaitingDrawer.tsx`, `OversightBriefingCard.tsx`).
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
// source of truth in `oversightTranslations.ts`.
const EMPHASIS_WORD: Record<'en' | 'mr', string> = { en: 'plot', mr: 'प्लॉटवर' };

// The three instruction rows, in the reference's own order. Icons are the
// closest semantic lucide-react match to the reference's own circular
// glyphs (a leaf, a layered/multiple mark, a sprouting plant) — no new
// dependency, `lucide-react` is already used throughout this card.
const GUIDE_LINES: ReadonlyArray<{ key: 'guideLine1' | 'guideLine2' | 'guideLine3'; Icon: LucideIcon }> = [
    { key: 'guideLine1', Icon: Leaf },
    { key: 'guideLine2', Icon: Layers },
    { key: 'guideLine3', Icon: Sprout },
];

const SathiGuideCard: React.FC = () => {
    const { language } = useLanguage();

    const greeting = resolveOversightString(language, 'guideGreeting');
    const headline = resolveOversightString(language, 'guideHeadline');

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
            className="relative mb-6 flex overflow-hidden rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-lime-50 to-emerald-100/70 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500"
        >
            <GuideCardLeafWatermarks />

            {/* Task 17, change 1 — character LEFT, ~40% of the card, full
                row height. `self-stretch` makes this column as tall as the
                text column beside it; `object-contain object-bottom` on the
                image inside it means the source's true 1086:1448 ratio is
                preserved no matter how tall that makes the column — it is
                sized DOWN to fit, never squashed. The inner box stops 14%
                short of the column's true bottom (change 2's hill sits
                BEHIND the whole column at `bottom-0`) so a visible strip of
                hill always shows under his feet — without that reserved
                strip, the character's own bottom-anchored image would cover
                the hill completely, since his silhouette already reaches
                almost to the frame's own edge. */}
            <div className="relative z-[1] w-[40%] shrink-0 self-stretch overflow-hidden">
                <GuideCardHill />
                <div className="absolute top-0 right-0 left-0 bottom-[14%] z-10 flex items-end justify-center">
                    <img
                        src="/images/sathi/sathi-points-down-both.png"
                        alt=""
                        loading="lazy"
                        width={1086}
                        height={1448}
                        className="h-full w-full object-contain object-bottom"
                    />
                </div>
            </div>

            {/* Task 17, change 1 — text column RIGHT, `flex-1` (~60%). */}
            <div className="relative z-[1] min-w-0 flex-1 py-5 pr-4 pl-2">
                <p
                    className="flex items-center gap-1.5 text-[13px] font-extrabold text-stone-800"
                    style={fontStyleFor(greeting)}
                >
                    {greeting}
                    <Leaf size={12} className="text-emerald-600" strokeWidth={2.5} />
                </p>

                {/* The hero of the card: bumped again in Task 17 — still the
                    largest text anywhere on this screen. */}
                <h2
                    className="mt-1.5 text-[26px] font-black leading-[1.12] text-stone-900 sm:text-[30px]"
                    style={headlineFontStyleFor(headline)}
                >
                    {headlineNode}
                </h2>

                <span aria-hidden="true" className="mt-2 block h-[3px] w-9 rounded-full bg-emerald-700/30" />

                {/* Task 17, change 3 — three instruction rows, each a small
                    circular outline icon beside the line, matching the
                    reference. Line 1 stays the visually strongest (Task
                    14's founder ruling, unchanged); lines 2 and 3 are equal
                    supporting detail, not flattened to line 1's weight. */}
                <ul className="mt-2.5 space-y-1.5">
                    {GUIDE_LINES.map(({ key, Icon }) => {
                        const text = resolveOversightString(language, key);
                        const isPrimary = key === 'guideLine1';
                        return (
                            <li key={key} className="flex items-start gap-2">
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-emerald-600 text-emerald-700"
                                >
                                    <Icon size={12} strokeWidth={2.25} />
                                </span>
                                <span
                                    className={
                                        isPrimary
                                            ? 'text-[12.5px] font-extrabold leading-snug text-stone-800'
                                            : 'text-[11px] font-medium leading-snug text-stone-600'
                                    }
                                    style={fontStyleFor(text)}
                                >
                                    {text}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

export default SathiGuideCard;
