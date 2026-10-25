/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "वीज कधी असते?" — the electricity timetable on the पाणी आणि वीज page.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). Redrawn in the approved look
 * (founder 2026-10-25: "it must ask single-phase timing and three-phase timing"), on the REAL stored
 * model and the same handlers as before — nothing about what is saved changed:
 *   - सिंगल फेज and थ्री फेज, each on its own card;
 *   - वीज असते / वीज जाते (hours a day) and a 24-hour strip, green = on, red = off;
 *   - "रोज वीज जात नाही (24 तास)" (no OFF window) or the OFF window "पासून … पर्यंत" (may cross midnight);
 *   - "दर दुसऱ्या आठवड्याला वेळ बदलते" → आठवडा अ / आठवडा ब, each with its own window;
 *   - the same check (start ≠ end), जतन करा (writes through `onUpdate`) and पूर्वीसारखं करा.
 * The rules live in `./electricityTiming.ts`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Zap } from 'lucide-react';
import type {
    ElectricityOffWindow, ElectricityPhaseSchedule, ElectricityTimingConfiguration, FarmerProfile,
} from '../../../domain/types/farm.types';
import { systemClock } from '../../../core/domain/services/Clock';
import { GlassCard, SwitchRow, Tap } from './hubUi';
import {
    PHASES, PHASE_TITLE, defaultOffWindow, farmerClock, formatHours, normalizeConfig, offAtHour, summarizeWeek,
    weekWindows, type PhaseKey, type WeekKey, type WeekSummary,
} from './electricityTiming';

interface ElectricityTimingConfiguratorProps {
    profile: FarmerProfile;
    onUpdate: (profile: FarmerProfile) => void;
}

const PHASE_HINT: Record<PhaseKey, string> = { singlePhase: 'घर आणि लहान पंपासाठी', threePhase: 'मोठ्या मोटरसाठी' };

