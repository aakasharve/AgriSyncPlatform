/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — first-run welcome, shown once right after the farmer's first
 * login. Themed to match the LOGIN screen (light white / pale-mint, stone text,
 * emerald accents, a green field band at the base) so login → welcome reads as
 * one product.
 *
 * LAYOUT — three stacked flex zones so nothing overlaps on ANY screen size:
 *   1. GREETING (flex-none, top): "अभिनंदन!" (serif) + the managed-farm-owner line.
 *   2. CHARACTER (flex-1, scales to fit the space between greeting and bottom —
 *      object-contain so his head never collides with the headline).
 *   3. DAILY THREAD (flex-none, bottom): voice cue → आज काय केलं · किती खर्च झाला ·
 *      काय राहिलं → Shram Sathi's signature → one CTA.
 *
 * Only the "अभिनंदन!" headline uses Noto Serif Devanagari; all body copy uses
 * Noto Sans Devanagari (the deliberate two-font split).
 */
import React, { useState, useEffect } from 'react';
import { ChevronRight, Check, Leaf, Sprout, IndianRupee, Hourglass, Mic } from 'lucide-react';
import DawnScene from './onboarding/DawnScene';

interface WelcomeScreenProps {
    onContinue: () => void;
}

// The three things a farmer speaks into his daily log: did · spent · left.
const THREAD: { icon: React.ReactNode; mr: string; primary?: boolean }[] = [
    { icon: <Sprout size={17} strokeWidth={2} />, mr: 'आज काय केलं', primary: true },
    { icon: <IndianRupee size={16} strokeWidth={2.2} />, mr: 'किती खर्च झाला' },
    { icon: <Hourglass size={16} strokeWidth={2} />, mr: 'काय राहिलं' },
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue }) => {
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(t);
    }, []);

    const anim = (name: string, dur: string, delay: string): React.CSSProperties =>
        mounted ? { animation: `${name} ${dur} cubic-bezier(.16,1,.3,1) ${delay} both` } : { opacity: 0 };

    return (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#F4FCF8] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] select-none">
            <style>{`
                @keyframes ws-rise { from{transform:translateY(24px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-name { 0%{transform:scale(.9);opacity:0} 60%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
                @keyframes ws-thread { from{transform:scaleY(0)} to{transform:scaleY(1)} }
                @media (prefers-reduced-motion:reduce){
                    [data-ws-anim]{animation-duration:.01ms!important;animation-delay:0ms!important}
                }
            `}</style>

            {/* light, login-aligned backdrop + green field band */}
            <DawnScene lit={mounted} />

            {/* 1 — GREETING (flex-none, top) */}
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-none flex-col items-center px-6 pt-7 text-center">
                <div data-ws-anim className="mb-3 inline-flex items-center gap-1.5 text-emerald-700/75" style={anim('ws-up', '.5s', '0s')}>
                    <Check size={14} strokeWidth={3} />
                    <span className="font-sans text-[12px] font-bold tracking-wide">लॉगिन यशस्वी</span>
                </div>

                {/* अभिनंदन! — the ONE serif heading, celebratory gold */}
                <div data-ws-anim className="relative inline-block" style={anim('ws-name', '.7s', '.4s')}>
                    <span
                        className="font-serif text-[40px] font-bold leading-none"
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
                    <Leaf size={13} className="absolute -right-4 -top-1 text-emerald-500" aria-hidden="true" />
                </div>
                <p data-ws-anim className="mt-2.5 max-w-[300px] font-sans text-[13px] font-semibold leading-snug text-stone-600" style={anim('ws-up', '.6s', '.72s')}>
                    सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!
                </p>
            </div>

            {/* 2 — CHARACTER (flex-1, scales to fit; never overlaps greeting or thread) */}
            <div
                data-ws-anim
                className="relative z-[5] flex min-h-0 flex-1 items-end justify-center px-6"
                style={anim('ws-rise', '.9s', '.14s')}
            >
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

            {/* 3 — DAILY THREAD (flex-none, bottom), on a soft scrim that fades the
                farmer's base into the light ground so the text reads cleanly */}
            <div className="relative z-20 w-full flex-none">
                <div className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/90 to-transparent" />
                <div className="relative mx-auto w-full max-w-[440px] px-6 pb-6 pt-1">

                    {/* daily voice cue into the three questions */}
                    <div data-ws-anim className="mb-3 flex items-center justify-center gap-2 font-sans text-[13px] font-bold text-stone-600" style={anim('ws-up', '.5s', '.95s')}>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15">
                            <Mic size={13} strokeWidth={2.5} />
                        </span>
                        <span>रोज मला एवढंच सांगा:</span>
                    </div>

                    {/* the day's thread — three items as ONE connected line, not a grid */}
                    <div className="relative mx-auto mb-3 w-[238px]">
                        <div
                            data-ws-anim
                            className="absolute left-[15px] top-[19px] bottom-[19px] w-[1.5px] origin-top bg-emerald-500/30"
                            style={mounted ? { animation: 'ws-thread .5s cubic-bezier(.16,1,.3,1) 1.05s both' } : { transform: 'scaleY(0)' }}
                            aria-hidden="true"
                        />
                        {THREAD.map((r, i) => (
                            <div key={r.mr} data-ws-anim className="relative flex items-center gap-3 py-1" style={anim('ws-up', '.45s', `${1.15 + i * 0.12}s`)}>
                                <span className={`relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-emerald-700 ${r.primary ? 'bg-emerald-100 ring-1 ring-emerald-500/30' : 'bg-emerald-50 ring-1 ring-emerald-600/12'}`}>
                                    {r.icon}
                                </span>
                                <span className={`font-sans text-[16px] ${r.primary ? 'font-bold text-stone-800' : 'font-semibold text-stone-700'}`}>{r.mr}</span>
                            </div>
                        ))}
                    </div>

                    {/* Shram Sathi's signature — his mission */}
                    <p data-ws-anim className="mx-auto mb-3.5 max-w-[300px] text-center font-sans text-[12.5px] font-medium leading-snug text-stone-600" style={anim('ws-up', '.45s', '1.5s')}>
                        मी <span className="font-bold text-emerald-700">श्रम साथी</span> — तुमच्या रोजच्या शेतीकामाची घडी बसवायला मदत करतो
                    </p>

                    <button
                        data-ws-anim
                        data-testid="welcome-continue"
                        type="button"
                        onClick={onContinue}
                        className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] font-sans text-[17px] font-black text-white shadow-[0_16px_38px_-10px_rgba(4,120,87,0.6)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                        style={anim('ws-up', '.6s', '1.62s')}
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
