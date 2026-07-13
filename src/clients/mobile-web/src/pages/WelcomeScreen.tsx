/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — first-run welcome, shown once right after the farmer's first
 * login. Themed to match the LOGIN screen (light white / pale-mint, stone text,
 * emerald accents, a green field band at the base) so login → welcome reads as
 * one product. The whole screen is ONE composed moment, not a stack of cards:
 *
 *   • It CONGRATULATES the farmer (no name): "अभिनंदन!" (Noto Serif Devanagari,
 *     the ONE distinct heading font) + "सुव्यवस्थित शेतीचा मालक होण्याच्या
 *     वाटेवर!" — a step toward being a managed farm owner.
 *   • Shram Sathi stands IN the field band, rim-lit, lower body dissolving into
 *     the base so the text below reads cleanly.
 *   • A daily voice cue ("रोज मला एवढंच सांगा:") hands him the three things he
 *     actually speaks each day, as one connected thread (NOT a card grid):
 *     आज काय केलं · किती खर्च झाला · काय राहिलं (did · spent · left).
 *   • Shram Sathi's signature is his mission; one entrance animation; one CTA.
 *
 * Body copy uses Noto Sans Devanagari; only the "अभिनंदन!" headline uses the
 * serif — that is the deliberate two-font split.
 */
import React, { useState, useEffect } from 'react';
import { ChevronRight, Check, Leaf, Sprout, IndianRupee, Hourglass, Mic } from 'lucide-react';
import DawnScene from './onboarding/DawnScene';

interface WelcomeScreenProps {
    onContinue: () => void;
}

