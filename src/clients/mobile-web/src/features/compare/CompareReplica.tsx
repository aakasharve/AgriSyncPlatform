/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — "शेड्यूलवर तुमचं काम": the old page's
 * schedule replica (this phase, day by day, with what was done, still open, planned and extra on the exact
 * day), kept and folded, in Marathi. It used the scheduler's `DayCard`, whose cells are buttons that did
 * nothing here and whose labels are English ("DAY", "DONE", "STD"); a plain read-only row replaces it, so
 * nothing on this list looks tappable (P5). Same data: `CompareReport.scheduleDays` / `compactScheduleDays`.
 * Every Marathi string here is PROPOSED (Marathi).
 */
import React, { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import { GlassCard, Tap } from '../../shared/components/ui/placeUi';
import type { BlockStatus } from '../scheduler/components/DayCard';
import { CATEGORY_META, type CompareReport, type ScheduleReplicaDay } from './comparePageHelpers';

const CELL: Record<BlockStatus, string> = {
    DONE: 'bg-emerald-100 text-emerald-900',
    MISSED: 'bg-amber-100 text-amber-900',
    PENDING: 'bg-amber-50 text-amber-800',
    PLANNED: 'bg-stone-100 text-stone-700',
    NOT_REQUIRED: 'bg-white text-stone-300',
};

const COLUMNS = [
    { key: 'irrigation', label: CATEGORY_META.IRRIGATION.shortLabel },
    { key: 'nutrition', label: CATEGORY_META.NUTRITION.shortLabel },
    { key: 'spray', label: CATEGORY_META.SPRAY.shortLabel },
    { key: 'activity', label: CATEGORY_META.ACTIVITY.shortLabel },
] as const;

const DayRow: React.FC<{ day: ScheduleReplicaDay }> = ({ day }) => (
    <div className={`border-b border-stone-200 last:border-b-0 ${day.isToday ? 'bg-emerald-50/50' : ''}`} data-testid={`replica-day-${day.dayNumber}`}>
        <div className="flex items-stretch">
            <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-stone-200 py-1.5">
                <span className="text-[11px] font-bold text-stone-500">{day.isToday ? 'आज' : 'दिवस'}</span>
                <span className="text-[18px] font-extrabold leading-none text-stone-900">{day.dayNumber}</span>
                <span className="text-[11px] font-bold text-stone-500">{day.dateLabel}</span>
            </div>
            <div className="grid flex-1 grid-cols-4 gap-1 p-1">
                {COLUMNS.map(col => (
                    <div key={col.key} className={`flex min-h-[40px] items-center justify-center rounded-lg px-1 text-center text-[11.5px] font-bold leading-tight ${CELL[day.status[col.key]]}`}>
                        {day.notes[col.key] ?? ''}
                    </div>
                ))}
            </div>
        </div>
        {(day.missedEntries.length > 0 || day.extraEntries.length > 0) && (
            <div className="space-y-0.5 border-t border-stone-100 bg-stone-50/70 px-3 py-1.5 pl-[4.5rem]">
                {day.missedEntries.map((entry, i) => <p key={`m${i}`} className="m-0 text-[12px] font-bold text-amber-800">○ {entry}</p>)}
                {day.extraEntries.map((entry, i) => <p key={`e${i}`} className="m-0 text-[12px] font-bold text-blue-700">+ {entry}</p>)}
            </div>
        )}
    </div>
);

export const CompareReplica: React.FC<{ report: CompareReport; plotId: string }> = ({ report, plotId }) => {
    const [open, setOpen] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const days = showAll ? report.scheduleDays : report.compactScheduleDays;
    return (
        <GlassCard testId={`compare-replica-${plotId}`}>
            <Tap onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`compare-replica-toggle-${plotId}`}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left">
                <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[16px] font-extrabold text-stone-900"><CalendarDays size={18} aria-hidden="true" />शेड्यूलवर तुमचं काम</span>
                    <span className="block text-[13px] font-semibold text-stone-600">या टप्प्याचे दिवस {report.stageStartDay + 1} ते {report.stageEndDay + 1} — रोज काय ठरलं, काय झालं</span>
                </span>
                {open ? <ChevronUp size={20} className="shrink-0 text-stone-600" aria-hidden="true" /> : <ChevronDown size={20} className="shrink-0 text-stone-600" aria-hidden="true" />}
            </Tap>
            {open && (
                <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">झालं</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">अजून नोंद नाही</span>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">+ जास्तीचं</span>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">पुढे ठरलेलं</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <p className="m-0 text-[12.5px] font-bold text-stone-600" data-testid={`compare-replica-count-${plotId}`}>{days.length} दिवस दाखवले</p>
                        <Tap onClick={() => setShowAll(s => !s)} data-testid={`compare-replica-all-${plotId}`}
                            className="min-h-[40px] rounded-full bg-stone-100 px-3 text-[13px] font-extrabold text-stone-700">
                            {showAll ? 'थोडक्यात दाखवा' : 'सगळे दिवस दाखवा'}
                        </Tap>
                    </div>
                    <div className="max-h-[58vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white">
                        <div className="sticky top-0 z-10 flex border-b border-stone-300 bg-stone-50 py-1.5 text-[11.5px] font-extrabold text-stone-600">
                            <div className="w-16 shrink-0 text-center">दिवस</div>
                            <div className="grid flex-1 grid-cols-4 text-center">{COLUMNS.map(c => <span key={c.key}>{c.label}</span>)}</div>
                        </div>
                        {days.map(day => <DayRow key={day.key} day={day} />)}
                    </div>
                </div>
            )}
        </GlassCard>
    );
};
