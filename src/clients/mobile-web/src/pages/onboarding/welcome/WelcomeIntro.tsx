/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeIntro — the few seconds between login and the voice. Nobody should
 * have to find a play button: the screen comes alive (a light racing round the
 * whole screen edge, voice bars, a 3·2·1 ring), the greeting lands, and the
 * voice starts by itself. Meanwhile the audio is loading underneath, so the
 * countdown doubles as honest buffering: if the file is slow, the ring keeps
 * spinning with "सुरू होत आहे…" instead of starting into silence.
 */
import React from 'react';
import { Check } from 'lucide-react';

interface WelcomeIntroProps {
    /** 3, 2, 1 while counting; 0 once the count is done and we wait for audio. */
    count: number;
    /** 0..1 fill of the countdown ring. */
    progress: number;
    leaving: boolean;
    showOwnerLine: boolean;
    onSkip: () => void;
}

const RING = 2 * Math.PI * 46;

const WelcomeIntro: React.FC<WelcomeIntroProps> = ({ count, progress, leaving, showOwnerLine, onSkip }) => (
    <div className={`ws-intro${leaving ? ' leaving' : ''}`} data-testid="welcome-intro">
        <div className="ws-edge" aria-hidden="true"><i /></div>
        <div className="ws-intro-face">
            <div className="ws-intro-glow" aria-hidden="true" />
            <div className="ws-sparks" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
            </div>

            <div className="ws-intro-top">
                <span className="ws-intro-brand"><img src="/brand/logo-mark.webp" alt="" />श्रम सफल</span>
                <button type="button" className="ws-skip" data-testid="welcome-story-skip" onClick={onSkip}>वगळा</button>
            </div>

            <div className="ws-intro-greet">
                <span className="ws-intro-ok"><Check size={14} strokeWidth={3} /> लॉगिन यशस्वी</span>
                <h1 className="ws-intro-title">अभिनंदन!</h1>
                {showOwnerLine && <p className="ws-intro-sub">सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!</p>}
            </div>

            <div className="ws-intro-farmer">
                <img src="/brand/farmer-welcome.webp" alt="श्रम साथी" draggable={false} />
            </div>

            <div className="ws-intro-bottom">
                <div className="ws-intro-ring" aria-hidden="true">
                    <svg viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="46" className="track" />
                        <circle cx="50" cy="50" r="46" className="fill" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - progress) }} />
                    </svg>
                    <span key={count} className="ws-intro-count">{count > 0 ? count : <i className="ws-spinner" />}</span>
                    <span className="ws-intro-ripple" /><span className="ws-intro-ripple d2" />
                </div>
                <p className="ws-intro-msg" aria-live="polite">
                    {count > 0 ? 'श्रम सफलकडून तुमच्यासाठी एक संदेश' : 'संदेश सुरू होत आहे…'}
                </p>
                <div className="ws-intro-eq" aria-hidden="true">
                    {Array.from({ length: 22 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
                </div>
            </div>
        </div>
    </div>
);

export default WelcomeIntro;
