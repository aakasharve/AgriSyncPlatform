/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A1; the founder's final design result-v12-final, 28 Nov) — the plot page
 * and the mic page are two pages, one swipe apart (the design's `.s1two`, `#s1plot` / `#s1mic`):
 *   - `MicPageBar`: on the plot page, once a place is chosen, the green bar "<place> — निवडले" / "वर सरका — बोलायला सुरुवात"; a tap
 *     opens the mic page. Inside the voice layer it is the layer's bottom bar (it never scrolls away), as the design pins it to the
 *     foot of the page.
 *   - `useSwipeUp`: one swipe up on the plot page opens the mic page too — only when the page has nothing more to scroll, so pushing
 *     a long plot list up never opens it by accident. A mouse drag and a wheel do the same on a computer (the design's own handlers).
 *   - `MicPage`: the mic page's frame: "प्लॉट बदला" (back to the plot page; hidden while he speaks) above what the caller draws (the
 *     recorder, whose card runs the 3 s countdown).
 * Owns no audio and no timer. The words are the design's, from `voiceFlowWords`.
 */
import React, { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { useVoiceLayerBottom } from '../voiceFlowV2/VoiceLayer';

const SANS = "'Noto Sans Devanagari', sans-serif";
/** A finger moved up this far (px) is a swipe up (the design's 40). */
export const SWIPE_UP_PX = 40;
/** A mouse dragged up this far (px), or a wheel turned this much, opens it too (the design's 50 / 25). */
export const MOUSE_DRAG_PX = 50;
export const WHEEL_PX = 25;

/** The design's `upin` (the bar comes up), `upbob` (its arrow nods up) and the mic page sliding up into place. */
const PAGE_CSS = '@keyframes vfUpIn{0%{transform:translateY(40px);opacity:0}100%{transform:none;opacity:1}}'
    + '@keyframes vfUpBob{50%{transform:translateY(-6px)}}'
    + '@keyframes vfMicUp{0%{transform:translateY(64px);opacity:0}100%{transform:none;opacity:1}}';

/** The design's up chevron. */
const UpChevron: React.FC<{ className?: string }> = ({ className }) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M6 15l6-6 6 6" />
    </svg>
);

/** The nearest ancestor that scrolls up and down, or null when nothing around the page scrolls. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
        const overflowY = window.getComputedStyle(n).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
}

/** Nothing more to scroll to below: a swipe up here cannot be a scroll. */
export function atScrollEnd(el: HTMLElement): boolean {
    const s = scrollerOf(el);
    return !s || s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
}

/** One swipe up (or a mouse drag up, or a wheel) on `ref` calls `onSwipe` once, while `enabled`. */
export function useSwipeUp(ref: RefObject<HTMLElement | null>, enabled: boolean, onSwipe: () => void): void {
    const latest = useRef(onSwipe);
    latest.current = onSwipe;
    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return undefined;
        let start: { y: number; atEnd: boolean } | null = null;
        let done = false;
        const fire = () => { if (done) return; done = true; start = null; latest.current(); };
        const begin = (y: number) => { start = { y, atEnd: atScrollEnd(el) }; };
        const move = (y: number, px: number) => { if (start?.atEnd && start.y - y > px) fire(); };
        const end = () => { start = null; };
        const touchStart = (e: TouchEvent) => { if (e.touches.length === 1) begin(e.touches[0].clientY); else end(); };
        const touchMove = (e: TouchEvent) => { if (e.touches.length === 1) move(e.touches[0].clientY, SWIPE_UP_PX); };
        const pointerDown = (e: PointerEvent) => { if (e.pointerType === 'mouse') begin(e.clientY); };
        const pointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse' && (e.buttons & 1) === 1) move(e.clientY, MOUSE_DRAG_PX); };
        const wheel = (e: WheelEvent) => { if (e.deltaY > WHEEL_PX && atScrollEnd(el)) fire(); };
        el.addEventListener('touchstart', touchStart, { passive: true });
        el.addEventListener('touchmove', touchMove, { passive: true });
        el.addEventListener('touchend', end, { passive: true });
        el.addEventListener('touchcancel', end, { passive: true });
        el.addEventListener('pointerdown', pointerDown);
        el.addEventListener('pointermove', pointerMove);
        el.addEventListener('pointerup', end);
        el.addEventListener('wheel', wheel, { passive: true });
        return () => {
            el.removeEventListener('touchstart', touchStart);
            el.removeEventListener('touchmove', touchMove);
            el.removeEventListener('touchend', end);
            el.removeEventListener('touchcancel', end);
            el.removeEventListener('pointerdown', pointerDown);
            el.removeEventListener('pointermove', pointerMove);
            el.removeEventListener('pointerup', end);
            el.removeEventListener('wheel', wheel);
        };
    }, [ref, enabled]);
}

