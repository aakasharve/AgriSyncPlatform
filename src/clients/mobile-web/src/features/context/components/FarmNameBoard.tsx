/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmNameBoard — the farmer's own nameboard, top of every screen.
 *
 * spec: founder ruling 2026-08-30 (design approved from
 * `G:\VALIDATION\HOome_Screen Redesign\variation-2.html`)
 *
 * WHAT THIS REPLACES, AND WHY
 * ---------------------------
 * Row 1 used to carry six things: the profile avatar, the operator's first
 * name, the farm chip with its plot count, the Shram Safal lockup, the weather
 * chip and the voice trigger. The founder read it as "messy", and the specific
 * defect he named was that the avatar's label rendered
 * `activeOperator.name.split(' ')[0]` — the FARMER's name — sitting 40px from
 * the FARM's name. The same word twice, meaning two different things.
 *
 * His ruling: the farm name becomes the hero, on a board he owns. The plot
 * count and the owner name are gone from this row entirely (both are still
 * reachable — plots in the farm switcher, the owner in the Setup Hub). The
 * avatar keeps its job but is now labelled `सेट-अप केंद्र`, the app's own name
 * for the surface it opens, instead of repeating the farmer at himself.
 *
 * WHY FOUR NESTED LAYERS
 * ----------------------
 * A CSS border cannot follow a clipped edge — it only follows a radius. The
 * approved shape is a CHAMFER (corners cut at 45deg), so the brass frame and
 * the inner rule are LAYERS, not strokes:
 *
 *   .board (brass)  →  .face (green)  →  .rule (brass 55%)  →  .inner (green)
 *
 * Each layer carries the same polygon on its own box, one pixel smaller than
 * the last. The corner is a fixed px value, never a percentage, so the
 * silhouette is identical at 320px and at 420px — the founder asked for that
 * explicitly and a percentage-based clip would have failed it silently.
 *
 * THE NAME IS FITTED, NEVER CLIPPED
 * ---------------------------------
 * `useFitText` steps the type down from 25px until the name fits one line, and
 * WRAPS rather than truncating if it still will not. An ellipsis here would
 * hide part of who the farmer is, which is the opposite of what a nameboard is
 * for — the same reasoning `CanonicalStrip` uses for its own subtitle. A
 * 48-character formal name lands at ~12px on two lines; that is the honest
 * floor, and it is why the plot count and owner name had to leave this row.
 */
import React from 'react';
import type { Language } from '../../../i18n/language';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_HEAD_FONT = { fontFamily: "'Noto Serif Devanagari', serif" } as const;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

/** Headings take the serif, body text the sans — the project font rule. */
function headFontFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_HEAD_FONT : ENGLISH_FONT;
}
function bodyFontFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

/** Approved corner: chamfer, 11px. One number drives all four layers. */
const CORNER = 11;
const chamfer = (v: number): string => {
    const p = `${v}px`;
    return `polygon(${p} 0, calc(100% - ${p}) 0, 100% ${p}, 100% calc(100% - ${p}), `
        + `calc(100% - ${p}) 100%, ${p} 100%, 0 calc(100% - ${p}), 0 ${p})`;
};

const MAX_NAME_PX = 25;
const MIN_NAME_PX = 12;

/**
 * Steps the font size down until the text fits on one line, then allows a wrap
 * as the last resort.
 *
 * MEASURES THE ROW, NOT A SLOT. The name used to live in a `flex-1` slot and
 * centre itself inside it, which left a short name floating a long way from the
 * shield — the founder read "Arve Farm" and said the mark felt disconnected from
 * it. The mark and the name are now ONE centred group, so the group's width
 * follows the name and the gap between them never grows.
 *
 * That makes the available width a computed quantity rather than a measurable
 * one: the group no longer fills the row, so the row is what has to be measured
 * and the mark's own width subtracted from it.
 *
 * Re-runs when the name, the row width or the webfonts change — Devanagari
 * metrics shift once Noto loads, and a fit measured against the fallback face
 * would be wrong by several pixels.
 */
