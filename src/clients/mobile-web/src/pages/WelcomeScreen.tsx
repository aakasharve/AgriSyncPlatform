/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — first-run welcome, shown once right after the farmer's first
 * login, before the permissions screen.
 *
 * TWO PATHS, by who this person is on the farm:
 *
 *  - OWNER (or no role yet — a brand-new account about to create a first farm):
 *    the founder's welcome voice note plays by itself. A short live intro
 *    ("अभिनंदन!", a 3·2·1 ring) runs while it loads, then the voice starts with
 *    kinetic Marathi type and pictures in step with it (welcome/WelcomeStory).
 *    Listening to the end → a thank-you with the daily habit → continue.
 *    Skipping asks once, honestly ("फक्त 2 मिनिटं…"), then continues.
 *
 *  - WORKER or MUKADAM (joined by QR): the note speaks to the farm owner
 *    ("तुम्ही ते तपासून मंजूर करू शकता"), so it is not played to them. They get
 *    the light greeting with the daily thread and one button, as before.
 *
 * Only the "अभिनंदन!" headline uses Noto Serif Devanagari; body copy uses
 * Noto Sans Devanagari (the deliberate two-font split).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Check, Leaf } from 'lucide-react';
import DawnScene from './onboarding/DawnScene';
import DailyThread from './onboarding/welcome/DailyThread';
import WelcomeStory from './onboarding/welcome/WelcomeStory';
import WelcomeDone from './onboarding/welcome/WelcomeDone';

interface WelcomeScreenProps {
    onContinue: () => void;
    /**
     * The person's role on the active farm, when known. The owner greeting and
     * the owner's voice note are for owners; a Worker or Mukadam who joined by
     * QR is not on that way and must not be told so. Unknown keeps them.
     */
    farmRole?: string | null;
}

const isNonOwnerRole = (role: string | null | undefined): boolean => {
    const r = role?.trim().toLowerCase();
    return r === 'worker' || r === 'mukadam';
};

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue, farmRole }) => {
    const owner = !isNonOwnerRole(farmRole);
    const [stage, setStage] = useState<'story' | 'done'>('story');
    const [storyKey, setStoryKey] = useState(0);

    const handleStoryDone = useCallback((listenedToEnd: boolean) => {
        if (listenedToEnd) setStage('done');
        else onContinue();
    }, [onContinue]);

    if (!owner) return <NonOwnerGreeting onContinue={onContinue} />;
    if (stage === 'done') {
        return <WelcomeDone onContinue={onContinue} onReplay={() => { setStoryKey((k) => k + 1); setStage('story'); }} />;
    }
    return <WelcomeStory key={storyKey} onDone={handleStoryDone} showOwnerLine={owner} />;
};

/** The light greeting for a worker or mukadam: no owner line, no owner's note. */
const NonOwnerGreeting: React.FC<{ onContinue: () => void }> = ({ onContinue }) => {
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(t);
    }, []);

    const anim = (name: string, dur: string, delay: string): React.CSSProperties =>
        mounted ? { animation: `${name} ${dur} cubic-bezier(.16,1,.3,1) ${delay} both` } : { opacity: 0 };

    return (
        <div lang="mr" className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#F4FCF8] pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] select-none">
            <style>{`
                @keyframes ws-rise { from{transform:translateY(24px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-name { 0%{transform:scale(.9);opacity:0} 60%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
                @media (prefers-reduced-motion:reduce){
                    [data-ws-anim]{animation-duration:.01ms!important;animation-delay:0ms!important}
                }
            `}</style>

            <DawnScene lit={mounted} />

            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-none flex-col items-center px-6 pt-7 text-center">
                <div data-ws-anim className="mb-3 inline-flex items-center gap-1.5 text-emerald-700/80" style={anim('ws-up', '.5s', '0s')}>
                    <Check size={14} strokeWidth={3} />
                    <span className="font-sans text-[13px] font-bold tracking-wide">लॉगिन यशस्वी</span>
                </div>
                <div data-ws-anim className="relative inline-block" style={anim('ws-name', '.7s', '.4s')}>
                    <span
                        className="font-serif text-[42px] font-bold leading-[1.4]"
                        style={{
                            backgroundImage: 'linear-gradient(180deg,#EAB308 0%,#B8730F 100%)',
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            color: 'transparent',
                            filter: 'drop-shadow(0 2px 6px rgba(184,115,15,.28))',
                        }}
                    >
                        अभिनंदन!
                    </span>
                    <Leaf size={13} className="absolute -right-4 top-1 text-emerald-500" aria-hidden="true" />
                </div>
            </div>

            <div data-ws-anim className="relative z-[5] flex min-h-0 flex-1 items-end justify-center px-6" style={anim('ws-rise', '.9s', '.14s')}>
                {imgFailed ? (
                    <div className="flex h-full max-h-[26rem] items-end justify-center pb-4">
                        <div className="flex h-36 w-36 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white/90 shadow-xl">
                            <Leaf size={56} />
                        </div>
                    </div>
                ) : (
                    <img
                        src="/brand/farmer-welcome.webp"
                        alt="श्रम साथी"
                        onError={() => setImgFailed(true)}
                        className="pointer-events-none h-full max-h-[34rem] w-full object-contain object-bottom"
                        style={{ filter: 'drop-shadow(0 12px 20px rgba(6,78,59,.22))' }}
                    />
                )}
            </div>

            <div className="relative z-20 w-full flex-none">
                <div className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/90 to-transparent" />
                <div className="relative mx-auto w-full max-w-[440px] px-6 pb-6 pt-1" data-ws-anim style={anim('ws-up', '.5s', '.95s')}>
                    <DailyThread />
                    <p className="mx-auto mb-3.5 max-w-[300px] text-center font-sans text-[13px] font-semibold leading-snug text-stone-700">
                        मी <span className="font-bold text-emerald-700">श्रम साथी</span> — तुमच्या रोजच्या शेतीकामाची घडी बसवायला मदत करतो
                    </p>
                    <button
                        data-testid="welcome-continue"
                        type="button"
                        onClick={onContinue}
                        className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] font-sans text-[18px] font-black text-white shadow-[0_16px_38px_-10px_rgba(4,120,87,0.6)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                    >
                        चला, सुरुवात करूया
                        <ChevronRight size={19} className="transition-transform group-active:translate-x-1" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WelcomeScreen;
