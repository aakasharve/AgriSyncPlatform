/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker: "split the existing OwnScheduleMaker.tsx; there is no second maker") -
 * the pieces the schedule maker's screens share, taken out of `OwnScheduleMaker.tsx` so the one-work cards and the schedule screens are the same maker:
 *   - `MakerHeader`: the round back button and the title line;
 *   - `useMakerVoice`: the planning mic (the log's own recorder) and its four states; voice fills ONLY the work's name (F215; full voice is slice 16);
 *   - `AmberCard`: one question per card, in the farmer's own-schedule amber;
 *   - `Stepper`: a full-width whole-number stepper whose number reads in the screen's digits (Devanagari in Marathi), empty until he sets it (founder B3);
 *   - `KindChip`: the kind's colour chip from the approved v7 page.
 * Every target is at least 44 px (TAP-1).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import type { AudioData, CropProfile, FarmerProfile } from '../../../../types';
import { Tap } from '../../../../shared/components/ui/placeUi';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { PlanMic } from '../../../plannedWork/components/PlanMic';
import { understandPlanSpeech, type PlanSpeechResult } from '../../../plannedWork/data/planVoice';
import { plannedWorkWords } from '../../../plannedWork/plannedWorkWords';
import type { ScheduleTaskKind } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { OwnLanguage } from '../ownScheduleWords';

export const MakerHeader: React.FC<{ title: string; onBack: () => void; sub?: string; backLabel: string }> = ({ title, onBack, sub, backLabel }) => (
    <div className="flex items-center gap-2">
        <Tap onClick={onBack} data-testid="own-back" aria-label={backLabel}
            className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-md">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} aria-hidden="true" /></span>
        </Tap>
        <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-[20px] font-extrabold leading-tight text-stone-900" data-testid="own-title">{title}</h3>
            {sub && <p className="m-0 truncate text-[13.5px] font-bold text-stone-600">{sub}</p>}
        </div>
    </div>
);

type VoiceState = 'idle' | 'working' | 'offline' | 'failed';

/** The planning mic and what it says. `onTitle` receives the heard work's name; nothing else is read from the speech. */
export function useMakerVoice(opts: {
    language: string | null | undefined;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    understand?: (audio: AudioData) => Promise<PlanSpeechResult>;
}): { block: (onTitle: ((title: string) => void) | null) => React.ReactNode; reset: () => void } {
    const { language, crops, farmerProfile, understand } = opts;
    const planned = plannedWorkWords(language);
    const [voice, setVoice] = useState<VoiceState>('idle');
    const [heard, setHeard] = useState<string | null>(null);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const hear = useCallback(async (audio: AudioData, onTitle: ((title: string) => void) | null) => {
        setVoice('working');
        const result = await (understand ?? ((a: AudioData) => understandPlanSpeech(a, { crops, profile: farmerProfile })))(audio);
        if (!alive.current) return;
        if (!result.ok) { setVoice(result.reason === 'offline' ? 'offline' : 'failed'); return; }
        setVoice('idle');
        setHeard(result.speech.transcript);
        onTitle?.(result.speech.title);
    }, [understand, crops, farmerProfile]);
    const block = (onTitle: ((title: string) => void) | null) => (
        <>
            <PlanMic onAudio={audio => { void hear(audio, onTitle); }} onProcessingStart={() => setVoice('working')} disabled={voice === 'working'} />
            {voice === 'working' && <p className="m-0 mt-1 text-[13px] font-bold text-stone-700" role="status" data-testid="own-voice-working">{planned.understanding}</p>}
            {voice === 'offline' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="own-voice-offline">{planned.voiceOffline}</p>}
            {voice === 'failed' && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" role="status" data-testid="own-voice-failed">{planned.voiceFailed}</p>}
            {heard && <p className="m-0 mt-1 rounded-xl bg-emerald-50 px-3 py-2 text-[13px] font-bold leading-snug text-emerald-900" data-testid="own-heard">{planned.heard}: &ldquo;{heard}&rdquo;</p>}
        </>
    );
    return { block, reset: () => { setVoice('idle'); setHeard(null); } };
}

/** The five kinds' colours, from the approved v7 page (tint, ink). */
export const KIND_TONE: Readonly<Record<ScheduleTaskKind, readonly [string, string]>> = {
    spray: ['#FEE2E2', '#B91C1C'], nutrition: ['#EDE9FE', '#5B21B6'], irrigation: ['#CFFAFE', '#0E7490'], work: ['#DCFCE7', '#166534'], observe: ['#FCE7F3', '#9D174D'],
};

export const KindChip: React.FC<{ kind: ScheduleTaskKind; label: string }> = ({ kind, label }) => (
    <span className="inline-block rounded-full px-3 py-1 text-[13px] font-extrabold" style={{ background: KIND_TONE[kind][0], color: KIND_TONE[kind][1] }}>{label}</span>
);

export const AmberCard: React.FC<{ testId: string; title: string; sub?: string; optional?: string; kind?: { kind: ScheduleTaskKind; label: string } | null; children: React.ReactNode }> = ({
    testId, title, sub, optional, kind, children,
}) => (
    <section className="rounded-3xl border-2 border-amber-200 bg-white p-3.5 shadow-sm" data-testid={testId}>
        {kind && <div className="mb-1.5"><KindChip kind={kind.kind} label={kind.label} /></div>}
        <h4 className="m-0 text-[18px] font-extrabold leading-snug text-stone-900">
            {title}{optional && <span className="ml-1.5 text-[13px] font-bold text-stone-500">· {optional}</span>}
        </h4>
        {sub && <p className="m-0 mt-0.5 text-[13px] font-semibold leading-snug text-stone-600">{sub}</p>}
        <div className="mt-2.5">{children}</div>
    </section>
);

/** Latin or Devanagari digits typed into a box, as a whole number; anything else is dropped. Empty = null. */
export function readTypedNumber(text: string): number | null {
    const latin = text.replace(/[०-९]/g, d => String('०१२३४५६७८९'.indexOf(d))).replace(/\D/g, '').slice(0, 6);
    return latin.length === 0 ? null : Number.parseInt(latin, 10);
}

export const Stepper: React.FC<{
    testId: string;
    label: string;
    unit?: string;
    value: number | null;
    min?: number;
    max?: number;
    language: OwnLanguage;
    lessLabel: string;
    moreLabel: string;
    onChange: (n: number | null) => void;
}> = ({ testId, label, unit, value, min = 0, max = 3650, language, lessLabel, moreLabel, onChange }) => {
    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    return (
        <div className="mt-2">
            <div className="text-[14px] font-extrabold text-stone-700">{label}</div>
            <div className="mt-1 flex w-full items-center gap-1.5 rounded-2xl bg-amber-50/60 p-1 ring-1 ring-amber-300">
                <Tap onClick={() => onChange(value === null ? null : clamp(value - 1))} aria-label={`${label} ${lessLabel}`} data-testid={`${testId}-less`}
                    className="grid min-h-[52px] min-w-[56px] place-items-center rounded-xl bg-white text-stone-800 ring-1 ring-stone-200"><Minus size={20} aria-hidden="true" /></Tap>
                <input type="text" inputMode="numeric" value={value === null ? '' : digitsFor(value, language)} aria-label={label} data-testid={testId}
                    onChange={e => { const n = readTypedNumber(e.target.value); onChange(n === null ? null : clamp(n)); }}
                    className="min-h-[52px] w-full min-w-0 bg-transparent text-center text-[22px] font-black text-stone-900 outline-none" />
                {unit && <span className="shrink-0 pr-1 text-[15px] font-extrabold text-stone-700">{unit}</span>}
                <Tap onClick={() => onChange(value === null ? min : clamp(value + 1))} aria-label={`${label} ${moreLabel}`} data-testid={`${testId}-more`}
                    className="grid min-h-[52px] min-w-[56px] place-items-center rounded-xl bg-white text-stone-800 ring-1 ring-stone-200"><Plus size={20} aria-hidden="true" /></Tap>
            </div>
        </div>
    );
};

export const TextBox: React.FC<{ testId: string; label?: string; value: string; placeholder?: string; multiline?: boolean; maxLength: number; onChange: (v: string) => void }> = ({
    testId, label, value, placeholder, multiline, maxLength, onChange,
}) => (
    <label className="mt-2 block">
        {label && <span className="block text-[14px] font-extrabold text-stone-700">{label}</span>}
        {multiline
            ? <textarea value={value} maxLength={maxLength} placeholder={placeholder} data-testid={testId} aria-label={label ?? placeholder} rows={3} onChange={e => onChange(e.target.value)}
                className="mt-1 w-full rounded-2xl border-2 border-stone-300 bg-white px-3 py-2 text-[17px] font-bold text-stone-900 outline-none focus:border-amber-600" />
            : <input value={value} maxLength={maxLength} placeholder={placeholder} data-testid={testId} aria-label={label ?? placeholder} onChange={e => onChange(e.target.value)}
                className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-stone-300 bg-white px-3 text-[18px] font-bold text-stone-900 outline-none focus:border-amber-600" />}
    </label>
);
