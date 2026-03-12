import React, { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import {
    FarmerProfile,
    ElectricityTimingConfiguration,
    ElectricityPhaseSchedule,
    ElectricityOffWindow
} from '../../../types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';

type PhaseKey = 'singlePhase' | 'threePhase';
type WeekKey = 'A' | 'B';

interface WeekSummary {
    offMinutes: number;
    onMinutes: number;
    error: string | null;
}

interface ElectricityTimingConfiguratorProps {
    profile: FarmerProfile;
    onUpdate: (profile: FarmerProfile) => void;
}

const DAY_MINUTES = 24 * 60;

const defaultOffWindow = (): ElectricityOffWindow => ({
    id: `off_${idGenerator.generate()}`,
    startTime: '12:00',
    endTime: '18:00',
    repeatRule: 'DAILY',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
});

const parseMinutes = (time: string): number | null => {
    const [hStr, mStr] = time.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return (h * 60) + m;
};

const format12h = (time: string): string => {
    const mins = parseMinutes(time);
    if (mins === null) return time;
    const h24 = Math.floor(mins / 60);
    const mm = mins % 60;
    const suffix = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${mm.toString().padStart(2, '0')} ${suffix}`;
};

const formatHours = (minutes: number): string => {
    const hours = minutes / 60;
    const text = Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1);
    return `${text} hrs/day`;
};

const summarizeWeek = (windows: ElectricityOffWindow[]): WeekSummary => {
    if (windows.length === 0) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: null };
    }

    const window = windows[0];
    const start = parseMinutes(window.startTime);
    const end = parseMinutes(window.endTime);
    if (start === null || end === null) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: 'Invalid time format.' };
    }
    if (start === end) {
        return { offMinutes: 0, onMinutes: DAY_MINUTES, error: 'Start and end cannot be same.' };
    }

    const offMinutes = start < end ? (end - start) : ((DAY_MINUTES - start) + end);
    return {
        offMinutes,
        onMinutes: DAY_MINUTES - offMinutes,
        error: null
    };
};

const normalizeWindow = (window?: ElectricityOffWindow): ElectricityOffWindow | null => {
    if (!window) return null;
    return {
        id: window.id || `off_${idGenerator.generate()}`,
        startTime: window.startTime || '12:00',
        endTime: window.endTime || '18:00',
        repeatRule: 'DAILY',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    };
};

const normalizePhase = (phase?: ElectricityPhaseSchedule): ElectricityPhaseSchedule => {
    const weekA = normalizeWindow(phase?.weekAOffWindows?.[0]);
    const weekB = normalizeWindow(phase?.weekBOffWindows?.[0]);
    const alternate = Boolean(phase?.alternateWeeklyPattern || phase?.patternMode === 'ROTATIONAL');
    return {
        patternMode: alternate ? 'ROTATIONAL' : 'FIXED_WEEKLY',
        alternateWeeklyPattern: alternate,
        weekAOffWindows: weekA ? [weekA] : [],
        weekBOffWindows: weekB ? [weekB] : []
    };
};

const normalizeConfig = (config?: ElectricityTimingConfiguration): ElectricityTimingConfiguration => ({
    singlePhase: normalizePhase(config?.singlePhase),
    threePhase: normalizePhase(config?.threePhase),
    updatedAt: config?.updatedAt
});

const phaseTitle = (phase: PhaseKey): string => phase === 'singlePhase' ? 'Single Phase' : 'Three Phase';

const weekLabel = (phase: ElectricityPhaseSchedule, week: WeekKey): string => {
    const windows = week === 'A' ? phase.weekAOffWindows : (phase.weekBOffWindows || []);
    if (windows.length === 0) return '24h available';
    const window = windows[0];
    return `OFF ${format12h(window.startTime)} - ${format12h(window.endTime)}`;
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
        setDraft(prev => ({
            ...prev,
            [phase]: updater(prev[phase]),
            updatedAt: systemClock.nowISO()
        }));
        setDirty(true);
        setMessage('');
    };

    const setNoPowerCut = (phase: PhaseKey, week: WeekKey, noPowerCut: boolean) => {
        updatePhase(phase, current => {
            const nextWindows = noPowerCut ? [] : [defaultOffWindow()];
            if (week === 'A') return { ...current, weekAOffWindows: nextWindows };
            return { ...current, weekBOffWindows: nextWindows };
        });
    };

    const setWeekTime = (phase: PhaseKey, week: WeekKey, field: 'startTime' | 'endTime', value: string) => {
        updatePhase(phase, current => {
            const currentWindows = week === 'A' ? current.weekAOffWindows : (current.weekBOffWindows || []);
            const base = currentWindows[0] || defaultOffWindow();
            const updated = [{ ...base, [field]: value }];
            if (week === 'A') return { ...current, weekAOffWindows: updated };
            return { ...current, weekBOffWindows: updated };
        });
    };

    const setAlternateWeek = (phase: PhaseKey, enabled: boolean) => {
        updatePhase(phase, current => ({
            ...current,
            patternMode: enabled ? 'ROTATIONAL' : 'FIXED_WEEKLY',
            alternateWeeklyPattern: enabled,
            weekBOffWindows: enabled ? current.weekBOffWindows : []
        }));
    };

    const summaries = useMemo(() => ({
        singlePhase: {
            weekA: summarizeWeek(draft.singlePhase.weekAOffWindows),
            weekB: summarizeWeek(draft.singlePhase.weekBOffWindows || [])
        },
        threePhase: {
            weekA: summarizeWeek(draft.threePhase.weekAOffWindows),
            weekB: summarizeWeek(draft.threePhase.weekBOffWindows || [])
        }
    }), [draft]);

    const errors = useMemo(() => {
        const list: string[] = [];
        (['singlePhase', 'threePhase'] as PhaseKey[]).forEach(phase => {
            const aError = summaries[phase].weekA.error;
            if (aError) list.push(`${phaseTitle(phase)} Week A: ${aError}`);
            if (draft[phase].alternateWeeklyPattern) {
                const bError = summaries[phase].weekB.error;
                if (bError) list.push(`${phaseTitle(phase)} Week B: ${bError}`);
            }
        });
        return list;
    }, [draft, summaries]);

    const hasErrors = errors.length > 0;

    const save = () => {
        if (hasErrors) {
            setMessage('Fix invalid times before saving.');
            return;
        }
        onUpdate({
            ...profile,
            electricityTiming: {
                ...draft,
                updatedAt: systemClock.nowISO()
            }
        });
        setDirty(false);
        setMessage('Electricity timing saved.');
    };

    const reset = () => {
        setDraft(normalizeConfig(profile.electricityTiming));
        setDirty(false);
        setMessage('Draft reset.');
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
            <div className="flex items-center gap-2">
                <Zap size={18} className="text-amber-500" />
                <div>
                    <h4 className="font-bold text-slate-800">Electricity Timing</h4>
                    <p className="text-xs text-slate-500">Simple setup: set OFF time for Week A and optional Week B.</p>
                </div>
            </div>

            {(['singlePhase', 'threePhase'] as PhaseKey[]).map(phase => {
                const phaseData = draft[phase];
                const weekAWindow = phaseData.weekAOffWindows[0];
                const weekBWindow = phaseData.weekBOffWindows?.[0];
                const weekASummary = summaries[phase].weekA;
                const weekBSummary = summaries[phase].weekB;

                return (
                    <div key={phase} className="rounded-xl border border-slate-200 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="font-bold text-slate-800">{phaseTitle(phase)}</p>
                            <div className="text-right text-xs text-slate-500">
                                <p>Week A: {weekLabel(phaseData, 'A')}</p>
                                {phaseData.alternateWeeklyPattern && <p>Week B: {weekLabel(phaseData, 'B')}</p>}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                                <p className="text-emerald-700 font-bold">Available</p>
                                <p className="text-slate-700">{formatHours(weekASummary.onMinutes)}</p>
                            </div>
                            <div className="rounded-lg bg-red-50 border border-red-100 p-2">
                                <p className="text-red-700 font-bold">Load Shedding</p>
                                <p className="text-slate-700">{formatHours(weekASummary.offMinutes)}</p>
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 p-2 space-y-2">
                            <p className="text-xs font-bold text-slate-600">Week A</p>
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={phaseData.weekAOffWindows.length === 0}
                                    onChange={e => setNoPowerCut(phase, 'A', e.target.checked)}
                                    className="rounded border-slate-300"
                                />
                                No daily power cut (24h available)
                            </label>
                            {phaseData.weekAOffWindows.length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="time"
                                        value={weekAWindow?.startTime || '12:00'}
                                        onChange={e => setWeekTime(phase, 'A', 'startTime', e.target.value)}
                                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                    />
                                    <input
                                        type="time"
                                        value={weekAWindow?.endTime || '18:00'}
                                        onChange={e => setWeekTime(phase, 'A', 'endTime', e.target.value)}
                                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                    />
                                </div>
                            )}
                        </div>

                        <label className="flex items-center gap-2 text-xs text-slate-600">
                            <input
                                type="checkbox"
                                checked={phaseData.alternateWeeklyPattern}
                                onChange={e => setAlternateWeek(phase, e.target.checked)}
                                className="rounded border-slate-300"
                            />
                            Use alternate weekly pattern (Week B)
                        </label>

                        {phaseData.alternateWeeklyPattern && (
                            <div className="rounded-lg border border-slate-200 p-2 space-y-2">
                                <p className="text-xs font-bold text-slate-600">Week B</p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                                        <p className="text-emerald-700 font-bold">Available</p>
                                        <p className="text-slate-700">{formatHours(weekBSummary.onMinutes)}</p>
                                    </div>
                                    <div className="rounded-lg bg-red-50 border border-red-100 p-2">
                                        <p className="text-red-700 font-bold">Load Shedding</p>
                                        <p className="text-slate-700">{formatHours(weekBSummary.offMinutes)}</p>
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={(phaseData.weekBOffWindows?.length ?? 0) === 0}
                                        onChange={e => setNoPowerCut(phase, 'B', e.target.checked)}
                                        className="rounded border-slate-300"
                                    />
                                    No daily power cut (24h available)
                                </label>
                                {(phaseData.weekBOffWindows?.length ?? 0) > 0 && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            type="time"
                                            value={weekBWindow?.startTime || '12:00'}
                                            onChange={e => setWeekTime(phase, 'B', 'startTime', e.target.value)}
                                            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                        />
                                        <input
                                            type="time"
                                            value={weekBWindow?.endTime || '18:00'}
                                            onChange={e => setWeekTime(phase, 'B', 'endTime', e.target.value)}
                                            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {hasErrors && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                    {errors.map(error => <p key={error}>{error}</p>)}
                </div>
            )}

            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={reset}
                    disabled={!dirty}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 disabled:opacity-50"
                >
                    Reset
                </button>
                <button
                    onClick={save}
                    disabled={!dirty || hasErrors}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50"
                >
                    Save
                </button>
            </div>

            {message && (
                <p className={`text-xs font-bold ${hasErrors ? 'text-red-600' : 'text-emerald-600'}`}>
                    {message}
                </p>
            )}
        </div>
    );
};

export default ElectricityTimingConfigurator;
