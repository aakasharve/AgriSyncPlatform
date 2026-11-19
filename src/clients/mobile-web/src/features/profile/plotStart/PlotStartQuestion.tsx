/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
 *
 * The add-plot wizard's one required question on step 3: "ही लागवड केव्हा केली?" - two big choices ("आज", "आधी केली" with a date picker),
 * nothing pre-selected; under it the live day count ("आज दिवस N", the schedule tab's own count); under that a plain card saying which
 * checked schedule will follow by itself - or, for a crop with none, that the plot is made without one. The state lives in the wizard;
 * this is the picture of it.
 */
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, BadgeCheck, CalendarDays } from 'lucide-react';
import { scheduleNameMr } from '../../scheduler/schedulePage/scheduleNames';
import type { CheckedScheduleForCrop, PlantingDateProblem, PlantingWordKey } from './plotStartChoice';
import { plotStartWords } from './plotStartCopy';

export type PlotStartMode = 'today' | 'earlier' | null;

interface PlotStartQuestionProps {
    language: string;
    wordKey: PlantingWordKey;
    mode: PlotStartMode;
    onMode: (mode: Exclude<PlotStartMode, null>) => void;
    /** The picked day while "आधी केली" is on (YYYY-MM-DD, '' until he picks). */
    earlierKey: string;
    onEarlierKey: (key: string) => void;
    minKey: string;
    maxKey: string;
    problem: PlantingDateProblem | null;
    /** Today's day number once a usable date is chosen; `null` until then. */
    dayCount: number | null;
    /** The crop's checked schedule, or `null` when the crop has none. */
    checked: CheckedScheduleForCrop | null;
}

const choiceClass = (on: boolean) =>
    `min-h-[56px] rounded-2xl border-2 px-3 py-2 text-[18px] font-extrabold transition-colors ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-white text-slate-800'}`;

const PlotStartQuestion: React.FC<PlotStartQuestionProps> = ({
    language, wordKey, mode, onMode, earlierKey, onEarlierKey, minKey, maxKey, problem, dayCount, checked,
}) => {
    const words = plotStartWords(language, wordKey);
    const dateRef = useRef<HTMLInputElement>(null);

    // "आधी केली" opens the phone's own date picker at once (a browser that will not just shows the field).
    useEffect(() => {
        if (mode !== 'earlier') return;
        try {
            dateRef.current?.showPicker?.();
        } catch {
            // no user activation or no showPicker: the field is on screen, he taps it
        }
    }, [mode]);

    return (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3" data-testid="plot-start-section">
            <p className="m-0 text-[18px] font-extrabold leading-snug text-slate-900" data-testid="plot-start-question">
                {words.question} <span aria-hidden="true">*</span>
            </p>

            <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => onMode('today')} aria-pressed={mode === 'today'} data-testid="plot-start-today" className={choiceClass(mode === 'today')}>
                    {words.today}
                </button>
                <button type="button" onClick={() => onMode('earlier')} aria-pressed={mode === 'earlier'} data-testid="plot-start-earlier" className={choiceClass(mode === 'earlier')}>
                    {words.earlier}
                </button>
            </div>

            {mode === 'earlier' && (
                <label className="flex min-h-[52px] items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-300">
                    <CalendarDays size={20} className="shrink-0 text-slate-500" aria-hidden="true" />
                    <input
                        ref={dateRef}
                        type="date"
                        value={earlierKey}
                        min={minKey}
                        max={maxKey}
                        onChange={e => onEarlierKey(e.target.value)}
                        aria-label={words.dateLabel}
                        data-testid="plot-start-date"
                        className="min-h-[48px] min-w-0 flex-1 bg-transparent text-[17px] font-bold text-slate-900 outline-none"
                    />
                </label>
            )}

            {problem && (
                <p role="alert" className="m-0 flex items-center gap-1.5 text-[14px] font-bold text-red-700" data-testid="plot-start-problem">
                    <AlertTriangle size={16} aria-hidden="true" /> {words.problem(problem)}
                </p>
            )}

            {dayCount !== null && (
                <p className="m-0 text-[17px] font-black text-emerald-800" data-testid="plot-start-day">{words.dayToday(dayCount)}</p>
            )}

            {checked ? (
                <div className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-emerald-200" data-testid="plot-start-schedule">
                    <BadgeCheck size={22} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div className="min-w-0">
                        <p className="m-0 text-[16px] font-extrabold text-slate-900">{words.scheduleTitle}</p>
                        <p className="m-0 mt-0.5 text-[15px] font-bold text-slate-800">{language === 'en' ? checked.name : scheduleNameMr(checked.name)}</p>
                        <p className="m-0 text-[14px] font-bold text-emerald-700">{words.checkedBy}</p>
                        <p className="m-0 mt-1 text-[14px] font-semibold text-slate-600">{words.changeLater}</p>
                    </div>
                </div>
            ) : (
                <p className="m-0 rounded-xl bg-amber-50 p-3 text-[15px] font-bold text-amber-900 ring-1 ring-amber-200" data-testid="plot-start-no-schedule">{words.noChecked}</p>
            )}
        </div>
    );
};

export default PlotStartQuestion;
