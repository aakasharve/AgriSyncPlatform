/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; doctrine P2, P3, P10) - "माझं शेड्यूल · G1" on the planning page, for a
 * farm the schedule mechanism is switched on for: the plot-season's own works as this phone knows them (a change still on the phone says so; a refused one
 * says so and opens the conflict page), "काम जोडा" into the maker, "बदला" into the same maker, and "काढा" with UNDO: the removal is queued at once
 * (`ownschedule.item.remove`, offline first) and "काढलेलं परत आणा" saves the same work again whole (the server keeps the row and its history either way, P3).
 * It is not main and says so; making it main is not in this slice.
 */
import React, { useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { OwnScheduleCommands } from '../../../application/usecases/sync/OwnScheduleCommands';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { OwnLanguage } from './ownScheduleWords';
import { startWordFor, useOwnWorks, type OwnWorkPlace } from './ownWorkPlace';
import { KindChip } from './form/makerBits';
import { workWhenLine } from './form/workLine';
import { WORK_MAKER_WORDS } from './form/workMakerWords';

export interface OwnWorkListProps {
    place: OwnWorkPlace;
    language: OwnLanguage;
    onAdd: () => void;
    onEdit: (taskKey: string) => void;
    onOpenConflicts: () => void;
}

export const OwnWorkList: React.FC<OwnWorkListProps> = ({ place, language, onAdd, onEdit, onOpenConflicts }) => {
    const words = WORK_MAKER_WORDS[language];
    const start = startWordFor(place.cropName);
    const works = useOwnWorks(place);
    const [undo, setUndo] = useState<ScheduleTaskContent | null>(null);
    const [busy, setBusy] = useState(false);
    const nameOf = (key: string) => works?.find(w => w.taskKey === key)?.task.name ?? null;

    const remove = async (task: ScheduleTaskContent) => {
        if (busy) return;
        setBusy(true);
        try {
            await OwnScheduleCommands.remove(place, task.taskKey);
            setUndo(task);
            backgroundSyncWorker.triggerNow().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    };
    const bringBack = async () => {
        if (!undo || busy) return;
        setBusy(true);
        try {
            await OwnScheduleCommands.save(place, undo);
            setUndo(null);
            backgroundSyncWorker.triggerNow().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="space-y-2 rounded-3xl border-2 border-amber-300 bg-amber-50 p-3.5" data-testid="own-list">
            <div>
                <h4 className="m-0 text-[18px] font-extrabold leading-tight text-amber-950">{words.listTitle(place.plotName)}</h4>
                <p className="m-0 text-[13px] font-bold text-stone-700">{words.listSub}</p>
            </div>
            {undo && (
                <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-amber-300" data-testid="own-list-removed">
                    <span className="min-w-0 flex-1 text-[14px] font-bold text-stone-800">{words.removed(undo.name)}</span>
                    <Tap onClick={() => { void bringBack(); }} data-testid="own-list-undo" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full border-2 border-amber-600 bg-white px-4 text-[15px] font-extrabold text-amber-900">
                        <RotateCcw size={16} aria-hidden="true" />{words.undo}
                    </Tap>
                </div>
            )}
            {works !== null && works.length === 0 && <p className="m-0 rounded-2xl bg-white px-3 py-2.5 text-[15px] font-bold text-stone-700" data-testid="own-list-empty">{words.listEmpty}</p>}
            {(works ?? []).map(w => (
                <div key={w.taskKey} className="rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-200" data-testid={`own-list-row-${w.taskKey}`}>
                    <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                            <b className="block text-[16px] font-extrabold leading-tight text-stone-900">{w.task.name}</b>
                            <span className="mt-0.5 block text-[13.5px] font-bold leading-snug text-stone-600">{workWhenLine(w.task, nameOf, words, start)}</span>
                        </div>
                        <KindChip kind={w.task.kind} label={words.kinds[w.task.kind]} />
                    </div>
                    {w.pending && !w.refused && <p className="m-0 mt-1 text-[13px] font-bold text-amber-900" data-testid={`own-list-pending-${w.taskKey}`}>{words.pending}</p>}
                    {w.refused && (
                        <p className="m-0 mt-1 text-[13px] font-bold text-rose-800" data-testid={`own-list-refused-${w.taskKey}`}>
                            {words.refused}{' '}
                            <button type="button" onClick={onOpenConflicts} className="min-h-[44px] font-extrabold underline underline-offset-2">{words.openConflicts}</button>
                        </p>
                    )}
                    <div className="mt-1 flex flex-wrap">
                        <Tap onClick={() => onEdit(w.taskKey)} data-testid={`own-list-edit-${w.taskKey}`} className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-sky-800">{words.change}</Tap>
                        <Tap onClick={() => { void remove(w.task); }} disabled={busy} data-testid={`own-list-remove-${w.taskKey}`} className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-rose-700">{words.remove}</Tap>
                    </div>
                </div>
            ))}
            <Tap onClick={onAdd} data-testid="own-list-add" className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 text-[18px] font-extrabold text-white">
                <Plus size={22} aria-hidden="true" />{words.add}
            </Tap>
        </section>
    );
};

export default OwnWorkList;
