/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — first-run character introduction after login. A confetti
 * celebration fires on the "login successful" moment; the farmer is grounded in
 * the farmland scene, and the "मी श्रम साथी" speech bubble sits just above his
 * head with the tail pointing to him, so it reads as the farmer speaking. A
 * glass CTA dock anchors the bottom.
 */
import React, { useState, useEffect } from 'react';
import { CheckCircle2, ChevronRight, Leaf } from 'lucide-react';
import GlassBackdrop from './onboarding/GlassBackdrop';
import FarmerIllustration from './onboarding/FarmerIllustration';

interface WelcomeScreenProps {
    onContinue: () => void;
}

// Celebration confetti — bursts once from the "Login Successful" pill.
const CONFETTI: { l: string; dx: string; dy: string; rot: string; c: string; d: string }[] = [
    { l: '-4px', dx: '-90px', dy: '150px', rot: '260deg', c: '#f59e0b', d: '0s' },
    { l: '2px', dx: '-40px', dy: '185px', rot: '-200deg', c: '#10b981', d: '.06s' },
    { l: '0px', dx: '12px', dy: '205px', rot: '320deg', c: '#3b82f6', d: '.12s' },
    { l: '4px', dx: '58px', dy: '175px', rot: '-260deg', c: '#f59e0b', d: '.04s' },
    { l: '-2px', dx: '98px', dy: '135px', rot: '220deg', c: '#10b981', d: '0s' },
    { l: '0px', dx: '-122px', dy: '105px', rot: '-180deg', c: '#3b82f6', d: '.1s' },
    { l: '2px', dx: '128px', dy: '95px', rot: '280deg', c: '#f43f5e', d: '.08s' },
    { l: '-3px', dx: '-66px', dy: '220px', rot: '200deg', c: '#8b5cf6', d: '.16s' },
    { l: '3px', dx: '72px', dy: '215px', rot: '-220deg', c: '#f59e0b', d: '.14s' },
    { l: '0px', dx: '-16px', dy: '235px', rot: '140deg', c: '#10b981', d: '.2s' },
    { l: '1px', dx: '36px', dy: '225px', rot: '-160deg', c: '#3b82f6', d: '.22s' },
    { l: '-1px', dx: '-46px', dy: '165px', rot: '300deg', c: '#f59e0b', d: '.18s' },
];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue }) => {
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#FFF9EC] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] select-none">
            <style>{`
                @keyframes ws-leaf { 0%{transform:translateY(0) rotate(0);opacity:0} 12%{opacity:.6} 88%{opacity:.6} 100%{transform:translateY(-150px) rotate(160deg);opacity:0} }
                @keyframes ws-rise { from{transform:translateY(26px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-confetti { 0%{transform:translate(0,-6px) rotate(0);opacity:0} 12%{opacity:1} 100%{transform:translate(var(--dx),var(--dy)) rotate(var(--rot));opacity:0} }
                @keyframes ws-pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
                .ws-leaf{position:absolute;pointer-events:none;color:rgba(16,185,129,.4);opacity:0}
                @media (prefers-reduced-motion:reduce){.ws-leaf,.ws-confetti{animation:none!important}.ws-confetti{opacity:0}}
            `}</style>

            {/* farmland scene */}
            <GlassBackdrop />

            {/* farmer — grounded in the field, rising from the bottom */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex justify-center" style={{ animation: mounted ? 'ws-rise .7s cubic-bezier(.16,1,.3,1) .1s both' : undefined, opacity: mounted ? undefined : 0 }}>
                <div className="relative">
                    <div className="absolute bottom-[86px] left-1/2 h-9 w-44 -translate-x-1/2 rounded-[50%] bg-emerald-950/20 blur-2xl" />
                    {imgFailed ? (
                        <FarmerIllustration className="h-[27rem] w-auto drop-shadow-[0_20px_26px_rgba(6,78,59,0.28)]" />
                    ) : (
                        <img
                            src="/brand/farmer-welcome.webp"
                            alt="Shram Safal शेतकरी"
                            onError={() => setImgFailed(true)}
                            className="h-[29rem] w-auto object-contain object-bottom drop-shadow-[0_22px_30px_rgba(6,78,59,0.32)]"
                        />
                    )}
                </div>
            </div>

            {/* rising leaves */}
            <Leaf size={13} className="ws-leaf" style={{ left: '26%', bottom: '30%', animation: 'ws-leaf 7s linear infinite' }} />
            <Leaf size={15} className="ws-leaf" style={{ left: '70%', bottom: '28%', animation: 'ws-leaf 6s linear 2s infinite' }} />
            <Leaf size={12} className="ws-leaf" style={{ left: '46%', bottom: '33%', animation: 'ws-leaf 8s linear 4s infinite' }} />

            {/* top content — over the sky */}
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-col items-center px-6 pt-7 text-center">
                {/* login successful pill + confetti celebration */}
                <div className="relative" style={{ animation: mounted ? 'ws-pop .5s cubic-bezier(.2,1.3,.4,1) both' : undefined, opacity: mounted ? undefined : 0 }}>
                    {mounted && (
                        <div className="pointer-events-none absolute left-1/2 top-1/2 z-30" aria-hidden="true">
                            {CONFETTI.map((p, i) => (
                                <span key={i} className="ws-confetti absolute block h-2.5 w-1.5 rounded-[1px]"
                                    style={{ left: p.l, background: p.c, ['--dx']: p.dx, ['--dy']: p.dy, ['--rot']: p.rot, animation: `ws-confetti 1.5s ${p.d} ease-out forwards` } as React.CSSProperties} />
                            ))}
                        </div>
                    )}
                    <div className="relative z-10 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/60 px-4 py-1.5 shadow-[0_8px_24px_-12px_rgba(6,78,59,0.35)] ring-1 ring-white/30 backdrop-blur-xl">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span className="text-[12.5px] font-bold text-slate-800">लॉगिन यशस्वी · Login Successful</span>
                    </div>
                </div>

                {/* welcome + logo — nudged down */}
                <p className="mt-8 text-[14px] font-extrabold uppercase tracking-[0.14em] text-emerald-800/80">Welcome to</p>
                <img src="/brand/logo-full.webp" alt="Shram Safal" className="mt-1.5 h-[48px] w-auto object-contain drop-shadow-sm" />
            </div>

            {/* speech bubble — sits above the farmer's head, tail points to him (he's speaking) */}
            <div className={`absolute left-1/2 top-[29%] z-10 w-[calc(100%-2.75rem)] max-w-[392px] -translate-x-1/2 transition-all duration-700 delay-200 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
                <div className="relative rounded-[26px] border border-white/70 bg-[#fffdf7]/70 px-5 pb-4 pt-4 shadow-[0_18px_44px_-14px_rgba(120,72,10,0.35)] ring-1 ring-white/50 backdrop-blur-2xl">
                    <div className="flex items-center justify-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-200/60 bg-amber-50/80 text-emerald-600 backdrop-blur"><Leaf size={17} /></span>
                        <span className="font-display text-[26px] font-black leading-none text-emerald-700">मी श्रम साथी</span>
                    </div>
                    <div className="mx-auto my-2.5 flex w-24 items-center gap-2">
                        <span className="h-px flex-1 bg-amber-300/50" /><Leaf size={11} className="text-emerald-500/80" /><span className="h-px flex-1 bg-amber-300/50" />
                    </div>
                    <p className="text-[14px] font-semibold leading-relaxed text-slate-700">
                        मी तुमचा सहकारी आहे आणि तुम्हाला <span className="font-black text-emerald-700">नियोजनबद्ध शेतकरी</span> बनवण्यासाठी मदत करेन.
                    </p>
                    {/* tail pointing down to the farmer */}
                    <span className="absolute -bottom-[8px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-white/70 bg-[#fffdf7]/70 backdrop-blur-2xl" />
                </div>
            </div>

            {/* CTA dock — anchors the bottom */}
            <div className={`relative z-20 mt-auto mx-auto w-full max-w-[440px] px-6 pb-6 pt-3 transition-all duration-700 delay-300 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <button
                    type="button"
                    onClick={onContinue}
                    className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] text-[17px] font-black text-white shadow-[0_16px_36px_-10px_rgba(4,120,87,0.7)] ring-1 ring-white/20 transition-transform active:scale-[0.98]"
                >
                    पुढे जाऊया
                    <ChevronRight size={19} className="transition-transform group-active:translate-x-1" />
                </button>
            </div>
        </div>
    );
};

export default WelcomeScreen;