function useFitText(
    rowRef: React.RefObject<HTMLElement | null>,
    markRef: React.RefObject<HTMLElement | null>,
    textRef: React.RefObject<HTMLElement | null>,
    text: string,
): void {
    React.useLayoutEffect(() => {
        const row = rowRef.current;
        const el = textRef.current;
        if (!row || !el) return;

        const fit = () => {
            const style = window.getComputedStyle(row);
            const padding = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
            const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
            const mark = markRef.current?.offsetWidth ?? 0;
            const available = row.clientWidth - padding - mark - gap - 2;
            if (available <= 0) return;
            el.style.whiteSpace = 'nowrap';
            el.style.display = 'inline-block';
            let size = MAX_NAME_PX;
            el.style.fontSize = `${size}px`;
            while (size > MIN_NAME_PX && el.scrollWidth > available) {
                size -= 0.5;
                el.style.fontSize = `${size}px`;
            }
            if (el.scrollWidth > available) {
                el.style.whiteSpace = 'normal';
                el.style.display = 'block';
            }
        };

        fit();

        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
        ro?.observe(row);
        // Devanagari metrics change when Noto lands; refit rather than ship a
        // size measured against the fallback face.
        const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
        void fonts?.ready.then(fit);
        return () => ro?.disconnect();
    }, [rowRef, markRef, textRef, text]);
}

export interface FarmNameBoardProps {
    /** The farm's own name — the only identity on this board. */
    farmName: string;
    /** Opens the farm switcher. The WHOLE board is the control: the founder
     *  removed the chevron, so there is no separate affordance to miss. */
    onOpenFarmSwitcher: () => void;
    /** Reserved for future per-language copy; the subtitle below is a proper
     *  noun plus one English verb and does not vary by language today. */
    language?: Language;
    /** Set false to drop the subtitle line (founder may still rule on it). */
    showSubtitle?: boolean;
    disabled?: boolean;
    /** TRUE only when the account actually holds more than one farm.
     *
     *  Task 12 established that a single-farm account renders NO farm-switcher
     *  control — offering to switch between one thing is a control that cannot
     *  do anything. The nameboard made that easy to lose, because the founder
     *  removed the chevron and made the WHOLE board the target: without this
     *  flag every farmer would get a tappable board opening a sheet with one
     *  row in it. So the board renders as plain, non-interactive identity when
     *  this is false, and only becomes a button when there is a second farm to
     *  reach. */
    canSwitch?: boolean;
}

/**
 * The subtitle names the tool, it does not award a credential. An earlier
 * draft read "Shram Safal Registered Farm"; there is no farm-registration
 * feature anywhere in this codebase, so that sentence would have asserted a
 * status the product does not issue. "Managed by" is true of the records and
 * claims nothing the app cannot back.
 */
const SUBTITLE = 'Managed by Shram Safal';

