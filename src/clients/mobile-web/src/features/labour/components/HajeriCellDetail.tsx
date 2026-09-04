/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriCellDetail — "हा तपशील फक्त cell वर दाबल्यावर दिसतो." (founder master
 * review 2026-09-02, D4 item 4). The grid stays clean; EVERYTHING beyond the
 * day-mark lives here: the person-day's marks, stated hours, the arrangement
 * (उक्ते काम) and its work context, and the row's DIMENSIONAL week — counts of
 * stated facts side by side (final direction §2), never one invented number.
 *
 * COUNTING here is display of what was said (how many cells say पूर्ण), not
 * arithmetic that invents a figure: no fraction, no sum across kinds, no
 * conversion of hours into days. A dimension with nothing stated is OMITTED —
 * never rendered as 0.
 *
 * D-H10 note: a future worker confirmation attaches to THIS surface (row /
 * tap-detail — the founder's resolved placement). Keep it a component.
 */
import React from 'react';
import { Clock, X } from 'lucide-react';
import type { LedgerRow } from '../labour.types';
import { Avatar } from './LabourUiKit';
import { formatLedgerDayHead } from '../marathiDate';
import { t as translate } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';

/**
 * Task 9 (B001) — the honest label for a queue-intent cell's detail,
 * resolved from the ONE source at the pinned language (the
 * ReviewSheet.tsx:226 idiom). A detail sheet that showed an unsynced fact
 * without it would present intent as saved — the exact P10 violation the
 * register's own weaker treatment exists to prevent.
 */
const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

const DAY_WORD: Record<string, string> = { full: 'आला', half: 'अर्धा', absent: 'आला नाही' };

const HajeriCellDetail: React.FC<{
    row: LedgerRow;
    dayIndex: number;
    dayIso: string;
    onClose: () => void;
}> = ({ row, dayIndex, dayIso, onClose }) => {
    const c = row.cells[dayIndex];

    // Dimensional week — counts of the row's own stated facts, Latin digits.
    const marked = row.cells.filter((x) => x !== null);
    const full = marked.filter((x) => x!.day === 'full').length;
    const half = marked.filter((x) => x!.day === 'half').length;
    const nights = marked.filter((x) => x!.night === 'worked').length;
    const extra = marked.reduce((sum, x) => sum + (x!.extraHours ?? 0), 0);
    const weekParts: string[] = [];
    if (full > 0) weekParts.push(`${full} पूर्ण`);
    if (half > 0) weekParts.push(`${half} अर्धा`);
    if (nights > 0) weekParts.push(`${nights} रात्री`);
    if (extra > 0) weekParts.push(`जादा ${extra} तास`);

    return (
        <div className="fixed inset-0 z-40 flex items-end bg-black/30" onClick={onClose}>
            <div className="w-full rounded-t-[24px] bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[19px] font-bold text-stone-800">
                        <Avatar tone={row.tone} initial={row.initial} size="sm" />{row.name}
                        <span className="text-[16px] font-semibold text-stone-500">{formatLedgerDayHead(dayIso)}</span>
                    </span>
                    <button type="button" onClick={onClose} aria-label="बंद करा" className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500"><X size={18} /></button>
                </div>

                {c === null ? (
                    // रिकामं — nobody has said anything about this day. Blank, not absent.
                    <div className="mt-3 rounded-xl border border-dashed border-stone-200 p-3 text-[16px] text-stone-500">कुणी माहिती नाही</div>
                ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {c.day !== null && (
                            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[16px] font-bold text-emerald-700">{DAY_WORD[c.day]}</span>
                        )}
                        {c.night === 'worked' && (
                            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[16px] font-bold text-slate-700">◾ रात्र</span>
                        )}
                        {c.hours !== null && (
                            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[16px] font-bold text-slate-700">{c.hours} तास</span>
                        )}
                        {c.extraHours !== null && (
                            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[16px] font-bold text-amber-700">जादा {c.extraHours} तास</span>
                        )}
                        {c.ukte && (
                            <span className="rounded-full bg-violet-50 px-3 py-1.5 text-[16px] font-bold text-violet-700">उक्ते काम{c.work !== null ? ` · ${c.work}` : ''}</span>
                        )}
                        {!c.ukte && c.work !== null && (
                            <span className="rounded-full bg-stone-100 px-3 py-1.5 text-[16px] font-semibold text-stone-600">{c.work}</span>
                        )}
                    </div>
                )}

                {c !== null && c.unsynced && (
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] font-bold text-amber-700">
                        <Clock size={13} /> {ON_PHONE_MR}
                    </div>
                )}

                {weekParts.length > 0 && (
                    <div data-testid="dimensional-week" className="mt-4 border-t border-stone-100 pt-3 text-[16px] font-semibold text-stone-600">
                        {weekParts.join(' · ')}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HajeriCellDetail;
