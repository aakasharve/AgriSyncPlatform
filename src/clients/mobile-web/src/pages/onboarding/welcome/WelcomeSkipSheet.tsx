/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Please listen" sheet. Asks once, says honestly how long is left, then lets
 * the farmer go. It never promises a "listen later" place — none exists yet
 * (doctrine P5: a truthful missing feature beats a fake working one).
 */
import React, { useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { skipSheetCopy } from './welcomeTimeline';

interface WelcomeSkipSheetProps {
    open: boolean;
    remainingSec: number;
    /** True once the voice has started playing. */
    started: boolean;
    onStay: () => void;
    onLeave: () => void;
}

const WelcomeSkipSheet: React.FC<WelcomeSkipSheetProps> = ({ open, remainingSec, started, onStay, onLeave }) => {
    const stayRef = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (open) stayRef.current?.focus(); }, [open]);
    if (!open) return null;
    const copy = skipSheetCopy(remainingSec, started && remainingSec > 0);
    return (
        <div className="ws-sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="ws-sheet-title">
            <button type="button" className="ws-sheet-scrim" aria-label="बंद करा" onClick={onStay} />
            <div className="ws-sheet">
                <img className="ws-sheet-peek" src="/brand/farmer-point.webp" alt="" draggable={false} />
                <div className="ws-sheet-grab" />
                <h3 id="ws-sheet-title">{copy.title}</h3>
                <p>{copy.body}</p>
                <span className="ws-sheet-left">{copy.left}</span>
                <button ref={stayRef} type="button" className="ws-cta" data-testid="welcome-skip-stay" onClick={onStay}>
                    <span className="ws-cta-pi"><Play size={15} fill="currentColor" /></span>
                    ठीक आहे, ऐकू या
                </button>
                <button type="button" className="ws-later" data-testid="welcome-skip-confirm" onClick={onLeave}>
                    आत्ता नको, पुढे चला
                </button>
            </div>
        </div>
    );
};

export default WelcomeSkipSheet;
