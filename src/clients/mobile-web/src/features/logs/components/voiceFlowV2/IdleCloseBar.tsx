/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10; amendment M4; design-fidelity pass F3) — the saved screen's bottom bar: the big round green mic
 * ("आणखी सांगा", the existing next recording), drawn as the approved design draws it (`.rbar2`, `.bigmic`).
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B6; the founder's final design, 28 Nov) — the screen's self-move:
 *   - it waits his READING TIME (`waitMs`: 3 s + 0.17 s a word of what is shown, 5 to 20 s, `readingTime.ts`), not a fixed 30 s;
 *   - that rule is not drawn on the phone (the design shows it only beside the phone: "Reading-time rule (shown here only)"), so the
 *     old "३० सेकंदात बंद होईल" line and its draining bar are gone; the bar keeps the mic;
 *   - when the wait runs out, a short note "आजच्या शेतीचा आढावा बघा" stays 2.4 s over the screen (the design's `.idlepop`), then
 *     `onClose` (the caller moves to पूर्ण शेतीचा आढावा).
 * The clock lives in THIS leaf (`useIdleClose`), so the screen above is never re-rendered by it. Its state is on the bar's `data-state`
 * (running / paused / moving / off). When the caller turns the move off (`offReason`), there is no move at all — only the mic.
 */
import React, { useEffect, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { logger } from '../../../../infrastructure/observability/Logger';
import { BOTTOM_BAR_CLEARANCE } from '../../../../shared/utils/bottomBar';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { useResultStr } from '../voiceResult/resultStrings';
import { MOVE_NOTE_MS } from './readingTime';
import { MicGlyph, SANS } from './savedBits';
import { useIdleClose } from './useIdleClose';
import { useVoiceLayerBottom } from './VoiceLayer';

const SERIF = "'Noto Serif Devanagari', serif";
const SATHI = '/images/sathi/sathi-points-down-both.png';
/** The design's `fade` and `spop` for the note. */
const NOTE_CSS = '@keyframes vfNoteFade{0%{opacity:0}100%{opacity:1}}@keyframes vfNotePop{0%{transform:scale(.7);opacity:0}100%{transform:none;opacity:1}}';

export interface IdleCloseBarProps {
    rootRef: RefObject<HTMLElement | null>;
    /** How long the screen waits untouched before it moves (his reading time, `readingTimeMs`). */
    waitMs: number;
    /** Why the clock is held now ('clip', 'product', 'day'); null = not held by the screen. */
    pauseReason: string | null;
    /** Polled: an overlay is open (the app's back stack). */
    overlayOpen?: () => boolean;
    /** Why there is no self-move at all; null = it moves by itself. */
    offReason: string | null;
    onClose: () => void;
    onAddAnother: () => void;
}

/** The design's `.idlepop`: Sathi and "आजच्या शेतीचा आढावा बघा", over the whole screen, just before the move. */
const MoveNote: React.FC = () => {
    const W = voiceFlowWords(useOptionalLanguage()?.language);
    if (typeof document === 'undefined') return null;
    return createPortal(
        <>
            <style>{NOTE_CSS}</style>
            <div data-testid="vr2-move-note" role="status" className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(250,250,247,0.78)] motion-safe:[animation:vfNoteFade_.25s_ease_both]"
                style={{ fontFamily: SANS }}>
                <div className="flex w-[280px] max-w-[86vw] flex-col items-center gap-2.5 rounded-[22px] border-2 border-[#9FD9B5] bg-white px-4 py-[18px] text-center shadow-[0_14px_34px_rgba(15,107,58,0.2)] motion-safe:[animation:vfNotePop_.4s_cubic-bezier(.3,1.6,.5,1)_both]">
                    <img src={SATHI} alt="" width={64} height={64} aria-hidden="true" className="h-16 w-16 rounded-full object-cover object-top" style={{ background: 'rgb(255,246,198)' }} />
                    <b className="text-[20px] font-bold leading-[1.35] text-[#1C1917]" style={{ fontFamily: SERIF }}>{W.movingToReview}</b>
                </div>
            </div>
        </>,
        document.body,
    );
};

export const IdleCloseBar: React.FC<IdleCloseBarProps> = ({ rootRef, waitMs, pauseReason, overlayOpen, offReason, onClose, onAddAnother }) => {
    const RS = useResultStr();
    const off = offReason !== null;
    const { paused, noting } = useIdleClose({ totalMs: waitMs, noteMs: MOVE_NOTE_MS, pauseReason, overlayOpen, disabled: off, onClose, rootRef });
    useEffect(() => {
        if (offReason) logger.info('voice_v2.saved.auto_close_off', { component: 'SavedScreen', action: 'idle_close_off', reason: offReason });
    }, [offReason]);
    // F3: inside the voice layer the bar is the layer's BOTTOM bar (outside the scrolling body, as in shots 07-12), never drawn
    // over the saved card. Outside a layer it keeps its sticky place in the page.
    const slot = useVoiceLayerBottom();
    const inLayer = slot !== undefined;
    const bar = (
        <div data-testid="vr2-idle-bar" data-state={off ? 'off' : noting ? 'moving' : paused ? 'paused' : 'running'} data-placed={inLayer ? 'bottom' : 'flow'}
            data-wait-ms={off ? undefined : waitMs}
            className={inLayer
                ? 'flex items-center gap-3 border-t border-[#DDE3DA] bg-white px-3.5 pt-2.5'
                : 'sticky z-20 -mx-4 mt-3 flex items-center gap-3 border-t border-[#DDE3DA] bg-white px-3.5 pb-3.5 pt-2.5'}
            style={inLayer
                ? { fontFamily: SANS, paddingBottom: 'calc(0.875rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }
                : { bottom: BOTTOM_BAR_CLEARANCE, fontFamily: SANS }}>
            <button type="button" onClick={onAddAnother} data-testid="vr2-add-another" aria-label={RS.addAnother}
                className="flex flex-none flex-col items-center gap-[3px] active:scale-95">
                <span className="grid h-[58px] w-[58px] place-items-center rounded-full text-white shadow-[0_6px_16px_rgba(15,107,58,0.35)]"
                    style={{ background: 'radial-gradient(circle at 35% 30%,#3ccf78,#0F6B3A)' }}><MicGlyph size={26} /></span>
                <span className="whitespace-nowrap text-[11.5px] font-extrabold text-[#0F6B3A]" aria-hidden="true">{RS.addAnother}</span>
            </button>
        </div>
    );
    return (
        <>
            {noting && !off && <MoveNote />}
            {!inLayer ? bar : slot ? createPortal(bar, slot) : null}
        </>
    );
};

export default IdleCloseBar;