const FarmNameBoard: React.FC<FarmNameBoardProps> = ({
    farmName,
    onOpenFarmSwitcher,
    showSubtitle = true,
    disabled = false,
    canSwitch = false,
}) => {
    const rowRef = React.useRef<HTMLSpanElement>(null);
    const markRef = React.useRef<HTMLSpanElement>(null);
    const nameRef = React.useRef<HTMLSpanElement>(null);
    useFitText(rowRef, markRef, nameRef, farmName);

    // See `canSwitch`. A one-farm account gets identity, not a control — and
    // it must not be a `<button>` either, or a screen reader announces a
    // control that does nothing when activated.
    const Tag = (canSwitch ? 'button' : 'div') as 'button' | 'div';
    const controlProps = canSwitch
        ? { type: 'button' as const, onClick: onOpenFarmSwitcher, disabled, 'aria-label': farmName }
        : {};

    return (
        <Tag
            {...controlProps}
            data-testid="farm-nameboard"
            data-can-switch={canSwitch ? 'true' : 'false'}
            className="min-w-0 flex-1 text-left"
        >
            {/* layer 1 — the brass frame */}
            <span
                className="relative block p-[2.5px]"
                style={{
                    background: '#D9B45B',
                    clipPath: chamfer(CORNER),
                    boxShadow: '0 4px 12px rgba(10,45,25,.38)',
                }}
            >
                {/* Four nails, each at its own angle. Aligned nails read as
                    manufactured hardware; the founder rejected that once
                    already when the brass rivets went. 5.5px on his note. */}
                {[
                    { k: 'tl', s: { top: 9, left: 10, transform: 'rotate(-12deg)' } },
                    { k: 'tr', s: { top: 10, right: 9, transform: 'rotate(8deg)' } },
                    { k: 'bl', s: { bottom: 10, left: 9, transform: 'rotate(6deg)' } },
                    { k: 'br', s: { bottom: 9, right: 10, transform: 'rotate(-10deg)' } },
                ].map(({ k, s }) => (
                    <span
                        key={k}
                        aria-hidden="true"
                        className="absolute z-[3] rounded-full"
                        style={{
                            width: 5.5,
                            height: 5.5,
                            background: 'radial-gradient(circle at 34% 28%, #F0DCA4, #D9B45B 50%, #A8842F)',
                            boxShadow: '0 1px 1.5px rgba(0,0,0,.5)',
                            ...s,
                        }}
                    />
                ))}

                {/* layer 2 — green, then layer 3 — the inner brass rule */}
                <span
                    className="block p-[2.5px]"
                    style={{
                        background: 'linear-gradient(180deg,#17603F 0%,#14532D 48%,#0F3D22 100%)',
                        clipPath: chamfer(CORNER - 1),
                    }}
                >
                    <span
                        className="block p-px"
                        style={{ background: 'rgba(217,180,91,.55)', clipPath: chamfer(CORNER - 2) }}
                    >
                        {/* layer 4 — the face the content sits on */}
                        <span
                            ref={rowRef}
                            // justify-CENTER, not a flex-1 name slot: the mark and
                            // the name travel together as one group, so the space
                            // between them is fixed by `gap` and cannot open up
                            // when the name is short.
                            className="relative flex items-center justify-center gap-2 px-3 py-[7px]"
                            style={{
                                background: 'linear-gradient(180deg,#17603F 0%,#14532D 48%,#0F3D22 100%)',
                                clipPath: chamfer(CORNER - 3),
                            }}
                        >
                            {/* THE SHIELD NEEDS ITS OWN GROUND.
                                `logo-mark.webp` is a GREEN shield with a dark
                                green outline. Placed straight onto this board
                                it was green-on-green: the outline vanished into
                                the gradient and the farmer saw a smudge where
                                the mark should be. The founder caught it on the
                                built screen.
                                So the mark sits on a cream disc with a brass
                                ring — the same treatment the reference image
                                used, and the same two colours already framing
                                the board, so nothing new enters the palette.
                                The disc is what makes the logo legible; it is
                                not decoration and must not be dropped. */}
                            <span
                                ref={markRef}
                                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full"
                                style={{
                                    background: '#FBF5EC',
                                    boxShadow: '0 0 0 1.5px #D9B45B, 0 1px 3px rgba(4,24,12,.45)',
                                }}
                            >
                                <img
                                    src="/brand/logo-mark.webp"
                                    alt=""
                                    aria-hidden="true"
                                    width={25}
                                    height={25}
                                    loading="eager"
                                    className="h-[25px] w-[25px] object-contain"
                                />
                            </span>
                            <span className="flex min-w-0 flex-col items-center justify-center">
                                <span className="flex items-center justify-center">
                                    <span
                                        ref={nameRef}
                                        data-testid="farm-nameboard-name"
                                        className="inline-block whitespace-nowrap text-center font-extrabold leading-[1.14] tracking-[-0.005em]"
                                        style={{
                                            color: '#F2E9DB',
                                            textShadow: '0 1px 0 rgba(4,24,12,.55)',
                                            ...headFontFor(farmName),
                                        }}
                                    >
                                        {farmName}
                                    </span>
                                </span>
                                {showSubtitle && (
                                    <span className="mt-0.5 flex max-w-full items-center gap-1.5">
                                        <i
                                            aria-hidden="true"
                                            className="h-px w-4 shrink-0"
                                            style={{ background: 'linear-gradient(90deg,rgba(217,180,91,0),#D9B45B)' }}
                                        />
                                        <span
                                            data-testid="farm-nameboard-subtitle"
                                            className="truncate text-[8px] font-semibold tracking-[0.04em]"
                                            style={{ color: '#E4D3A6', ...bodyFontFor(SUBTITLE) }}
                                        >
                                            {SUBTITLE}
                                        </span>
                                        <i
                                            aria-hidden="true"
                                            className="h-px w-4 shrink-0"
                                            style={{ background: 'linear-gradient(90deg,#D9B45B,rgba(217,180,91,0))' }}
                                        />
                                    </span>
                                )}
                            </span>
                        </span>
                    </span>
                </span>
            </span>
        </Tag>
    );
};

export default FarmNameBoard;
