/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The welcome story's picture track. Each scene starts on a phrase; every
 * moving part inside it is keyed to the exact spoken word with `cue(line, word)`
 * (line and word positions in welcomeNoteScript.ts). If the note is re-recorded
 * and re-phrased, the cue positions here are the only thing to re-check — the
 * `welcomeStory.test.ts` suite fails if any cue points at a missing word.
 */
import React from 'react';
import { cue } from './welcomeTimeline';
import {
    ApprovalFlow, AskBubble, BrandSeal, Confetti, CorrectionLedger, Farmer, FloatingLeaves,
    GrowthRow, HabitStreak, HandWithSprout, LoopArrows, MemoryBubbles, OrganiseSlips, Pillars,
    PlanBadges, PlotQuestions, PriceLine, RainCloud, SeasonWheel, Sunrise, ThinkDots, Together,
    TroubleCluster, TrustShield, VoiceMic,
} from './welcomeSceneArt';

export interface StoryScene {
    /** Phrase index this scene opens on. */
    line: number;
    art: () => React.ReactNode;
}

export const STORY_SCENES: readonly StoryScene[] = [
    // स्वागत
    {
        line: 0,
        art: () => (
            <div className="ws-center">
                <FloatingLeaves />
                <Farmer pose="welcome" />
                <Confetti at={cue(3, 1)} />
            </div>
        ),
    },
    // एक विचार करा
    { line: 4, art: () => <div className="ws-center"><Farmer pose="point" /><ThinkDots at={cue(4, 1)} /></div> },
    { line: 5, art: () => <div className="ws-center"><SeasonWheel sproutAt={cue(6, 2)} ringsAt={cue(7, 3)} /></div> },
    { line: 8, art: () => <div className="ws-center"><LoopArrows fastAt={cue(10, 0)} /></div> },
    {
        line: 11,
        art: () => <TroubleCluster clockAt={cue(11, 2)} costAt={cue(12, 1)} pendingAt={cue(13, 7)} fogAt={cue(14, 1)} />,
    },
    { line: 15, art: () => <div className="ws-center"><BrandSeal burstAt={cue(15, 5)} /></div> },
    // आपल्या हातात काय आहे
    {
        line: 16,
        art: () => (
            <div className="ws-pair">
                <RainCloud at={cue(16, 1)} greyAt={cue(16, 4)} />
                <PriceLine at={cue(17, 0)} greyAt={cue(18, 2)} />
            </div>
        ),
    },
    { line: 19, art: () => <div className="ws-center"><HandWithSprout at={cue(19, 0)} focusAt={cue(20, 4)} controlAt={cue(21, 1)} /></div> },
    { line: 22, art: () => <PlotQuestions cues={[cue(22, 2), cue(22, 4), cue(23, 1), cue(23, 4), cue(24, 1)]} /> },
    { line: 25, art: () => <MemoryBubbles thoughtAt={cue(25, 2)} talkAt={cue(26, 1)} crossAt={cue(26, 4)} /> },
    // कामाची खात्री
    { line: 27, art: () => <ApprovalFlow workerAt={cue(27, 5)} recordAt={cue(28, 2)} approveAt={cue(29, 4)} /> },
    { line: 30, art: () => <div className="ws-center"><CorrectionLedger wrongAt={cue(30, 1)} fixAt={cue(32, 1)} /></div> },
    { line: 33, art: () => <div className="ws-center"><TrustShield at={cue(33, 1)} sureAt={cue(34, 2)} dutyAt={cue(34, 4)} /></div> },
    // आमचं स्वप्न
    {
        line: 35,
        art: () => (
            <div className="ws-center ws-wide">
                <Sunrise />
                <PlanBadges planAt={cue(38, 2)} decideAt={cue(39, 2)} />
            </div>
        ),
    },
    { line: 41, art: () => <div className="ws-center"><GrowthRow seedAt={cue(41, 0)} smallAt={cue(41, 1)} bigAt={cue(42, 1)} fruitAt={cue(42, 3)} /></div> },
    // रोजचं सातत्य
    { line: 43, art: () => <div className="ws-center"><HabitStreak oneAt={cue(44, 3)} daysAt={cue(45, 0)} /></div> },
    { line: 46, art: () => <div className="ws-center"><VoiceMic cues={[cue(46, 1), cue(46, 3), cue(47, 1)]} /></div> },
    { line: 49, art: () => <div className="ws-center"><OrganiseSlips at={cue(49, 4)} techAt={cue(50, 0)} /></div> },
    // चला, सुरुवात करूया
    { line: 51, art: () => <div className="ws-center"><Together joinAt={cue(54, 1)} /></div> },
    { line: 55, art: () => <div className="ws-center"><Pillars cues={[cue(56, 1), cue(56, 3), cue(57, 2)]} /></div> },
    { line: 58, art: () => <div className="ws-center ws-wide"><Sunrise road roadAt={cue(58, 2)} /></div> },
    { line: 60, art: () => <div className="ws-center"><AskBubble at={cue(60, 2)} /></div> },
    {
        line: 61,
        art: () => (
            <div className="ws-center">
                <BrandSeal burstAt={cue(61, 3)} />
                <Confetti at={cue(61, 3)} />
            </div>
        ),
    },
];

/** Index of the scene showing while phrase `lineIndex` is on screen. */
export function sceneIndexForLine(lineIndex: number): number {
    let k = 0;
    for (let i = 0; i < STORY_SCENES.length; i++) {
        if (STORY_SCENES[i].line <= lineIndex) k = i;
    }
    return k;
}
