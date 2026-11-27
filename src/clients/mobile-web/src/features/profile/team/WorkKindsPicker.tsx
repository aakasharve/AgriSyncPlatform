/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.5; founder 27 Nov "a canonical setting in the setup hub, not on the
 * log page"; CTO ruling Q2) - the farm's registrant's ONE row on a person's team card, "काय नोंदवू शकतात: सर्व कामं ›", and the six ticks it opens
 * (पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च). Server truth only: the row shows what the server last said (absent = every kind); "ठेवा" sends the
 * WHOLE set and the card adopts the row the server returns - nothing moves before that. At least one must be ticked (stopping someone is "काम
 * थांबवा", P5). Observations and reminders are always open, and a change reaches new records only (founder 1-B): both said under the ticks.
 */
import React, { useState } from 'react';
import { Check, ChevronRight, ListChecks } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { Tap } from '../../../shared/components/ui/placeUi';
import { LIMITABLE_WORK_KINDS, type WorkKind } from '../../../core/session/workKinds';
import { kindName, teamWorkKindWords } from '../../workKinds/workKindWords';

/** The server's list as the row reads it: `null` = every kind (absent, or all six). */
export function kindsOfRow(workKinds: readonly string[] | null | undefined): WorkKind[] | null {
    if (!Array.isArray(workKinds)) return null;
    const known = LIMITABLE_WORK_KINDS.filter(k => workKinds.includes(k));
    return known.length === LIMITABLE_WORK_KINDS.length ? null : known;
}

export interface WorkKindsPickerProps {
    memberId: string;
    /** What the server last said (`workKinds` of the roster row; absent = every kind). */
    value: readonly string[] | null | undefined;
    busy: boolean;
    /** The whole desired set, in the contract's order (all six = every kind). */
    onSave: (kinds: WorkKind[]) => void;
}

export const WorkKindsPicker: React.FC<WorkKindsPickerProps> = ({ memberId, value, busy, onSave }) => {
    const language = useOptionalLanguage()?.language;
    const w = teamWorkKindWords(language);
    const current = kindsOfRow(value);
    const [open, setOpen] = useState(false);
    const [ticked, setTicked] = useState<Set<WorkKind>>(new Set(current ?? LIMITABLE_WORK_KINDS));

    const openSheet = () => {
        setTicked(new Set(current ?? LIMITABLE_WORK_KINDS));
        setOpen(o => !o);
    };
    const toggle = (kind: WorkKind) => setTicked(t => {
        const next = new Set(t);
        if (next.has(kind)) next.delete(kind); else next.add(kind);
        return next;
    });
    const save = () => {
        onSave(LIMITABLE_WORK_KINDS.filter(k => ticked.has(k)));
        setOpen(false);
    };

    return (
        <div className="space-y-2" data-testid={`work-kinds-${memberId}`}>
            <Tap onClick={openSheet} aria-expanded={open} disabled={busy} data-testid={`work-kinds-row-${memberId}`}
                className="flex min-h-[48px] w-full items-center gap-2 rounded-2xl bg-white px-3 text-left ring-1 ring-stone-300 disabled:opacity-60">
                <ListChecks size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">
                    {w.rowLabel}: <span data-testid={`work-kinds-summary-${memberId}`}>{w.summary(current)}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-stone-500" aria-hidden="true" />
            </Tap>

            {open && (
                <div role="dialog" aria-label={w.sheetTitle} className="space-y-2 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200" data-testid={`work-kinds-sheet-${memberId}`}>
                    <p className="m-0 text-[15px] font-extrabold text-stone-800">{w.sheetTitle}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                        {LIMITABLE_WORK_KINDS.map(kind => {
                            const on = ticked.has(kind);
                            return (
                                <Tap key={kind} onClick={() => toggle(kind)} role="checkbox" aria-checked={on} data-testid={`work-kind-${kind}-${memberId}`}
                                    className={`flex min-h-[52px] items-center gap-2 rounded-2xl border-2 px-3 text-left ${on ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'}`}>
                                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300'}`}>
                                        {on && <Check size={14} aria-hidden="true" />}
                                    </span>
                                    <span className="text-[15.5px] font-extrabold text-stone-900">{kindName(kind, language)}</span>
                                </Tap>
                            );
                        })}
                    </div>
                    {ticked.size === 0 && <p className="m-0 text-[14px] font-bold text-amber-800" data-testid={`work-kinds-pick-one-${memberId}`}>{w.pickOne}</p>}
                    <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">{w.alwaysOpen}</p>
                    <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600">{w.newOnly}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Tap onClick={save} disabled={busy || ticked.size === 0} data-testid={`work-kinds-save-${memberId}`}
                            className="min-h-[48px] rounded-full bg-[#1448E6] px-5 text-[15px] font-extrabold text-white disabled:opacity-50">
                            {w.save}
                        </Tap>
                        <Tap onClick={() => setOpen(false)} data-testid={`work-kinds-cancel-${memberId}`}
                            className="min-h-[48px] rounded-full bg-white px-5 text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                            {w.cancel}
                        </Tap>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkKindsPicker;
