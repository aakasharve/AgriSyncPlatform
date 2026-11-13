/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — one लक्ष द्या row, with the next step
 * on it (D-1: "Each item should open the exact place where the farmer can act"):
 *
 *   आठवण (a reminder from the to-do store) → "झाले" (done, in the same store: it leaves करायची कामे too) or
 *                                            "वेळ बदला" (आज / उद्या / पुढच्या आठवड्यात, same store);
 *   शेड्यूलचे काम (a server step)          → "काम नोंदवा" (the recorder, on that plot) or "पुढे ठरवा"
 *                                            (उद्या / परवा / पुढच्या आठवड्यात — the server keeps the move).
 *
 * A button is drawn only when the page gives it somewhere to go (P5): no "पुढे ठरवा" for a person the farm has
 * not given planning to, no "झाले" on a reminder this phone's store does not hold. Opening the recorder clears
 * nothing — a step leaves only when the server matches recorded work to it, or after a confirmed move.
 * Every Marathi string is PROPOSED.
 */
import React, { useState } from 'react';
import { Bell, CalendarClock, Check, ClipboardCheck, Mic } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import type { TodoItem, TodoWhen } from '../../reflect/overview/todoModel';
import type { ScheduledWorkItem } from '../scheduledWork';
import { ReminderCardLines } from '../../plannedWork/reminders/ReminderCardLines';
import { reminderTitleIn } from '../../plannedWork/reminders/reminderModel';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

type Tone = 'late' | 'today' | 'decide';

const RING: Record<Tone, string> = {
    late: 'bg-rose-50/70 ring-rose-200',
    today: 'bg-amber-50/60 ring-amber-200',
    decide: 'bg-white ring-stone-200',
};
const DUE: Record<Tone, string> = { late: 'text-rose-700', today: 'text-amber-800', decide: 'text-stone-600' };

