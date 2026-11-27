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
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, P5) - with `farmSetup` (the open farm's set, once the server has sent it) the page shows
 * the FARM's timetable and जतन करा sends it whole through `farmsetup.power_times.set` (queued; base = the revision the phone last received). A waiting
 * save says so (never "जतन झाली" while it is only queued); a refused one keeps its words. A person who may not change the farm setup (`canEdit` false)
 * reads the hours and the strip, with no switch, time box or button. Without `farmSetup` the page is the phone-only page it was.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Zap } from 'lucide-react';
import type {
    ElectricityOffWindow, ElectricityPhaseSchedule, ElectricityTimingConfiguration, FarmerProfile,
} from '../../../domain/types/farm.types';
import { systemClock } from '../../../core/domain/services/Clock';
import { GlassCard, SwitchRow, Tap } from '../../../shared/components/ui/placeUi';
import {
    PHASES, defaultOffWindow, farmerClock, formatHours, normalizeConfig, offAtHour, phaseTitle, summarizeWeek, timeErrorText,
    weekWindows, type PhaseKey, type WeekKey, type WeekSummary,
} from './electricityTiming';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { LocalFarmSetup } from '../farmSetup/farmSetupLocal';
import { closeRefusedChange, setPowerTimes } from '../farmSetup/farmSetupCommands';
import { RefusedBox, WaitingLine, saveProblemWords } from '../farmSetup/FarmSetupLines';

interface ElectricityTimingConfiguratorProps {
    profile: FarmerProfile;
    onUpdate: (profile: FarmerProfile) => void;
    /** repair D-9 - the open farm's set, once the server has sent it (null / absent: the phone-only timetable). */
    farmSetup?: LocalFarmSetup | null;
    /** repair D-9 - may change the farm setup on this farm (absent = yes). */
    canEdit?: boolean;
}

/**
 * Repair FIX-1 round 1 (Bug 5, CTO ruling: English mode is English only on this page) — the timetable's words, one
 * language at a time. Marathi exactly as before; English PROPOSED (English).
 */
const POWER_WORDS = {
    mr: {
        hint: { singlePhase: 'घर आणि लहान पंपासाठी', threePhase: 'मोठ्या मोटरसाठी' } as Record<PhaseKey, string>,
        strip: ['रात्री 12', 'सकाळी 6', 'दुपारी 12', 'संध्या 6', 'रात्री 12'],
        on: 'वीज असते', off: 'वीज जाते', noCut: 'रोज वीज जात नाही (24 तास)', whenOff: 'वीज रोज कधी जाते?',
        from: 'पासून (वीज जाते)', until: 'पर्यंत (वीज येते)', onBetween: (from: string, to: string) => `वीज असते: ${from} ते ${to}`,
        weekA: 'आठवडा अ', weekB: 'आठवडा ब', alternate: 'दर दुसऱ्या आठवड्याला वेळ बदलते (आठवडा अ / ब)',
        fixFirst: 'वेळ दुरुस्त करा, मग जतन करा.', saved: 'वीज वेळ जतन झाली ✓', putBack: 'पूर्वीसारखं केलं',
        reset: 'पूर्वीसारखं करा', save: 'जतन करा',
    },
    en: {
        hint: { singlePhase: 'For the house and small pumps', threePhase: 'For big motors' } as Record<PhaseKey, string>,
        strip: ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'],
        on: 'Power on', off: 'Power off', noCut: 'No power cut (24 hours)', whenOff: 'When does the power go each day?',
        from: 'From (power goes)', until: 'Until (power comes)', onBetween: (from: string, to: string) => `Power on: ${from} to ${to}`,
        weekA: 'Week A', weekB: 'Week B', alternate: 'The times change every other week (week A / B)',
        fixFirst: 'Fix the times, then save.', saved: 'Power times saved ✓', putBack: 'Put back as before',
        reset: 'Undo changes', save: 'Save',
    },
};
type PowerWords = typeof POWER_WORDS.mr;

