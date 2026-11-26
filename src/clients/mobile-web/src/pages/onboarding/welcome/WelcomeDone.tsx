/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shown after the farmer has listened to the whole welcome note: thank them,
 * restate the one daily habit (did · spent · left), and hand over to the app.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import DailyThread from './DailyThread';
import './welcomeStory.css';

interface WelcomeDoneProps {
    onContinue: () => void;
    onReplay: () => void;
}

const WelcomeDone: React.FC<WelcomeDoneProps> = ({ onContinue, onReplay }) => (
    <div className="ws-root ws-done" lang="mr" data-testid="welcome-done">
        <div className="ws-sky" style={{ background: 'linear-gradient(180deg,#ECFDF5 0%,#FBFEFC 40%,#FFFFFF 58%,#EFFAF3 100%)' }} />
        <div className="ws-done-head">
            <h1 className="ws-intro-title">धन्यवाद!</h1>
            <p className="ws-intro-sub">मनापासून ऐकल्याबद्दल आभार. आता एकत्र सुरुवात करूया.</p>
        </div>
        <div className="ws-done-farmer"><img src="/brand/farmer-point.webp" alt="श्रम साथी" draggable={false} /></div>
        <div className="ws-done-foot">
            <DailyThread />
            <button type="button" className="ws-cta" data-testid="welcome-continue" onClick={onContinue}>
                चला, सुरुवात करूया <ChevronRight size={20} />
            </button>
            <button type="button" className="ws-later" onClick={onReplay}>संदेश पुन्हा ऐका</button>
        </div>
    </div>
);

export default WelcomeDone;
