/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, T2) — adding a to-do, in Marathi, right in the
 * list (founder-approved preview `app/reflect/TodoSection.tsx`): "आठवण जोडा" opens a line to type in plus
 * "जोडा" / "रद्द"; "बोलून सांगा" opens the real voice log flow, where a spoken reminder already becomes a
 * to-do (`LogFactory` → an `observation_derived` task in the same store).
 *
 * It replaces the English "Add New Task" sheet (`TaskCreationSheet.tsx`), whose ONLY opener was this list
 * (`SchedulerPage` declares `onOpenTaskCreator` but never calls it). What that sheet let him set stays here:
 * when (आज / उद्या / पुढच्या आठवड्यात / तारीख नाही, the sheet's same four) and how urgent. The place is the one
 * plot the page is narrowed to, else the whole farm (the sheet always wrote the FIRST crop and no plot).
 *
 * NOT carried over (P5, said plainly): the sheet's "Assign to" person chips. They wrote `assigneeId`, which
 * nothing in the app ever reads or shows, and the task store is not sent to the server — a control that did
 * nothing. Who may see or own a to-do is still open (PENDING D-10); when that is decided it gets a real home.
 * Words not in the preview are PROPOSED (Marathi).
 */
import React, { useState } from 'react';
import { Mic, Plus } from 'lucide-react';
import { ChoiceChips } from '../../../shared/components/ui/placeUi';
import type { PlannedTask } from '../../../types';
import type { NewTodo, TodoWhen } from './todoModel';
import { Tap } from './ui';

// PROPOSED (Marathi)
const WHEN: readonly (readonly [TodoWhen, string])[] = [['today', 'आज'], ['tomorrow', 'उद्या'], ['next_week', 'पुढच्या आठवड्यात'], ['no_date', 'तारीख नाही']];
// PROPOSED (Marathi) — the list already says तातडीचं / महत्त्वाचं on a row.
const PRIORITY: readonly (readonly [PlannedTask['priority'], string])[] = [['normal', 'साधं'], ['high', 'महत्त्वाचं'], ['urgent', 'तातडीचं']];

interface Props {
    onAdd: (todo: Omit<NewTodo, 'place'>) => void;
    /** "बोलून सांगा" — only when a real voice path is wired. */
    onTell?: () => void;
}

export const TodoAddForm: React.FC<Props> = ({ onAdd, onTell }) => {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [when, setWhen] = useState<TodoWhen>('tomorrow');
    const [priority, setPriority] = useState<PlannedTask['priority']>('normal');
    const reset = () => { setOpen(false); setText(''); setWhen('tomorrow'); setPriority('normal'); };
    const save = () => {
        if (!text.trim()) return;
        onAdd({ title: text.trim(), when, priority });
        reset();
    };

    if (open) {
        return (
            <div className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-emerald-300" data-testid="todo-form">
                <input value={text} onChange={e => setText(e.target.value)} data-testid="todo-input" autoFocus
                    aria-label="काय करायचं आहे?" placeholder="उदा. उद्या ठिबकची नळी तपासायची"
                    className="min-h-[50px] w-full rounded-xl bg-stone-50 px-3 text-[16px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500" />
                <div>
                    {/* PROPOSED (Marathi) */}
                    <p className="m-0 mb-1 text-[13px] font-extrabold text-stone-700">कधी?</p>
                    <ChoiceChips items={WHEN} value={when} onPick={setWhen} testId="todo-when" />
                </div>
                <div>
                    {/* PROPOSED (Marathi) */}
                    <p className="m-0 mb-1 text-[13px] font-extrabold text-stone-700">किती घाईचं?</p>
                    <ChoiceChips items={PRIORITY} value={priority} onPick={setPriority} testId="todo-priority" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Tap onClick={reset} data-testid="todo-cancel" className="min-h-[48px] rounded-full bg-stone-100 text-[15px] font-extrabold text-stone-700">रद्द</Tap>
                    <Tap onClick={save} disabled={!text.trim()} data-testid="todo-save" className="min-h-[48px] rounded-full bg-emerald-700 text-[15px] font-extrabold text-white disabled:opacity-40">जोडा</Tap>
                </div>
            </div>
        );
    }

    return (
        <div className={`grid gap-2 ${onTell ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <Tap onClick={() => setOpen(true)} data-testid="todo-add" className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                <Plus size={19} aria-hidden="true" />आठवण जोडा
            </Tap>
            {onTell && (
                <Tap onClick={onTell} data-testid="todo-tell" rippleColor="rgba(255,255,255,0.35)" className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-full bg-emerald-700 text-[15px] font-extrabold text-white">
                    <Mic size={19} aria-hidden="true" />बोलून सांगा
                </Tap>
            )}
        </div>
    );
};