/** 24 hours as a strip: green = power on, red = power off. */
const DayStrip: React.FC<{ windows: ElectricityOffWindow[]; testId: string }> = ({ windows, testId }) => (
    <div data-testid={testId} aria-hidden="true">
        <div className="flex h-5 overflow-hidden rounded-full ring-1 ring-stone-200">
            {Array.from({ length: 24 }, (_, h) => (
                <span key={h} data-off={offAtHour(windows, h)}
                    className={`flex-1 ${offAtHour(windows, h) ? 'bg-rose-400' : 'bg-emerald-400'} ${h % 6 === 0 && h ? 'border-l border-white/70' : ''}`} />
            ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-bold text-stone-500"><span>रात्री 12</span><span>सकाळी 6</span><span>दुपारी 12</span><span>संध्या 6</span><span>रात्री 12</span></div>
    </div>
);

const TimeBox: React.FC<{ label: string; value: string; onChange: (v: string) => void; testId: string }> = ({ label, value, onChange, testId }) => (
    <label className="block min-w-0 flex-1">
        <span className="block text-[12.5px] font-extrabold text-stone-600">{label}</span>
        <input type="time" value={value} onChange={e => onChange(e.target.value)} data-testid={testId}
            className="mt-1 min-h-[50px] w-full rounded-xl bg-white px-2 text-[18px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500" />
        <span className="mt-0.5 block text-[12.5px] font-bold text-stone-500">{farmerClock(value)}</span>
    </label>
);

interface WeekEditorProps {
    id: string;
    title?: string;
    windows: ElectricityOffWindow[];
    summary: WeekSummary;
    onNoCut: (noCut: boolean) => void;
    onTime: (field: 'startTime' | 'endTime', value: string) => void;
}

const WeekEditor: React.FC<WeekEditorProps> = ({ id, title, windows, summary, onNoCut, onTime }) => {
    const window = windows[0];
    return (
        <div className="space-y-2.5 rounded-2xl bg-stone-50/80 p-2.5 ring-1 ring-stone-200" data-testid={`week-${id}`}>
            {title && <p className="m-0 text-[15px] font-extrabold text-stone-800">{title}</p>}
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-50 p-2 ring-1 ring-emerald-100">
                    <p className="m-0 text-[12.5px] font-extrabold text-emerald-800">वीज असते</p>
                    <p className="m-0 text-[18px] font-extrabold text-stone-900" data-testid={`on-${id}`}>{formatHours(summary.onMinutes)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-2 ring-1 ring-rose-100">
                    <p className="m-0 text-[12.5px] font-extrabold text-rose-800">वीज जाते</p>
                    <p className="m-0 text-[18px] font-extrabold text-stone-900" data-testid={`off-${id}`}>{formatHours(summary.offMinutes)}</p>
                </div>
            </div>
            <DayStrip windows={windows} testId={`strip-${id}`} />
            <SwitchRow on={windows.length === 0} onChange={onNoCut} testId={`nocut-${id}`} label="रोज वीज जात नाही (24 तास)" />
            {window && (
                <>
                    <p className="m-0 text-[13.5px] font-extrabold text-stone-700">वीज रोज कधी जाते?</p>
                    <div className="flex gap-2">
                        <TimeBox label="पासून (वीज जाते)" value={window.startTime || '12:00'} onChange={v => onTime('startTime', v)} testId={`start-${id}`} />
                        <TimeBox label="पर्यंत (वीज येते)" value={window.endTime || '18:00'} onChange={v => onTime('endTime', v)} testId={`end-${id}`} />
                    </div>
                    {summary.error
                        ? <p className="m-0 rounded-xl bg-rose-50 p-2 text-[13.5px] font-extrabold text-rose-700" data-testid={`error-${id}`}>{summary.error}</p>
                        : <p className="m-0 text-[13.5px] font-bold text-stone-600">वीज असते: {farmerClock(window.endTime)} ते {farmerClock(window.startTime)}</p>}
                </>
            )}
        </div>
    );
};

const ElectricityTimingConfigurator: React.FC<ElectricityTimingConfiguratorProps> = ({ profile, onUpdate }) => {
    const [draft, setDraft] = useState<ElectricityTimingConfiguration>(() => normalizeConfig(profile.electricityTiming));
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        setDraft(normalizeConfig(profile.electricityTiming));
        setDirty(false);
        setMessage('');
    }, [profile.electricityTiming]);

    const updatePhase = (phase: PhaseKey, updater: (value: ElectricityPhaseSchedule) => ElectricityPhaseSchedule) => {
        setDraft(prev => ({ ...prev, [phase]: updater(prev[phase]), updatedAt: systemClock.nowISO() }));
        setDirty(true);
        setMessage('');
    };

    const setNoPowerCut = (phase: PhaseKey, week: WeekKey, noPowerCut: boolean) => {
        updatePhase(phase, current => {
            const nextWindows = noPowerCut ? [] : [defaultOffWindow()];
            return week === 'A' ? { ...current, weekAOffWindows: nextWindows } : { ...current, weekBOffWindows: nextWindows };
        });
    };

    const setWeekTime = (phase: PhaseKey, week: WeekKey, field: 'startTime' | 'endTime', value: string) => {
        updatePhase(phase, current => {
            const base = weekWindows(current, week)[0] || defaultOffWindow();
            const updated = [{ ...base, [field]: value }];
            return week === 'A' ? { ...current, weekAOffWindows: updated } : { ...current, weekBOffWindows: updated };
        });
    };

    const setAlternateWeek = (phase: PhaseKey, enabled: boolean) => {
        updatePhase(phase, current => ({
            ...current,
            patternMode: enabled ? 'ROTATIONAL' : 'FIXED_WEEKLY',
            alternateWeeklyPattern: enabled,
            weekBOffWindows: enabled ? current.weekBOffWindows : [],
        }));
    };

    const summaries = useMemo(() => ({
        singlePhase: { A: summarizeWeek(weekWindows(draft.singlePhase, 'A')), B: summarizeWeek(weekWindows(draft.singlePhase, 'B')) },
        threePhase: { A: summarizeWeek(weekWindows(draft.threePhase, 'A')), B: summarizeWeek(weekWindows(draft.threePhase, 'B')) },
    }), [draft]);

    const errors = useMemo(() => {
        const list: string[] = [];
        PHASES.forEach(phase => {
            const aError = summaries[phase].A.error;
            if (aError) list.push(`${PHASE_TITLE[phase]}${draft[phase].alternateWeeklyPattern ? ' · आठवडा अ' : ''}: ${aError}`);
            if (draft[phase].alternateWeeklyPattern) {
                const bError = summaries[phase].B.error;
                if (bError) list.push(`${PHASE_TITLE[phase]} · आठवडा ब: ${bError}`);
            }
        });
        return list;
    }, [draft, summaries]);

    const hasErrors = errors.length > 0;

    const save = () => {
        if (hasErrors) {
            setMessage('वेळ दुरुस्त करा, मग जतन करा.');
            return;
        }
        onUpdate({ ...profile, electricityTiming: { ...draft, updatedAt: systemClock.nowISO() } });
        setDirty(false);
        setMessage('वीज वेळ जतन झाली ✓');
    };

    const reset = () => {
        setDraft(normalizeConfig(profile.electricityTiming));
        setDirty(false);
        setMessage('पूर्वीसारखं केलं');
    };

    return (
        <div className="space-y-3" data-testid="power-timing">
            {PHASES.map(phase => {
                const phaseData = draft[phase];
                const alternate = phaseData.alternateWeeklyPattern;
                return (
                    <GlassCard key={phase} testId={`phase-${phase}`}>
                        <p className="m-0 flex items-center gap-2 text-[18px] font-extrabold text-stone-900">
                            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700"><Zap size={20} aria-hidden="true" /></span>
                            {PHASE_TITLE[phase]}
                        </p>
                        <p className="m-0 mt-0.5 text-[13px] font-semibold text-stone-500">{PHASE_HINT[phase]}</p>
                        <div className="mt-2.5 space-y-2.5">
                            <WeekEditor id={`${phase}-A`} title={alternate ? 'आठवडा अ' : undefined}
                                windows={phaseData.weekAOffWindows} summary={summaries[phase].A}
                                onNoCut={v => setNoPowerCut(phase, 'A', v)} onTime={(f, v) => setWeekTime(phase, 'A', f, v)} />
                            <SwitchRow on={alternate} onChange={v => setAlternateWeek(phase, v)} testId={`alternate-${phase}`}
                                label="दर दुसऱ्या आठवड्याला वेळ बदलते (आठवडा अ / ब)" />
                            {alternate && (
                                <WeekEditor id={`${phase}-B`} title="आठवडा ब"
                                    windows={weekWindows(phaseData, 'B')} summary={summaries[phase].B}
                                    onNoCut={v => setNoPowerCut(phase, 'B', v)} onTime={(f, v) => setWeekTime(phase, 'B', f, v)} />
                            )}
                        </div>
                    </GlassCard>
                );
            })}

            {hasErrors && (
                <div className="rounded-2xl bg-rose-50 p-3 text-[14px] font-extrabold text-rose-700" data-testid="power-errors">
                    {errors.map(error => <p key={error} className="m-0">{error}</p>)}
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                <Tap onClick={reset} disabled={!dirty} data-testid="power-reset"
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full bg-white text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300 disabled:opacity-40">
                    <RotateCcw size={18} aria-hidden="true" />पूर्वीसारखं करा
                </Tap>
                <Tap onClick={save} disabled={!dirty || hasErrors} data-testid="power-save" rippleColor="rgba(255,255,255,0.35)"
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full bg-emerald-700 text-[15px] font-extrabold text-white disabled:opacity-40">
                    <Save size={18} aria-hidden="true" />जतन करा
                </Tap>
            </div>

            {message && (
                <p className={`m-0 text-center text-[14px] font-extrabold ${hasErrors ? 'text-rose-700' : 'text-emerald-800'}`} role="status" data-testid="power-msg">
                    {message}
                </p>
            )}
        </div>
    );
};

export default ElectricityTimingConfigurator;