export interface MicPageBarProps {
    /** "द्राक्ष · प्लॉट १" — the place he chose, in the screen's language. */
    placeOf: (language: string | undefined) => string | undefined;
    onOpen: () => void;
}

/** The plot page's green bar (the design's `.upbar`). */
export const MicPageBar: React.FC<MicPageBarProps> = ({ placeOf, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const w = voiceFlowWords(language);
    const place = placeOf(language) ?? '';
    const slot = useVoiceLayerBottom();
    const bar = (
        <div className="px-3.5 pt-2" data-testid="flow-mic-bar-room"
            style={{ fontFamily: SANS, paddingBottom: 'calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}>
            <style>{PAGE_CSS}</style>
            <button type="button" data-testid="flow-mic-bar" onClick={onOpen} aria-label={`${w.barChosen(place)}. ${w.barSwipe}`}
                className="flex min-h-[74px] w-full items-center gap-3 rounded-[22px] border-0 bg-[#0F6B3A] px-3.5 py-2.5 text-left text-white shadow-[0_10px_24px_rgba(15,107,58,0.3)] active:scale-[0.99] motion-safe:[animation:vfUpIn_.4s_cubic-bezier(.3,1.4,.5,1)_both]">
                <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full bg-white/[0.18] motion-safe:[animation:vfUpBob_1.2s_ease-in-out_infinite]">
                    <UpChevron className="h-7 w-7" />
                </span>
                <span className="min-w-0">
                    <b className="block text-[15.5px] font-extrabold leading-[1.3]" data-testid="flow-mic-bar-place">{w.barChosen(place)}</b>
                    <small className="block text-[15px] font-extrabold text-[#D1FAE5]">{w.barSwipe}</small>
                </span>
            </button>
        </div>
    );
    if (slot === undefined) return bar;
    return slot ? createPortal(bar, slot) : null;
};

export interface MicPageProps {
    /** He is speaking: "प्लॉट बदला" steps away (the recording screen is his). */
    recording: boolean;
    onChangePlot: () => void;
    children: React.ReactNode;
}

/** The mic page (the design's `#s1mic`): "प्लॉट बदला", then the recorder. It opens at its top. */
export const MicPage: React.FC<MicPageProps> = ({ recording, onChangePlot, children }) => {
    const w = voiceFlowWords(useOptionalLanguage()?.language);
    const top = useRef<HTMLDivElement>(null);
    useEffect(() => { top.current?.scrollIntoView?.({ block: 'start' }); }, []);
    return (
        <div ref={top} className="flex flex-col gap-2.5 pt-1 motion-safe:[animation:vfMicUp_.5s_cubic-bezier(.65,0,.25,1)_both]" style={{ fontFamily: SANS }} data-testid="flow-mic-page">
            <style>{PAGE_CSS}</style>
            {!recording && (
                // The chip is drawn 31 px tall as designed; the button around it is a 44 px finger target.
                <button type="button" data-testid="flow-change-plot" onClick={onChangePlot}
                    className="flex min-h-[44px] items-center justify-center self-center border-0 bg-transparent p-0 active:opacity-70">
                    <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-[#E5E7E1] bg-white px-3.5 py-1.5 text-[13.5px] font-extrabold text-[#44403C]">
                        <UpChevron className="h-4 w-4" />{w.changePlot}
                    </span>
                </button>
            )}
            {children}
        </div>
    );
};
