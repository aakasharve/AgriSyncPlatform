/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WelcomeScreen — the LAST first-run screen: a welcome written for the person's role.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-7, FR-8). It used to come right after
 * login ("लॉगिन यशस्वी" / one "अभिनंदन!" for everyone, the owner line merely hidden for a worker). It now
 * comes AFTER फोनच्या परवानग्या (PLR-D9 T8: "… → फोनच्या परवानग्या → a welcome written for the role")
 * and says, for the REAL role on the open farm (`currentFarm.role`, never chosen by him), what he will
 * do here — `features/onboarding/firstRun/roleWelcome.ts` holds the words and why each is true today.
 * Someone whose only seat is a request still waiting never reaches this screen: the 0-farm doors say
 * "विनंती पाठवली — …वाट पाहा" instead.
 *
 * The legacy look stays (founder-approved): the DawnScene, the gold serif "अभिनंदन!", the farmer, the
 * thread of things he will do, one green pill button. One "← मागे" back to the permissions.
 */
import React, { useState, useEffect } from 'react';
import { ChevronRight, ClipboardList, Hand, Keyboard, Leaf, Mic, Users } from 'lucide-react';
import DawnScene from './onboarding/DawnScene';
import { useOptionalLanguage } from '../i18n/LanguageContext';
import { firstRunCopy } from '../features/onboarding/firstRun/firstRunCopy';
import { FirstRunBack } from '../features/onboarding/firstRun/FirstRunShell';
import { buildRoleWelcome, type JobIcon } from '../features/onboarding/firstRun/roleWelcome';

interface WelcomeScreenProps {
    onContinue: () => void;
    /** The person's role on the open farm, as the server sends it (PrimaryOwner, Mukadam, Worker…). */
    farmRole?: string | null;
    /** The open farm's name. Never a sample: when there is none, the line is not drawn. */
    farmName?: string | null;
    /** Back to the permissions step. */
    onBack?: () => void;
}

const JOB_ICON: Record<JobIcon, React.ReactNode> = {
    mic: <Mic size={16} strokeWidth={2.4} />,
    plan: <ClipboardList size={16} strokeWidth={2.2} />,
    team: <Users size={16} strokeWidth={2.2} />,
    attendance: <Hand size={16} strokeWidth={2.2} />,
    type: <Keyboard size={16} strokeWidth={2.2} />,
};

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue, farmRole, farmName, onBack }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const copy = firstRunCopy(language);
    const welcome = buildRoleWelcome(farmRole, farmName, language);
    const [imgFailed, setImgFailed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 40);
        return () => clearTimeout(t);
    }, []);

    const anim = (name: string, dur: string, delay: string): React.CSSProperties =>
        mounted ? { animation: `${name} ${dur} cubic-bezier(.16,1,.3,1) ${delay} both` } : { opacity: 0 };

    return (
        <div data-testid="role-welcome" data-role={welcome.role}
            className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#F4FCF8] pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] select-none">
            <style>{`
                @keyframes ws-rise { from{transform:translateY(24px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes ws-name { 0%{transform:scale(.9);opacity:0} 60%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
                @keyframes ws-thread { from{transform:scaleY(0)} to{transform:scaleY(1)} }
                @media (prefers-reduced-motion:reduce){
                    [data-ws-anim]{animation-duration:.01ms!important;animation-delay:0ms!important}
                }
            `}</style>

            <DawnScene lit={mounted} />

            {/* 1 — GREETING (flex-none, top) */}
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-none flex-col items-center px-6 pt-5 text-center">
                {onBack && <div className="mb-2 self-start"><FirstRunBack onBack={onBack} label={copy.back} testId="role-welcome-back" /></div>}

                {/* अभिनंदन! — the ONE serif heading, celebratory gold */}
                <div data-ws-anim className="relative inline-block" style={anim('ws-name', '.7s', '.2s')}>
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
                        {copy.hello.heading}
                    </span>
                    <Leaf size={13} className="absolute -right-4 -top-1 text-emerald-500" aria-hidden="true" />
                </div>
                <p data-ws-anim data-testid="role-welcome-title" className="m-0 mt-2.5 font-sans text-[19px] font-extrabold leading-snug text-emerald-900" style={anim('ws-up', '.6s', '.45s')}>
                    {welcome.title}
                </p>
                {welcome.line && (
                    <p data-ws-anim data-testid="role-welcome-line" className="m-0 mt-1 max-w-[320px] font-sans text-[14px] font-semibold leading-snug text-stone-600 [overflow-wrap:anywhere]" style={anim('ws-up', '.6s', '.6s')}>
                        {welcome.line}
                    </p>
                )}
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
                        alt=""
                        aria-hidden="true"
                        onError={() => setImgFailed(true)}
                        className="pointer-events-none h-full max-h-[34rem] w-full object-contain object-bottom"
                        style={{ filter: 'drop-shadow(0 12px 20px rgba(6,78,59,.22))' }}
                    />
                )}
            </div>

            {/* 3 — WHAT YOU WILL DO HERE (the legacy thread look) + the one button */}
            <div className="relative z-20 w-full flex-none">
                <div className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-[#F5FCF8] via-[#F5FCF8]/90 to-transparent" />
                <div className="relative mx-auto w-full max-w-[440px] px-6 pb-6 pt-1">
                    {welcome.jobs.length > 0 && (
                        <>
                            <p data-ws-anim className="m-0 mb-2 text-center font-sans text-[13px] font-bold text-stone-600" style={anim('ws-up', '.5s', '.8s')}>
                                {copy.hello.jobsHeading}
                            </p>
                            <div className="relative mx-auto mb-4 w-fit max-w-full">
                                <span
                                    data-ws-anim
                                    className="absolute left-[15px] top-[19px] bottom-[19px] w-[1.5px] origin-top bg-emerald-500/30"
                                    style={mounted ? { animation: 'ws-thread .5s cubic-bezier(.16,1,.3,1) .9s both' } : { transform: 'scaleY(0)' }}
                                    aria-hidden="true"
                                />
                                <ul className="m-0 list-none p-0" data-testid="role-welcome-jobs">
                                    {welcome.jobs.map((job, i) => (
                                        <li key={job.text} data-ws-anim className="relative flex items-center gap-3 py-1" style={anim('ws-up', '.45s', `${1 + i * 0.12}s`)}>
                                            <span className={`relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-emerald-700 ${i === 0 ? 'bg-emerald-100 ring-1 ring-emerald-500/30' : 'bg-emerald-50 ring-1 ring-emerald-600/12'}`}>
                                                {JOB_ICON[job.icon]}
                                            </span>
                                            <span className={`font-sans text-[16px] ${i === 0 ? 'font-bold text-stone-800' : 'font-semibold text-stone-700'}`}>{job.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    )}

                    <button
                        data-ws-anim
                        data-testid="welcome-continue"
                        type="button"
                        onClick={onContinue}
                        className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[17px] font-sans text-[17px] font-black text-white shadow-[0_16px_38px_-10px_rgba(4,120,87,0.6)] ring-1 ring-white/25 transition-transform active:scale-[0.98]"
                        style={anim('ws-up', '.6s', '1.4s')}
                    >
                        {copy.hello.go}
                        <ChevronRight size={19} className="transition-transform group-active:translate-x-1" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WelcomeScreen;
