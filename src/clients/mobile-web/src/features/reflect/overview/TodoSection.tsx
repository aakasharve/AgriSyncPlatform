/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * करायची कामे — the old "To Do Tasks" block and the reminders as ONE clear list (see `todoModel.ts`), read
 * top to bottom by time: वेळ उलटून गेली (red) → आज → पुढचे दिवस → तारीख नाही → झालेली (folded).
 * Each row: one big round tick (a tap marks it done, a tap again re-opens it), the work in big words, the
 * place in its crop's colour, आठवण/काम and where it came from, तातडीचं/महत्त्वाचं, and when.
 * Adding (spec plr-d10 I14, T2): with `onAddTodo` the list adds in place — "आठवण जोडा" + "बोलून सांगा"
 * (`TodoAddForm.tsx`, the approved preview's design; the app passes it). `onAdd` (a button that opens a
 * sheet) is kept only for a caller that gives no `onAddTodo`. Every Marathi string is PROPOSED.
 *
 * Late to-dos are on लक्ष द्या too (spec plr-d10 I14, H15 / T3 — `attentionItems.ts`, I22): the same store,
 * so a tick on either page clears both.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, Bell, Check, ClipboardCheck, Plus } from 'lucide-react';
import { allTodoItems, filterTodoList, type NewTodo, type TodoItem, type TodoList } from './todoModel';
import { TodoAddForm } from './TodoAddForm';
import { Num, Tap } from './ui';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { plannedWorkWords } from '../../plannedWork/plannedWorkWords';
import { ReminderChips } from '../../plannedWork/reminders/ReminderChips';
import { ReminderCardLines } from '../../plannedWork/reminders/ReminderCardLines';
import { chipCounts, reminderTitleIn, type ReminderChip } from '../../plannedWork/reminders/reminderModel';

/** How long "आठवण काढली · परत आणा" stays before the removal is sent (the way back is a tap until then). */
export const REMOVE_UNDO_MS = 5000;

