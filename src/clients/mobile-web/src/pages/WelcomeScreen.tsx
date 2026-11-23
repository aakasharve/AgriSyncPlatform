/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — first-run welcome, shown once right after a person's first
 * login, before the permissions screen.
 *
 * EVERY new user hears the founder's welcome voice note (founder decision
 * 2026-11-23: compulsory for each user — owner, worker and mukadam alike —
 * with the gentle skip kept). It starts by itself: a short live intro
 * ("अभिनंदन!", a 3·2·1 ring) runs while it loads, then the voice plays with
 * kinetic Marathi type and pictures in step with it (welcome/WelcomeStory).
 * Listening to the end → a thank-you with the daily habit → continue.
 * Skipping asks once, honestly ("फक्त 2 मिनिटं…"), then continues.
 *
 * The one thing that still depends on role is the line under "अभिनंदन!":
 * "सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!" is an owner's line, so a Worker
 * or Mukadam who joined by QR is not told it (JOURNEY FIX D10).
 */
import React, { useCallback, useState } from 'react';
import WelcomeStory from './onboarding/welcome/WelcomeStory';
import WelcomeDone from './onboarding/welcome/WelcomeDone';

interface WelcomeScreenProps {
    onContinue: () => void;
    /**
     * The person's role on the active farm, when known. Only used to keep the
     * owner line from a Worker or Mukadam. Unknown (a brand-new account about
     * to create a first farm) keeps it.
     */
    farmRole?: string | null;
}

const isNonOwnerRole = (role: string | null | undefined): boolean => {
    const r = role?.trim().toLowerCase();
    return r === 'worker' || r === 'mukadam';
};

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue, farmRole }) => {
    const [stage, setStage] = useState<'story' | 'done'>('story');
    const [storyKey, setStoryKey] = useState(0);

    const handleStoryDone = useCallback((listenedToEnd: boolean) => {
        if (listenedToEnd) setStage('done');
        else onContinue();
    }, [onContinue]);

    if (stage === 'done') {
        return <WelcomeDone onContinue={onContinue} onReplay={() => { setStoryKey((k) => k + 1); setStage('story'); }} />;
    }
    return <WelcomeStory key={storyKey} onDone={handleStoryDone} showOwnerLine={!isNonOwnerRole(farmRole)} />;
};

export default WelcomeScreen;
