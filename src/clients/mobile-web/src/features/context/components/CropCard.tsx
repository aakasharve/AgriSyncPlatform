/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CropCard — one crop (or "entire farm") on the log home screen (PLR-D5, founder brief 2026-10-24).
 *
 * One card, two zones, one touch target:
 *   Zone A  the PHOTOGRAPH, about 65% of the card, with NOTHING on it: no text, no scrim, no button.
 *           A fixed height (so nothing jumps while it loads) and a crop-specific focal point.
 *   Zone B  a solid, pale panel directly under the photo: the crop name BIG and bold, its varieties
 *           smaller, and a small outlined finger-tap cue (a visual hint only — the WHOLE card is the button).
 * The name never sits over the photograph. Pressed = a gentle scale; keyboard focus = a clear ring.
 * Motion is limited to a soft entrance and a tiny tap-cue nudge, both `motion-safe`.
 */
import React from 'react';
import { Pointer, Sprout } from 'lucide-react';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface CropCardProps {
    testId: string;
    name: string;
    /** Varieties / plots, or the one-line meaning for the whole farm. */
    sub: string;
    /** Photo url; null falls back to a green field mark. */
    imageSrc: string | null;
    /** CSS object-position, e.g. "50% 30%": where the subject sits in the photo. */
    focus?: string;
    disabled?: boolean;
    /** Spans both columns when the grid is two-wide (an odd last card). */
    wide?: boolean;
    /** Entrance delay in ms (a soft stagger). */
    delay?: number;
    /** Photos below the first screen load lazily. */
    lazy?: boolean;
    onClick: () => void;
}

export const CropCard: React.FC<CropCardProps> = ({ testId, name, sub, imageSrc, focus, disabled, wide, delay = 0, lazy, onClick }) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-label={`${name} — ${sub}`}
        style={{ animationDelay: `${delay}ms`, fontFamily: SANS }}
        className={`group flex w-full flex-col overflow-hidden rounded-[22px] border border-emerald-100 bg-[#FBFDF9] text-left shadow-md transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400 disabled:opacity-60 motion-safe:animate-plr-rise ${wide ? 'min-[480px]:col-span-2' : ''}`}>
        {/* Zone A — the photograph, and nothing else */}
        <span className="relative block h-[140px] w-full overflow-hidden bg-emerald-50 [@media(max-height:720px)]:h-[108px] min-[480px]:h-[190px]" data-testid={`${testId}-photo`}>
            {imageSrc
                ? <img src={imageSrc} alt="" width={640} height={320} loading={lazy ? 'lazy' : 'eager'} decoding="async" draggable={false}
                    className="absolute inset-0 h-full w-full select-none object-cover" style={{ objectPosition: focus ?? '50% 50%' }} />
                : <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-emerald-200 to-lime-200 text-emerald-800"><Sprout size={44} strokeWidth={2} /></span>}
        </span>
        {/* Zone B — the name, the varieties and a quiet cue */}
        <span className="flex min-h-[88px] items-center gap-3 border-t border-emerald-100 bg-[#F3FBF5] px-4 py-3 min-[480px]:min-h-[132px]" data-testid={`${testId}-panel`}>
            <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block break-words text-[30px] font-extrabold leading-[1.3] text-emerald-950 min-[480px]:text-[28px]" data-testid={`${testId}-name`}>{name}</span>
                <span className="line-clamp-2 block break-words text-[16px] font-semibold leading-snug text-stone-700" data-testid={`${testId}-sub`}>{sub}</span>
            </span>
            <span aria-hidden="true" data-testid={`${testId}-cue`}
                className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 group-active:bg-emerald-100">
                <Pointer size={24} strokeWidth={1.75} className="motion-safe:animate-plr-tap" />
            </span>
        </span>
    </button>
);

export default CropCard;