export const TodoRow: React.FC<{ t: TodoItem; onToggle: () => void; onRemove?: () => void }> = ({ t, onToggle, onRemove }) => {
    const late = t.group === 'late';
    const language = useOptionalLanguage()?.language;
    const removeWords = plannedWorkWords(language);
    const title = reminderTitleIn(t.task, language) || t.title;
    const tickLabel = !t.canToggle ? 'हे काम इथून बदलता येत नाही' : t.done ? 'झालं — पुन्हा बाकी करा' : 'झालं म्हणून खूण करा';
    return (
        <div data-testid={`todo-row-${t.id}`} className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 ring-1 ${t.done ? 'bg-stone-50 ring-stone-200' : late ? 'bg-rose-50/70 ring-rose-200' : 'bg-white ring-stone-200'}`}>
            <Tap onClick={onToggle} disabled={!t.canToggle} aria-pressed={t.done} aria-label={tickLabel} data-testid={`todo-tick-${t.id}`}
                className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 disabled:opacity-40 ${t.done ? 'border-emerald-600 bg-emerald-600 text-white' : late ? 'border-rose-400 bg-white text-rose-300' : 'border-stone-300 bg-white text-stone-300'}`}>
                <Check size={22} strokeWidth={3} aria-hidden="true" />
            </Tap>
            <div className="min-w-0 flex-1">
                {title && <p className={`m-0 text-[16px] font-extrabold leading-snug ${t.done ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{title}</p>}
                {/* Lane REM-1 (D-78, D-84 = 1): who made it and when, where it came from, "ऐका", the rule lines - only what the server said. */}
                <ReminderCardLines task={t.task} placeLabel={t.place?.label} testIdPrefix="todo" />
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold">
                    {t.place && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-stone-700 ring-1 ring-stone-200">
                            {t.place.color && <span className={`h-2 w-2 rounded-full ${t.place.color}`} aria-hidden="true" />}{t.place.label}
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-stone-500">
                        {t.kindLabel === 'आठवण' ? <Bell size={13} aria-hidden="true" /> : <ClipboardCheck size={13} aria-hidden="true" />}{t.kindLabel}{t.fromLabel ? ` · ${t.fromLabel}` : ''}
                    </span>
                    {t.priorityLabel && !t.done && <span className={`rounded-full px-2 py-0.5 text-white ${t.priorityLabel === 'तातडीचं' ? 'bg-rose-600' : 'bg-amber-600'}`}>{t.priorityLabel}</span>}
                </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
                <span className={`text-[12.5px] font-extrabold ${late ? 'text-rose-700' : 'text-stone-500'}`}>{t.task.status === 'done' ? `${t.dueText} ✓` : t.dueText}</span>
                {/* Lane L8c-4 (D-78 = 1): one tap removes a reminder made from what he said; its words are plannedWorkWords' (PROPOSED, both languages). */}
                {t.canRemove && onRemove && (
                    <Tap onClick={onRemove} data-testid={`todo-remove-${t.id}`} aria-label={removeWords.removeLabel}
                        className="min-h-[36px] rounded-full bg-stone-100 px-3 text-[12.5px] font-extrabold text-stone-700">{removeWords.removeShort}</Tap>
                )}
            </div>
        </div>
    );
};

const Group: React.FC<{ title: string; tone: string; items: readonly TodoItem[]; onToggle: (t: TodoItem) => void; onRemove?: (t: TodoItem) => void; testId: string; note?: string }> = ({ title, tone, items, onToggle, onRemove, testId, note }) =>
    items.length ? (
        <div className="space-y-2" data-testid={testId}>
            <p className={`m-0 flex items-center gap-1.5 px-1 text-[14px] font-extrabold ${tone}`}>{title} <Num className="opacity-70">({items.length})</Num></p>
            {note && <p className="m-0 px-1 text-[12.5px] font-semibold text-stone-500" data-testid={`${testId}-note`}>{note}</p>}
            {items.map(t => <TodoRow key={t.id} t={t} onToggle={() => onToggle(t)} onRemove={onRemove ? () => onRemove(t) : undefined} />)}
        </div>
    ) : null;

interface TodoSectionProps {
    list: TodoList;
    onToggle: (t: TodoItem) => void;
    /** The app's task sheet (used when `onAddTodo` is not given). */
    onAdd?: () => void;
    /** Add in place, in Marathi (T2). Preferred over `onAdd`. */
    onAddTodo?: (todo: Omit<NewTodo, 'place'>) => void;
    /** "बोलून सांगा": the real voice log flow (a spoken reminder becomes a to-do there). */
    onTell?: () => void;
    /** Lane L8c-4: remove a reminder made from what he said (one tap). */
    onRemove?: (t: TodoItem) => void;
}

export const TodoSection: React.FC<TodoSectionProps> = ({ list: fullList, onToggle, onAdd, onAddTodo, onTell, onRemove }) => {
    const [showDone, setShowDone] = useState(false);
    const language = useOptionalLanguage()?.language;
    const words = plannedWorkWords(language).reminders;
    // Lane REM-1 (D-79): the chips narrow the list to one source; the tiles and the count follow what is shown.
    const [chip, setChip] = useState<ReminderChip>('all');
    // Lane REM-1: "काढा" hides the row at once, says "आठवण काढली · परत आणा" for a few seconds and only then sends the removal. A tap on
    // "परत आणा" sends nothing. A second removal (or leaving the page) sends the first now: his tap is never lost.
    const [removing, setRemoving] = useState<TodoItem | null>(null);
    const removingRef = useRef<TodoItem | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sendRemoval = useRef(onRemove);
    sendRemoval.current = onRemove;
    const flush = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const pending = removingRef.current;
        removingRef.current = null;
        setRemoving(null);
        if (pending) sendRemoval.current?.(pending);
    }, []);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        if (removingRef.current) sendRemoval.current?.(removingRef.current);
    }, []);
    // Fix round (review m4): the app sent to the background or closed inside the five seconds must not lose his tap either.
    useEffect(() => {
        const leaving = () => { if (removingRef.current) flush(); };
        const hidden = () => { if (document.visibilityState === 'hidden') leaving(); };
        document.addEventListener('visibilitychange', hidden);
        window.addEventListener('pagehide', leaving);
        return () => {
            document.removeEventListener('visibilitychange', hidden);
            window.removeEventListener('pagehide', leaving);
        };
    }, [flush]);
    const startRemoval = onRemove ? (t: TodoItem) => {
        flush();
        removingRef.current = t;
        setRemoving(t);
        timer.current = setTimeout(flush, REMOVE_UNDO_MS);
    } : undefined;
    const undoRemoval = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        removingRef.current = null;
        setRemoving(null);
    };
    const visible: TodoList = removing ? hideItem(fullList, removing.id) : fullList;
    const list = filterTodoList(visible, chip);
    const chips = fullList.total > 0 ? (
        <ReminderChips value={chip} onChange={setChip} counts={chipCounts(allTodoItems(visible).map(i => i.task))} />
    ) : null;
    const removedToast = removing ? (
        <div role="status" data-testid="todo-removed-toast" className="flex items-center justify-between gap-3 rounded-2xl bg-stone-800 px-4 py-2.5 text-[14px] font-extrabold text-white">
            <span>{words.removedToast}</span>
            <Tap onClick={undoRemoval} data-testid="todo-undo-remove" className="min-h-[40px] rounded-full bg-white px-4 text-[14px] font-extrabold text-stone-900">{words.undo}</Tap>
        </div>
    ) : null;
    const addButton = onAddTodo ? <TodoAddForm onAdd={onAddTodo} onTell={onTell} /> : onAdd && (
        <Tap onClick={onAdd} data-testid="todo-add" className="flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
            <Plus size={19} aria-hidden="true" />काम / आठवण जोडा
        </Tap>
    );
    if (fullList.total === 0) {
        return (
            <div className="space-y-3" data-testid="todo-section">
                <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="todo-empty">अजून कोणतंही काम किंवा आठवण नोंदलेली नाही.</p>
                {addButton}
            </div>
        );
    }
    const tiles = [
        { n: list.late.length, l: 'वेळ उलटली', c: 'bg-rose-50 text-rose-800 ring-rose-200', id: 'late' },
        { n: list.today.length, l: 'आज', c: 'bg-amber-50 text-amber-800 ring-amber-200', id: 'today' },
        { n: list.later.length + list.noDate.length, l: 'पुढे', c: 'bg-blue-50 text-blue-800 ring-blue-200', id: 'later' },
    ];
    return (
        <div className="space-y-3" data-testid="todo-section">
            {chips}
            {removedToast}
            <div className="grid grid-cols-3 gap-2 text-center">
                {tiles.map(x => (
                    <div key={x.id} className={`rounded-2xl px-1 py-2 ring-1 ${x.c}`} data-testid={`todo-tile-${x.id}`}>
                        <Num className="block text-[24px] font-extrabold leading-none">{x.n > 0 ? x.n : '—'}</Num>
                        <p className="m-0 mt-1 text-[12.5px] font-extrabold">{x.l}</p>
                    </div>
                ))}
            </div>
            <Group testId="todo-group-late" title="वेळ उलटून गेली" tone="text-rose-700" note="ही कामं 'लक्ष द्या' मध्येही दिसतात." items={list.late} onToggle={onToggle} onRemove={startRemoval} />
            <Group testId="todo-group-today" title="आज करायचं" tone="text-amber-800" items={list.today} onToggle={onToggle} onRemove={startRemoval} />
            <Group testId="todo-group-later" title="पुढचे दिवस" tone="text-blue-800" items={list.later} onToggle={onToggle} onRemove={startRemoval} />
            <Group testId="todo-group-nodate" title="तारीख ठरलेली नाही" tone="text-stone-700" items={list.noDate} onToggle={onToggle} onRemove={startRemoval} />
            {list.total === 0 && <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="todo-chip-empty">इथे काहीही नाही.</p>}
            {list.total > 0 && list.openCount === 0 && <p className="m-0 rounded-2xl bg-emerald-50 p-3 text-center text-[15px] font-extrabold text-emerald-800" data-testid="todo-all-done">सगळी कामं झाली — छान!</p>}
            {addButton}
            {list.done.length > 0 && (
                <div>
                    <Tap onClick={() => setShowDone(s => !s)} data-testid="todo-done-toggle" aria-expanded={showDone}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left text-[14px] font-extrabold text-emerald-800">
                        <AlarmClock size={17} aria-hidden="true" />झालेली कामं (<Num>{list.done.length}</Num>) — {showDone ? 'लपवा' : 'पाहा'}
                    </Tap>
                    {showDone && <div className="mt-1 space-y-2" data-testid="todo-group-done">{list.done.map(t => <TodoRow key={t.id} t={t} onToggle={() => onToggle(t)} />)}</div>}
                </div>
            )}
        </div>
    );
};

/** The list without one item (the reminder just removed, while its way back is still open). */
function hideItem(list: TodoList, id: string): TodoList {
    const keep = (items: TodoItem[]) => items.filter(i => i.id !== id);
    const next = { late: keep(list.late), today: keep(list.today), later: keep(list.later), noDate: keep(list.noDate), done: keep(list.done) };
    const open = next.late.length + next.today.length + next.later.length + next.noDate.length;
    return { ...next, openCount: open, total: open + next.done.length };
}

/** The count on the section header: what is still open, red when something is late. Nothing when there is no to-do at all. */
export const TodoCount: React.FC<{ list: TodoList }> = ({ list }) => {
    if (list.total === 0) return null;
    return (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] font-extrabold ${list.late.length ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'}`} data-testid="todo-count">
            {list.openCount > 0 ? <><Num>{list.openCount}</Num> बाकी</> : 'सगळं झालं'}
        </span>
    );
};
