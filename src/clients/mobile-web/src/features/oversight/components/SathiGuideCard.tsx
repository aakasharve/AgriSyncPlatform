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
 *   2. THE HILL — REMOVED in the founder's next review round (verbatim:
 *      "the hill has to go"). Task 17 originally built a green curved hill
 *      SVG (`GuideCardHill`) the character stood on; it is now deleted from
 *      `SathiGuideCardDecor.tsx` entirely, along with the reserved bottom
 *      strip that used to keep a sliver of it visible under his feet. The
 *      character column's own box now goes edge-to-edge again.
 *
 *      That same review round replaced it with the opposite instruction —
 *      the founder, on the screenshot: "his fingers should come out of that
 *      frame/component so that it would feel realistic." The character
 *      `<img>` is now pulled BELOW the column's (and the card's) own bottom
 *      edge by a fixed 20px (`h-[calc(100%+20px)]`), and the card switched from
 *      `overflow-hidden` to `overflow-visible` so that overflow can actually
 *      render instead of being clipped. 20px sits safely inside the card's
 *      own `mb-6` (24px) gap to the plot selector below, so the overflow is
 *      never able to visually cover — or, since it also carries
 *      `pointer-events-none`, ever able to intercept a tap on — the
 *      `प्लॉट निवडा` heading or the crop carousel beneath it. The leaf
 *      watermarks (unaffected by any of this) stay clipped to the card
 *      because `GuideCardLeafWatermarks` carries its own `overflow-hidden`
 *      on its own wrapper — independent of the card's own overflow setting.
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
import { GuideCardLeafWatermarks } from './SathiGuideCardDecor';

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
// FINDING F7(b) — EXPORTED so the relationship this constant depends on can
// be pinned by a test rather than assumed. The split is silent when it
// fails: `indexOf` returning -1 renders the headline unemphasised, which
// looks like a design choice, not a bug. A founder reword of `guideHeadline`
// that no longer contains this word would therefore remove the emerald
// emphasis with nothing failing anywhere. `the_emphasis_word_is_a_substring
// _of_the_founder_headline_in_every_language` is what now catches it.
export const EMPHASIS_WORD: Record<'en' | 'mr', string> = { en: 'plot', mr: 'प्लॉटवर' };

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
            // Founder review round (post-Task 17) — Fix 3: "separation of
            // uploaded image ... it seems overlapping" — `mt-4` gives the
            // card its own breathing room from the header block above (that
            // gap was 0px: `<main>` carries no top padding and this used to
            // be its first child edge-to-edge). Boundary bumped one standard
            // step in the app's own card language — `border-emerald-100` ->
            // `-200`, `shadow-sm` -> `shadow-md` — never a bespoke shadow
            // (see `CanonicalStrip.tsx`'s own header comment for why a
            // one-off shadow was already rejected once on this feature).
            // Fix 2 — `overflow-hidden` -> `overflow-visible` is what lets
            // the character's `<img>` below actually render past this box
            // instead of being clipped by it.
            className="relative mt-4 mb-6 flex overflow-visible rounded-[28px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-lime-50 to-emerald-100/70 shadow-md animate-in fade-in slide-in-from-top-4 duration-500"
        >
            <GuideCardLeafWatermarks />

            {/* Task 17, change 1 — character LEFT, ~40% of the card, full
                row height. `self-stretch` makes this column as tall as the
                text column beside it; `object-contain object-bottom` on the
                image means the source's true 1086:1448 ratio is preserved no
                matter how tall that makes the column — it is sized DOWN to
                fit, never squashed.

                Founder review round (post-Task 17), Fix 2 — the image's box
                is `top-0` with `h-[calc(100%+20px)]`: 20px TALLER than the
                column it sits in, anchored at the same top, so its bottom
                edge lands 20px past this column's (and the card's) bottom
                edge — his pointing hands break out of the frame, per the
                founder's own ask, rather than reading as pasted onto a flat
                panel. (Deliberately NOT `top-0 -bottom-5` with `h-full` —
                that combination is CSS-over-constrained for an absolutely
                positioned replaced element: the explicit `height` wins and
                `bottom` is silently ignored, which measured as ZERO
                overflow when first tried here.) `pointer-events-none` keeps
                the overflow strictly decorative: it can never sit on top of
                and swallow a tap meant for the plot-selector heading/
                carousel directly below (`#crop-selector-container` in
                `mainView.tsx`), and 20px stays safely inside this card's own
                `mb-6` (24px) gap to that section so the overflow never
                visually reaches it either. */}
            <div className="relative z-[1] w-[40%] shrink-0 self-stretch">
                <img
                    src="/images/sathi/sathi-points-down-both.png"
                    alt=""
                    loading="lazy"
                    width={1086}
                    height={1448}
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(100%+20px)] w-full object-contain object-bottom"
                />
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
