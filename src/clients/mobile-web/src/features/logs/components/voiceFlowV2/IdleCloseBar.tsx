/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10; amendment M4; design-fidelity pass F3) — the saved screen's bottom bar, drawn as the
 * approved design draws it (`.rbar2`, `.bigmic`, `.pb.rev`): the big round green mic on the left ("आणखी सांगा", the existing next
 * recording), and on the right "३० सेकंदात बंद होईल" with a draining amber bar, or "थांबवलं" while something holds the clock. The clock lives in THIS leaf (`useIdleClose`): the text changes
 * once a second and the bar moves by a CSS transition, so the screen above is never re-rendered by it.
 *
 * Founder 2026-11-26: the full-screen frame's footer (`V2Shell`), as the design draws it — no longer sticky inside the app's
 * page, so it needs no room above the app's bottom bar (the frame covers it). When the caller turns the close off (`offReason`),
 * no countdown is shown — only the mic.
 */
import React, { useEffect, type RefObject } from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { logger } from '../../../../infrastructure/observability/Logger';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { useResultStr } from '../voiceResult/resultStrings';
import { MicGlyph, SANS } from './savedBits';
import { useIdleClose } from './useIdleClose';
const SECONDS = 30;

export interface IdleCloseBarProps {
    rootRef: RefObject<HTMLElement | null>;
    /** Why the clock is held now ('clip', 'product', 'day'); null = not held by the screen. */
    pauseReason: string | null;
    /** Polled: an overlay is open (the app's back stack). */
    overlayOpen?: () => boolean;
    /** Why there is no auto-close at all; null = it closes itself. */
    offReason: string | null;
    onClose: () => void;
    onAddAnother: () => void;
}

export const IdleCloseBar: React.FC<IdleCloseBarProps> = ({ rootRef, pauseReason, overlayOpen, offReason, onClose, onAddAnother }) => {
    const RS = useResultStr();
    const W = voiceFlowWords(useOptionalLanguage()?.language);
    const off = offReason !== null;
    const { secondsLeft, paused } = useIdleClose({ seconds: SECONDS, pauseReason, overlayOpen, disabled: off, onClose, rootRef });
    useEffect(() => {
        if (offReason) logger.info('voice_v2.saved.auto_close_off', { component: 'SavedScreen', action: 'idle_close_off', reason: offReason });
    }, [offReason]);
    const share = paused ? 1 : Math.max(0, Math.min(1, secondsLeft / SECONDS));
    return (
        <div data-testid="vr2-idle-bar" data-state={off ? 'off' : paused ? 'paused' : 'running'}
            className="flex items-center gap-3 bg-white px-3.5 pb-3.5 pt-2.5" style={{ fontFamily: SANS }}>
            <button type="button" onClick={onAddAnother} data-testid="vr2-add-another" aria-label={RS.addAnother}
                className="flex flex-none flex-col items-center gap-[3px] active:scale-95">
                <span className="grid h-[58px] w-[58px] place-items-center rounded-full text-white shadow-[0_6px_16px_rgba(15,107,58,0.35)]"
                    style={{ background: 'radial-gradient(circle at 35% 30%,#3ccf78,#0F6B3A)' }}><MicGlyph size={26} /></span>
                <span className="whitespace-nowrap text-[11.5px] font-extrabold text-[#0F6B3A]" aria-hidden="true">{RS.addAnother}</span>
            </button>
            {!off && (
                <div className="min-w-0 flex-1" data-testid="vr2-idle-left">
                    <div className="text-[13px] font-extrabold text-[#1C1917]">{paused ? W.paused : W.closesIn(secondsLeft)}</div>
                    <div className="text-[11.5px] font-semibold text-[#5F6B63]">{paused ? W.pausedSub : W.closesSub}</div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-[5px] bg-[#DDE3DA]" aria-hidden="true">
                        <i className="block h-full bg-[#F59E0B] motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
                            style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default IdleCloseBar;