/** 24 hours as a strip: green = power on, red = power off. */
const DayStrip: React.FC<{ windows: ElectricityOffWindow[]; testId: string; words: PowerWords }> = ({ windows, testId, words }) => (
    <div data-testid={testId} aria-hidden="true">
        <div className="flex h-5 overflow-hidden rounded-full ring-1 ring-stone-200">
            {Array.from({ length: 24 }, (_, h) => (
                <span key={h} data-off={offAtHour(windows, h)}
                    className={`flex-1 ${offAtHour(windows, h) ? 'bg-rose-400' : 'bg-emerald-400'} ${h % 6 === 0 && h ? 'border-l border-white/70' : ''}`} />
            ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-bold text-stone-500">{words.strip.map((label, i) => <span key={i}>{label}</span>)}</div>
    </div>
);

const TimeBox: React.FC<{ label: string; value: string; onChange: (v: string) => void; testId: string; language?: string | null }> = ({ label, value, onChange, testId, language }) => (
    <label className="block min-w-0 flex-1">
        <span className="block text-[12.5px] font-extrabold text-stone-600">{label}</span>
        <input type="time" value={value} onChange={e => onChange(e.target.value)} data-testid={testId}
            className="mt-1 min-h-[50px] w-full rounded-xl bg-white px-2 text-[18px] font-extrabold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500" />
        <span className="mt-0.5 block text-[12.5px] font-bold text-stone-500">{farmerClock(value, language)}</span>
    </label>
);

interface WeekEditorProps {
    /** repair D-9 - a reader: the hours and the strip only, no switch or time box. */
    readOnly?: boolean;
    id: string;
    title?: string;
    windows: ElectricityOffWindow[];
    summary: WeekSummary;
    onNoCut: (noCut: boolean) => void;
    onTime: (field: 'startTime' | 'endTime', value: string) => void;
    words: PowerWords;
    language?: string | null;
}

const WeekEditor: React.FC<WeekEditorProps> = ({ id, title, windows, summary, onNoCut, onTime, words, language, readOnly = false }) => {
    const window = windows[0];
    return (
        <div className="space-y-2.5 rounded-2xl bg-stone-50/80 p-2.5 ring-1 ring-stone-200" data-testid={`week-${id}`}>
            {title && <p className="m-0 text-[15px] font-extrabold text-stone-800">{title}</p>}
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-50 p-2 ring-1 ring-emerald-100">
                    <p className="m-0 text-[12.5px] font-extrabold text-emerald-800">{words.on}</p>
                    <p className="m-0 text-[18px] font-extrabold text-stone-900" data-testid={`on-${id}`}>{formatHours(summary.onMinutes, language)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-2 ring-1 ring-rose-100">
                    <p className="m-0 text-[12.5px] font-extrabold text-rose-800">{words.off}</p>
                    <p className="m-0 text-[18px] font-extrabold text-stone-900" data-testid={`off-${id}`}>{formatHours(summary.offMinutes, language)}</p>
                </div>
            </div>
            <DayStrip windows={windows} testId={`strip-${id}`} words={words} />
            {readOnly
                ? <p className="m-0 text-[13.5px] font-bold text-stone-600">{window ? words.onBetween(farmerClock(window.endTime, language), farmerClock(window.startTime, language)) : words.noCut}</p>
                : <SwitchRow on={windows.length === 0} onChange={onNoCut} testId={`nocut-${id}`} label={words.noCut} />}
            {window && !readOnly && (
                <>
                    <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{words.whenOff}</p>
                    <div className="flex gap-2">
                        <TimeBox label={words.from} value={window.startTime || '12:00'} onChange={v => onTime('startTime', v)} testId={`start-${id}`} language={language} />
                        <TimeBox label={words.until} value={window.endTime || '18:00'} onChange={v => onTime('endTime', v)} testId={`end-${id}`} language={language} />
                    </div>
                    {summary.error
                        ? <p className="m-0 rounded-xl bg-rose-50 p-2 text-[13.5px] font-extrabold text-rose-700" data-testid={`error-${id}`}>{timeErrorText(summary.error, language)}</p>
                        : <p className="m-0 text-[13.5px] font-bold text-stone-600">{words.onBetween(farmerClock(window.endTime, language), farmerClock(window.startTime, language))}</p>}
                </>
            )}
        </div>
    );
};

const ElectricityTimingConfigurator: React.FC<ElectricityTimingConfiguratorProps> = ({ profile, onUpdate, farmSetup, canEdit = true }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? POWER_WORDS.en : POWER_WORDS.mr;
    const server = farmSetup?.received ? farmSetup : null;
    const farmPower = server?.powerTimes ?? null;
    const readOnly = !!server && !canEdit;
    /** What the page starts from: the farm's timetable (repair D-9), or the phone's own. */
    const source: ElectricityTimingConfiguration | undefined = server ? farmPower?.item.timetable : profile.electricityTiming;
    const [draft, setDraft] = useState<ElectricityTimingConfiguration>(() => normalizeConfig(source));
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState('');
    /** The farm's timetable is read again when the farm, its revision or its waiting change moves; the phone's when the profile's moves. */
    const sourceKey: unknown = server
        ? `${server.farmId}:${farmPower?.item.revision ?? 0}:${farmPower?.state ?? 'none'}:${farmPower?.item.updatedAtUtc ?? ''}`
        : profile.electricityTiming;

    useEffect(() => {
        setDraft(normalizeConfig(source));
        setDirty(false);
        setMessage('');
        // `source` is read through `sourceKey` (a new object on every render of the farm's set)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceKey]);

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
            if (aError) list.push(`${phaseTitle(phase, language)}${draft[phase].alternateWeeklyPattern ? ` · ${words.weekA}` : ''}: ${timeErrorText(aError, language)}`);
            if (draft[phase].alternateWeeklyPattern) {
                const bError = summaries[phase].B.error;
                if (bError) list.push(`${phaseTitle(phase, language)} · ${words.weekB}: ${timeErrorText(bError, language)}`);
            }
        });
        return list;
    }, [draft, summaries, language, words]);

    const hasErrors = errors.length > 0;

    const save = async () => {
        if (hasErrors) {
            setMessage(words.fixFirst);
            return;
        }
        if (server) {
            // repair D-9: the farm's timetable, whole; its waiting line says it has not reached the server yet (no "saved" while only queued)
            try {
                await setPowerTimes({ farmId: server.farmId, timetable: { singlePhase: draft.singlePhase, threePhase: draft.threePhase } });
            } catch (error) {
                const said = saveProblemWords(error, language);
                if (!said) throw error;
                setMessage(said);
                return;
            }
            setDirty(false);
            setMessage('');
            return;
        }
        const now = systemClock.nowISO();
        // savedByFarmerAt: the hub's वीज step reads पूर्ण only from a real save (repair FIX-1 item 3).
        onUpdate({ ...profile, electricityTiming: { ...draft, updatedAt: now, savedByFarmerAt: now } });
        setDirty(false);
        setMessage(words.saved);
    };

    const reset = () => {
        setDraft(normalizeConfig(source));
        setDirty(false);
        setMessage(words.putBack);
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
                            {phaseTitle(phase, language)}
                        </p>
                        <p className="m-0 mt-0.5 text-[13px] font-semibold text-stone-500">{words.hint[phase]}</p>
                        <div className="mt-2.5 space-y-2.5">
                            <WeekEditor id={`${phase}-A`} title={alternate ? words.weekA : undefined} readOnly={readOnly}
                                windows={phaseData.weekAOffWindows} summary={summaries[phase].A} words={words} language={language}
                                onNoCut={v => setNoPowerCut(phase, 'A', v)} onTime={(f, v) => setWeekTime(phase, 'A', f, v)} />
                            {!readOnly && <SwitchRow on={alternate} onChange={v => setAlternateWeek(phase, v)} testId={`alternate-${phase}`}
                                label={words.alternate} />}
                            {alternate && (
                                <WeekEditor id={`${phase}-B`} title={words.weekB} readOnly={readOnly}
                                    windows={weekWindows(phaseData, 'B')} summary={summaries[phase].B} words={words} language={language}
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

            {farmPower?.state === 'waiting' && <WaitingLine language={language} />}
            {farmPower?.refusal && <RefusedBox refusal={farmPower.refusal} language={language}
                onSeeNew={() => { void closeRefusedChange(farmPower.refusal!.rowId); }}
                onRedo={readOnly ? undefined : () => {
                    const typed = farmPower.refusal!.payload.timetable as ElectricityTimingConfiguration | undefined;
                    void closeRefusedChange(farmPower.refusal!.rowId).then(() => { setDraft(normalizeConfig(typed)); setDirty(true); });
                }} />}

            {!readOnly && <div className="grid grid-cols-2 gap-2">
                <Tap onClick={reset} disabled={!dirty} data-testid="power-reset"
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full bg-white text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300 disabled:opacity-40">
                    <RotateCcw size={18} aria-hidden="true" />{words.reset}
                </Tap>
                <Tap onClick={() => { void save(); }} disabled={!dirty || hasErrors} data-testid="power-save" rippleColor="rgba(255,255,255,0.35)"
                    className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full bg-emerald-700 text-[15px] font-extrabold text-white disabled:opacity-40">
                    <Save size={18} aria-hidden="true" />{words.save}
                </Tap>
            </div>}

            {message && (
                <p className={`m-0 text-center text-[14px] font-extrabold ${hasErrors ? 'text-rose-700' : 'text-emerald-800'}`} role="status" data-testid="power-msg">
                    {message}
                </p>
            )}
        </div>
    );
};

export default ElectricityTimingConfigurator;