// A cluster of blurred crop blades that sits in FRONT of the farmer's lower
// edge — the nearest depth plane, so he reads as standing among the crop.
const Fronds: React.FC<{ className?: string; flip?: boolean }> = ({ className, flip }) => (
    <svg viewBox="0 0 200 150" className={className} style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true">
        <defs>
            <linearGradient id="frond" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#0a3a28" />
                <stop offset="1" stopColor="#1f8a55" />
            </linearGradient>
        </defs>
        <g fill="url(#frond)">
            <path d="M28 150 C 16 104 34 74 60 40 C 40 78 40 116 44 150 Z" />
            <path d="M64 150 C 58 100 78 66 104 30 C 82 70 78 112 82 150 Z" />
            <path d="M104 150 C 104 108 124 82 150 56 C 128 88 120 120 122 150 Z" />
            <path d="M6 150 C 2 116 12 94 26 70 C 16 100 18 126 22 150 Z" />
        </g>
    </svg>
);

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
                @keyframes ws-rise { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-name { 0%{transform:scale(.9);opacity:0} 60%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
                @keyframes ws-underline { from{transform:scaleX(0)} to{transform:scaleX(1)} }
                @keyframes ws-thread { from{transform:scaleY(0)} to{transform:scaleY(1)} }
                @media (prefers-reduced-motion:reduce){
                    [data-ws-anim]{animation-duration:.01ms!important;animation-delay:0ms!important}
                }
            `}</style>

            {/* light, login-aligned backdrop + green field band */}
            <DawnScene lit={mounted} />

            {/* Shram Sathi — lifted so the day's-log text sits in clear space below */}
            <div
                data-ws-anim
                className="pointer-events-none absolute inset-x-0 bottom-[16%] z-[5] flex justify-center"
                style={anim('ws-rise', '.9s', '.12s')}
            >
                <div className="relative">
                    {/* soft cool backlight behind head/shoulders */}
                    <div
                        className="absolute left-1/2 top-[10%] h-72 w-72 -translate-x-1/2 rounded-full blur-3xl"
                        style={{ background: 'radial-gradient(circle,rgba(209,250,229,.85),rgba(209,250,229,0) 66%)' }}
                    />
                    {imgFailed ? (
                        <div className="relative flex h-[24rem] w-64 items-end justify-center">
                            <div className="flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white/90 shadow-xl">
                                <Leaf size={64} />
                            </div>
                        </div>
                    ) : (
                        <img
                            src="/brand/farmer-welcome.webp"
                            alt="श्रम साथी"
                            onError={() => setImgFailed(true)}
                            className="relative h-[32rem] w-auto object-contain object-bottom"
                            style={{
                                filter: 'drop-shadow(0 16px 22px rgba(6,78,59,.24))',
                                // dissolve his lower body into the base so the day's thread
                                // reads in clean space (no clash with kurta / shield badge)
                                WebkitMaskImage: 'linear-gradient(180deg,#000 54%,rgba(0,0,0,.28) 74%,transparent 90%)',
                                maskImage: 'linear-gradient(180deg,#000 54%,rgba(0,0,0,.28) 74%,transparent 90%)',
                            }}
                        />
                    )}
                </div>
            </div>

            {/* foreground crop blades — nearest plane, overlap his lower edge */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] flex items-end justify-between" aria-hidden="true">
                <Fronds className="h-[132px] w-[48%] opacity-90 blur-[1px]" />
                <Fronds className="h-[150px] w-[54%] opacity-90 blur-[1px]" flip />
            </div>

            {/* TOP — the congratulation (persona, no name) */}
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-col items-center px-6 pt-8 text-center">
                {/* quiet login-success whisper */}
                <div data-ws-anim className="mb-5 inline-flex items-center gap-1.5 text-emerald-700/75" style={anim('ws-up', '.5s', '0s')}>
                    <Check size={14} strokeWidth={3} />
                    <span className="font-sans text-[12px] font-bold tracking-wide">लॉगिन यशस्वी</span>
                </div>

                {/* अभिनंदन! — the ONE serif heading (distinct font), celebratory gold */}
                <div data-ws-anim className="relative mt-1 inline-block" style={anim('ws-name', '.7s', '.4s')}>
                    <span
                        className="font-serif text-[42px] font-bold leading-none"
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
                    <Leaf data-ws-anim size={14} className="absolute -right-4 -top-1 text-emerald-500" style={anim('ws-up', '.4s', '1.1s')} aria-hidden="true" />
                </div>
                {/* sub — first step toward becoming a managed farm owner (body, stone) */}
                <p data-ws-anim className="mt-3 max-w-[290px] font-sans text-[13.5px] font-semibold leading-snug text-stone-600" style={anim('ws-up', '.6s', '.72s')}>
                    सुव्यवस्थित शेतीचा मालक होण्याच्या वाटेवर!
                </p>
            </div>

            {/* BOTTOM — daily voice cue → the day's thread → signature → CTA, on a
                soft white ground-scrim so the text reads over the field band */}
            <div className="relative z-20 mt-auto w-full">
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[21rem] bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/72 to-transparent" />
                <div
                    className="pointer-events-none absolute left-1/2 bottom-[96px] h-[236px] w-[312px] -translate-x-1/2 rounded-[48px] blur-2xl"
                    style={{ background: 'radial-gradient(60% 58% at 50% 44%,rgba(255,255,255,.85),rgba(255,255,255,0) 76%)' }}
                    aria-hidden="true"
                />
                <div className="relative mx-auto w-full max-w-[440px] px-6 pb-7 pt-3">

                    {/* daily voice cue into the three questions */}
                    <div data-ws-anim className="mb-3.5 flex items-center justify-center gap-2 font-sans text-[13px] font-bold text-stone-600" style={anim('ws-up', '.5s', '1.05s')}>
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
                            style={mounted ? { animation: 'ws-thread .5s cubic-bezier(.16,1,.3,1) 1.15s both' } : { transform: 'scaleY(0)' }}
                            aria-hidden="true"
                        />
                        {THREAD.map((r, i) => (
                            <div key={r.mr} data-ws-anim className="relative flex items-center gap-3 py-1" style={anim('ws-up', '.45s', `${1.25 + i * 0.15}s`)}>
                                <span className={`relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-emerald-700 ${r.primary ? 'bg-emerald-100 ring-1 ring-emerald-500/30' : 'bg-emerald-50 ring-1 ring-emerald-600/12'}`}>
                                    {r.icon}
                                </span>
                                <span className={`font-sans text-[16px] ${r.primary ? 'font-bold text-stone-800' : 'font-semibold text-stone-700'}`}>{r.mr}</span>
                            </div>
                        ))}
                    </div>

                    {/* Shram Sathi's signature — his mission (body font, stone) */}
                    <p data-ws-anim className="mx-auto mb-3.5 max-w-[300px] text-center font-sans text-[12.5px] font-medium leading-snug text-stone-600" style={anim('ws-up', '.45s', '1.65s')}>
                        मी <span className="font-bold text-emerald-700">श्रम साथी</span> — तुमच्या रोजच्या शेतीकामाची घडी बसवायला मदत करतो
                    </p>

                    <button
                        data-ws-anim
                        data-testid="welcome-continue"
                        type="button"
                        onClick={onContinue}
                        className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] font-sans text-[17px] font-black text-white shadow-[0_16px_38px_-10px_rgba(4,120,87,0.6)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                        style={anim('ws-up', '.6s', '1.78s')}
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