const ActionButton: React.FC<{ onClick: () => void; testId: string; primary?: boolean; disabled?: boolean; children: React.ReactNode }> = ({ onClick, testId, primary, disabled, children }) => (
    <Tap onClick={onClick} disabled={disabled} data-testid={testId}
        className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[14.5px] font-extrabold disabled:opacity-50 ${primary ? 'bg-emerald-700 text-white' : 'border-2 border-emerald-600 bg-white text-emerald-800'}`}>
        {children}
    </Tap>
);

const Choices: React.FC<{ options: readonly { key: string; label: string }[]; onPick: (key: string) => void; testId: string; disabled?: boolean }> = ({ options, onPick, testId, disabled }) => (
    <div className="mt-2 flex flex-wrap gap-2" data-testid={testId}>
        {options.map(o => (
            <Tap key={o.key} onClick={() => onPick(o.key)} disabled={disabled} data-testid={`${testId}-${o.key}`}
                className="min-h-[42px] rounded-full bg-stone-100 px-3.5 text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300 disabled:opacity-50">
                {o.label}
            </Tap>
        ))}
    </div>
);

const Shell: React.FC<{ tone: Tone; testId: string; icon: React.ReactNode; title: string; place?: string; placeColor?: string; kind: string; due: string; children: React.ReactNode }> = ({ tone, testId, icon, title, place, placeColor, kind, due, children }) => (
    <div data-testid={testId} className={`rounded-2xl px-3 py-2.5 ring-1 ${RING[tone]}`}>
        <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
                <p className="m-0 text-[16px] font-extrabold leading-snug text-stone-900">{title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold">
                    {place && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-stone-700 ring-1 ring-stone-200">
                            {placeColor && <span className={`h-2 w-2 rounded-full ${placeColor}`} aria-hidden="true" />}{place}
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-stone-500">{icon}{kind}</span>
                </div>
            </div>
            <span className={`shrink-0 pt-1 text-[12.5px] font-extrabold ${DUE[tone]}`}>{due}</span>
        </div>
        {children}
    </div>
);

const REMINDER_WHEN: readonly { key: TodoWhen; label: string }[] = [
    { key: 'today', label: 'आज' },
    { key: 'tomorrow', label: 'उद्या' },
    { key: 'next_week', label: 'पुढच्या आठवड्यात' },
];

export const ReminderRow: React.FC<{
    t: TodoItem;
    tone: 'late' | 'today';
    onDone?: (t: TodoItem) => void;
    onMove?: (t: TodoItem, when: TodoWhen) => void;
}> = ({ t, tone, onDone, onMove }) => {
    const [choosing, setChoosing] = useState(false);
    const canChange = t.canToggle;
    const language = useOptionalLanguage()?.language;
    return (
        <Shell tone={tone} testId={`attention-reminder-${t.id}`} title={reminderTitleIn(t.task, language) || t.title} place={t.place?.label} placeColor={t.place?.color}
            icon={t.kindLabel === 'आठवण' ? <Bell size={13} aria-hidden="true" /> : <ClipboardCheck size={13} aria-hidden="true" />}
            kind={t.kindLabel} due={toDevanagariDigits(t.dueText)}>
            {/* Lane REM-1: who made it and when, where it came from, "ऐका" / the rule lines - only what the server said. */}
            <ReminderCardLines task={t.task} placeLabel={t.place?.label} testIdPrefix="attention" />
            {canChange && (onDone || onMove) && (
                <div className="mt-2 flex gap-2">
                    {onDone && <ActionButton primary onClick={() => onDone(t)} testId={`attention-done-${t.id}`}><Check size={18} strokeWidth={3} aria-hidden="true" />झाले</ActionButton>}
                    {onMove && <ActionButton onClick={() => setChoosing(c => !c)} testId={`attention-move-${t.id}`}><CalendarClock size={18} aria-hidden="true" />वेळ बदला</ActionButton>}
                </div>
            )}
            {choosing && onMove && (
                <Choices options={REMINDER_WHEN.filter(o => !(tone === 'today' && o.key === 'today'))} testId={`attention-move-choices-${t.id}`}
                    onPick={key => { setChoosing(false); onMove(t, key as TodoWhen); }} />
            )}
        </Shell>
    );
};

/** "पुढे ठरवा" choices: days from today. */
export const STEP_MOVE_DAYS: readonly { key: string; days: number; label: string }[] = [
    { key: 'tomorrow', days: 1, label: 'उद्या' },
    { key: 'day_after', days: 2, label: 'परवा' },
    { key: 'next_week', days: 7, label: 'पुढच्या आठवड्यात' },
];

export const StepRow: React.FC<{
    step: ScheduledWorkItem;
    label: string;
    dueText: string;
    tone: Tone;
    onRecord?: (step: ScheduledWorkItem) => void;
    /** Resolves when the server confirmed the move; rejects when it did not. */
    onMove?: (step: ScheduledWorkItem, days: number) => Promise<void>;
}> = ({ step, label, dueText, tone, onRecord, onMove }) => {
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const id = step.plannedActivityId;
    const move = (days: number) => {
        if (!onMove) return;
        setBusy(true);
        setFailed(false);
        onMove(step, days)
            .then(() => setChoosing(false))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
    };
    return (
        <Shell tone={tone} testId={`attention-step-${id}`} title={label} place={step.plotName || undefined}
            icon={<ClipboardCheck size={13} aria-hidden="true" />} kind="शेड्यूलचे काम" due={dueText}>
            {(onRecord || onMove) && (
                <div className="mt-2 flex gap-2">
                    {onRecord && <ActionButton primary onClick={() => onRecord(step)} testId={`attention-record-${id}`}><Mic size={18} aria-hidden="true" />काम नोंदवा</ActionButton>}
                    {onMove && <ActionButton onClick={() => setChoosing(c => !c)} disabled={busy} testId={`attention-later-${id}`}><CalendarClock size={18} aria-hidden="true" />पुढे ठरवा</ActionButton>}
                </div>
            )}
            {choosing && onMove && (
                <Choices options={STEP_MOVE_DAYS} disabled={busy} testId={`attention-later-choices-${id}`}
                    onPick={key => move(STEP_MOVE_DAYS.find(o => o.key === key)!.days)} />
            )}
            {busy && <p className="m-0 mt-2 text-[13px] font-bold text-stone-600" data-testid={`attention-later-busy-${id}`}>नवीन दिवस साठवत आहोत…</p>}
            {failed && (
                <p className="m-0 mt-2 text-[13px] font-bold text-rose-700" role="alert" data-testid={`attention-later-failed-${id}`}>
                    आत्ता दिवस बदलता आला नाही. नेट सुरू आहे ना ते पाहून पुन्हा करा — काम इथेच राहील.
                </p>
            )}
        </Shell>
    );
};
