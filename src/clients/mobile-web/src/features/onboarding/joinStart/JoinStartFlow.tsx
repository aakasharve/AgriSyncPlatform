/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the first screens BEFORE sign-in, in the
 * first-run's dawn look (V1-A: big door cards one under the other; the camera fills the whole screen):
 *
 *   "तुम्ही कोण?"  [शेतकरी]  [संस्था / तज्ज्ञ → "हा भाग अजून तयार होत आहे" (nothing asked, nothing stored)]
 *                  "आधीच श्रमसफल वापरता? लॉगिन करा" → the number and the SMS code
 *   शेतकरी → "तुम्हाला कोणी श्रमसफलवर बोलावलं आहे का?"
 *      हो   → the scanner (or "कोड टाका": the 6-character farm code or the owner's 8-digit invitation) → the number
 *      नाही → the number → after the SMS code, his own farm
 *
 * The two questions only pick the next screen: nothing is sent or stored for them (R1 joining design, rule 1). A role
 * is never chosen here — the owner gives it, per farm. What he scanned or typed is HELD on the phone (`heldJoin.ts`)
 * and sent by the signed-in app right after the SMS code; the server answers nothing before that.
 *
 * Inputs keep focus simple (the trap of a hidden input stealing focus): no autofocus, no focus handlers.
 */
import React, { useRef, useState } from 'react';
import { ArrowLeft, Building2, Clock3, KeyRound, QrCode, Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { Tap } from '../../../shared/components/ui/placeUi';
import { FirstRunGlass, FirstRunHeading, FirstRunShell, GreenButton, Rise } from '../firstRun/FirstRunShell';
import { joinStartCopy, type JoinStartCopy } from './joinStartCopy';
import { readScannedJoin, readTypedJoin, type HeldJoin } from './heldJoin';
import { useQrCamera } from './useQrCamera';

export type JoinStartStep = 'who' | 'org' | 'invited' | 'scan' | 'code';

/** Where the first screens hand over to the number screen. */
export type JoinStartChoice = { kind: 'login' } | { kind: 'own' } | { kind: 'join'; held: HeldJoin };

export interface JoinStartFlowProps {
    /** Back from "तुम्ही कोण?" (to स्वागत). */
    onBack: () => void;
    onChoice: (choice: JoinStartChoice) => void;
    /** Coming back from the number screen: the step he left from. */
    initialStep?: JoinStartStep;
}

const Door: React.FC<{ onClick: () => void; testId: string; tone: 'green' | 'white' | 'blue'; icon: React.ReactNode; title: string; line?: string }> = ({
    onClick, testId, tone, icon, title, line,
}) => (
    <Tap onClick={onClick} data-testid={testId} rippleColor={tone === 'green' ? 'rgba(255,255,255,0.3)' : undefined}
        className={`flex min-h-[112px] w-full items-center gap-4 rounded-[28px] p-4 text-left shadow-sm ${tone === 'green'
            ? 'bg-gradient-to-br from-emerald-600 to-emerald-800 text-white'
            : tone === 'blue' ? 'border-2 border-[#1448E6] bg-white text-stone-900' : 'border border-stone-200 bg-white text-stone-900'}`}>
        <span className={`grid h-[64px] w-[64px] shrink-0 place-items-center rounded-full ${tone === 'green'
            ? 'bg-white text-emerald-700' : tone === 'blue' ? 'bg-[#1448E6]/10 text-[#1448E6]' : 'bg-violet-100 text-violet-800'}`}>{icon}</span>
        <span>
            <span className="block text-[21px] font-extrabold leading-tight">{title}</span>
            {line && <span className={`mt-1 block text-[14px] font-semibold ${tone === 'green' ? 'text-emerald-50' : 'text-stone-600'}`}>{line}</span>}
        </span>
    </Tap>
);

/** The full-screen camera (V1-A: "the camera fills the whole screen"). */
const ScanScreen: React.FC<{ c: JoinStartCopy; onBack: () => void; onType: () => void; onHeld: (held: HeldJoin) => void }> = ({ c, onBack, onType, onHeld }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const camera = useQrCamera(videoRef, (raw) => {
        const held = readScannedJoin(raw);
        if (!held) return false;
        onHeld(held);
        return true;
    });
    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-stone-950 text-white" data-testid="join-start-scan">
            <video ref={videoRef} data-testid="join-start-video" muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-90" />
            <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pt-[calc(1rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))]">
                <Tap onClick={onBack} data-testid="join-start-scan-back" aria-label={c.back}
                    className="flex min-h-[44px] w-fit items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[15px] font-extrabold text-white">
                    <ArrowLeft size={20} strokeWidth={2.4} aria-hidden="true" />{c.back}
                </Tap>
                <h1 className="m-0 mt-5 text-center text-[26px] font-extrabold">{c.scanTitle}</h1>
                <div aria-hidden="true" className="mx-auto mt-6 h-[240px] w-[240px] rounded-3xl border-[3px] border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                <p className="m-0 mt-5 text-center text-[17px] font-extrabold" data-testid="join-start-scan-help">{c.scanHelp}</p>
                {(camera === 'none' || camera === 'off') && (
                    <p role="status" data-testid="join-start-no-camera" className="m-0 mt-3 rounded-2xl bg-black/50 px-4 py-3 text-center text-[15px] font-bold">
                        {camera === 'none' ? c.noScanner : c.cameraOff}
                    </p>
                )}
                <div className="flex-1" />
                <Tap onClick={onType} data-testid="join-start-type-code"
                    className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-white text-[17px] font-black text-stone-900">
                    <KeyRound size={20} aria-hidden="true" />{c.typeCode}
                </Tap>
            </div>
        </div>
    );
};

