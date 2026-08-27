/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-25-prod-cutover-waves (founder ruling 2026-08-27)
 *
 * THE OVERSIGHT STRIP'S STATE RING — `CanonicalStrip`'s leading mark.
 * =================================================================
 * The founder read two stacked all-clears on `?preview=oversight&waiting=none`
 * — the strip's `restState`, and `DailyLoopHero`'s "आज सगळं सांगून झालं — काही
 * बाकी नाही" beside a 70% ring — and ruled: *"there are two line only keep
 * which is on the oversight bar and try to make it as asthetic as bottom line
 * the ring on that oversight tapp if you can make that possible make it."*
 *
 * This is that ring. It is `DailyLoopHero`'s SHELL — a 44px disc, a 4px band,
 * a white centre, the same visual weight — in the slot where the strip used to
 * carry a 28px glyph chip.
 *
 * WHAT IT DOES NOT CARRY IS THE POINT
 * -----------------------------------
 * The hero's band is a `conic-gradient`: a PROPORTION, filled to
 * `todayDayState.closurePercent`. The strip's subject is `waitingCount` — rows
 * the owner has not dealt with (`oversightSelectors.ts`) — which has no
 * denominator. There is therefore no honest arc to draw, and a part-filled
 * band beside "तुमच्यासाठी बाकी" would be a fabricated proportion (doctrine
 * `P4`) in the most prominent place on the home screen. The band is a SOLID
 * single colour in every state: a ring by SHAPE, never a gauge. Held by
 * `canonical_strip_ring_is_never_a_gauge` in
 * `features/oversight/__tests__/oneAllClearSurface.test.tsx`.
 *
 * WHAT IT DOES CARRY is `waitingCount` itself, the same prop the sentence
 * beside it is resolved from — one fact, one control, so the ring's number and
 * the strip's words cannot disagree the way the founder's two stacked lines
 * did. That is why the count LEFT the strip's right-hand pill rather than
 * being duplicated into the ring.
 *
 * COLOUR IS NOT THIS COMPONENT'S DECISION, it is `CanonicalStrip`'s §P-G rule
 * carried over unchanged: amber = "this needs you"; STONE for both non-claiming
 * states, because the green tick IS the completion claim to a farmer reading
 * colour before text and may not appear until the claim is true (finding
 * F7(a)); emerald only at rest. Only the mark changes between checking and
 * unknown — a spinner promises "about to resolve", so the question mark's
 * stillness is the whole point.
 *
 * Presentational only: props in, markup out. The four states arrive ALREADY
 * SELECTED by `CanonicalStrip`, never re-derived here — a second derivation is
 * how the two surfaces the founder saw came to disagree in the first place.
 */
import React from 'react';
import { CheckCircle2, Loader2, HelpCircle } from 'lucide-react';

const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

export interface StripStateRingProps {
    /**
     * `CanonicalStrip`'s own state selection, forwarded — never recomputed
     * here. Exactly one is true at a time; `exactly_one_mark_renders_in_the
     * _ring_in_every_state` walks the whole space and proves it.
     */
    isWaiting: boolean;
    isChecking: boolean;
    isUnknown: boolean;
    /**
     * `OversightModel.waitingCount`, the SAME prop `CanonicalStrip` resolves
     * its sentence from, printed verbatim when `isWaiting`. A literal here, or
     * any arithmetic on it, is the defect this ring exists to have foreclosed.
     */
    waitingCount: number;
}

const StripStateRing: React.FC<StripStateRingProps> = ({
    isWaiting,
    isChecking,
    isUnknown,
    waitingCount,
}) => (
    <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-1 ${
            isWaiting
                ? 'bg-amber-500'
                : (isChecking || isUnknown ? 'bg-stone-200' : 'bg-emerald-600')
        }`}
        // The strip's four original testids, on the same element as before, so
        // every state assertion in the suite still binds to the real selection.
        data-testid={
            isWaiting
                ? 'canonical-strip-waiting-icon'
                : (isChecking
                    ? 'canonical-strip-waiting-checking-icon'
                    : (isUnknown
                        ? 'canonical-strip-waiting-unknown-icon'
                        : 'canonical-strip-waiting-rest-tick'))
        }
    >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-white">
            {isWaiting && (
                // The prop verbatim. Root CLAUDE.md font rules: numerals are
                // DM Sans, never a Devanagari face and never a fallback.
                <span
                    data-testid="canonical-strip-waiting-count"
                    className="text-[15px] font-black leading-none text-amber-700"
                    style={ENGLISH_FONT}
                >
                    {waitingCount}
                </span>
            )}
            {!isWaiting && isChecking && <Loader2 size={16} strokeWidth={2.25} className="animate-spin text-stone-400" />}
            {!isWaiting && isUnknown && <HelpCircle size={17} strokeWidth={2.25} className="text-stone-400" />}
            {!isWaiting && !isChecking && !isUnknown && <CheckCircle2 size={18} strokeWidth={2.25} className="text-emerald-600" />}
        </span>
    </span>
);

export default StripStateRing;