const CodeScreen: React.FC<{ c: JoinStartCopy; onBack: () => void; onHeld: (held: HeldJoin) => void }> = ({ c, onBack, onHeld }) => {
    const [raw, setRaw] = useState('');
    const held = readTypedJoin(raw);
    return (
        <FirstRunShell testId="join-start-code" onBack={onBack} backLabel={c.back}>
            <Rise className="mt-4"><FirstRunHeading>{c.typeCode}</FirstRunHeading></Rise>
            <Rise d={0.1} className="mt-6">
                <FirstRunGlass>
                    <label htmlFor="join-start-code-input" className="flex items-center gap-2 text-[16px] font-extrabold text-stone-900">
                        <KeyRound size={20} className="shrink-0 text-emerald-700" aria-hidden="true" />{c.codeLabel}
                    </label>
                    <input id="join-start-code-input" data-testid="join-start-code-input" value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        placeholder={c.codeHint} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
                        className="mt-2 min-h-[64px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-center font-mono text-[26px] font-extrabold uppercase tracking-[0.2em] text-stone-900 outline-none placeholder:font-sans placeholder:text-[15px] placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 focus:border-emerald-600" />
                    <p className="m-0 mt-2 text-[13.5px] font-bold text-stone-600">{c.codeHint}</p>
                    <p className="m-0 mt-1 text-[13.5px] font-bold text-stone-600" data-testid="join-start-role-note">{c.roleNote}</p>
                </FirstRunGlass>
            </Rise>
            <div className="flex-1" />
            <Rise d={0.2} className="mt-6">
                <GreenButton onClick={() => { if (held) onHeld(held); }} disabled={!held} testId="join-start-code-send">{c.send}</GreenButton>
            </Rise>
        </FirstRunShell>
    );
};

const JoinStartFlow: React.FC<JoinStartFlowProps> = ({ onBack, onChoice, initialStep = 'who' }) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const c = joinStartCopy(language);
    const [step, setStep] = useState<JoinStartStep>(initialStep);
    const hold = (held: HeldJoin) => onChoice({ kind: 'join', held });

    if (step === 'scan') return <ScanScreen c={c} onBack={() => setStep('invited')} onType={() => setStep('code')} onHeld={hold} />;
    if (step === 'code') return <CodeScreen c={c} onBack={() => setStep('scan')} onHeld={hold} />;

    if (step === 'org') {
        return (
            <FirstRunShell testId="join-start-org" onBack={() => setStep('who')} backLabel={c.back}>
                <div className="flex-1" />
                <FirstRunGlass className="text-center">
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-100 text-violet-800"><Clock3 size={30} aria-hidden="true" /></span>
                    <p className="m-0 mt-3 text-[21px] font-extrabold leading-snug text-stone-900" data-testid="join-start-soon">{c.soon}</p>
                </FirstRunGlass>
                <div className="flex-1" />
            </FirstRunShell>
        );
    }

    if (step === 'invited') {
        return (
            <FirstRunShell testId="join-start-invited" onBack={() => setStep('who')} backLabel={c.back}>
                <Rise className="mt-4"><FirstRunHeading testId="join-start-invited-title">{c.invitedQuestion}</FirstRunHeading></Rise>
                <div className="mt-6 space-y-3">
                    <Rise d={0.1}><Door onClick={() => setStep('scan')} testId="join-start-yes" tone="blue" icon={<QrCode size={34} aria-hidden="true" />} title={c.yes} line={c.yesLine} /></Rise>
                    <Rise d={0.2}><Door onClick={() => onChoice({ kind: 'own' })} testId="join-start-no" tone="green" icon={<Sprout size={36} aria-hidden="true" />} title={c.no} /></Rise>
                </div>
            </FirstRunShell>
        );
    }

    return (
        <FirstRunShell testId="join-start-who" onBack={onBack} backLabel={c.back}>
            <Rise className="mt-4"><FirstRunHeading testId="join-start-who-title">{c.who}</FirstRunHeading></Rise>
            <Rise d={0.1}><p className="m-0 mt-1 text-center text-[14.5px] font-semibold text-stone-600">{c.pickOne}</p></Rise>
            <div className="mt-6 space-y-3">
                <Rise d={0.2}><Door onClick={() => setStep('invited')} testId="join-start-farmer" tone="green" icon={<Sprout size={36} aria-hidden="true" />} title={c.farmer} line={c.farmerLine} /></Rise>
                <Rise d={0.3}><Door onClick={() => setStep('org')} testId="join-start-org-door" tone="white" icon={<Building2 size={34} aria-hidden="true" />} title={c.org} line={c.orgLine} /></Rise>
            </div>
            <div className="flex-1" />
            <p className="m-0 mt-6 text-center text-[15px] font-bold text-stone-700">
                {c.already}{' '}
                <button type="button" data-testid="join-start-login" onClick={() => onChoice({ kind: 'login' })}
                    className="min-h-[44px] px-1 font-extrabold text-emerald-800 underline underline-offset-2">{c.login}</button>
            </p>
        </FirstRunShell>
    );
};

export default JoinStartFlow;
