/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * Which day the plot cards and the notes show — the old "Viewing activity for" bar, kept whole: tap the day
 * to pick ANY past day from the phone's date picker (never a future one), or one tap for आज / काल / परवा;
 * the arrows (from the approved preview) step one day. Every Marathi string is PROPOSED.
 */
import React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { addDays, dateLabel, fromDateKey, offsetOf, relLabel, weekdayOf } from './reflectDates';
import { Tap } from './ui';

export const DayBar: React.FC<{ date: Date; onDate: (d: Date) => void }> = ({ date, onDate }) => {
    const o = offsetOf(date);
    const today = new Date();
    return (
        <div data-testid="day-bar">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-2 py-1.5 ring-1 ring-stone-200">
                <Tap onClick={() => onDate(addDays(date, -1))} aria-label="आधीचा दिवस" data-testid="day-prev" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-700"><ChevronLeft size={22} aria-hidden="true" /></Tap>
                <label className="relative min-w-0 flex-1 cursor-pointer text-center">
                    <span className="flex items-center justify-center gap-1 text-[12px] font-bold text-stone-500"><CalendarDays size={14} aria-hidden="true" />या दिवसाचं काम पाहत आहात</span>
                    <span className="block text-[17px] font-extrabold text-stone-900" data-testid="day-label">{weekdayOf(date)}, {dateLabel(date)}{o === 0 ? ' · आज' : ''}</span>
                    {/* the phone's own date picker, over the label: any past day, never a future one */}
                    <input type="date" aria-label="दिवस निवडा" data-testid="day-picker" max={getDateKey(today)} value={getDateKey(date)}
                        onChange={e => { if (e.target.value) onDate(fromDateKey(e.target.value)); }}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </label>
                <Tap onClick={() => onDate(addDays(date, 1))} disabled={o >= 0} aria-label="पुढचा दिवस" data-testid="day-next" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-700 disabled:opacity-30"><ChevronRight size={22} aria-hidden="true" /></Tap>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-2xl bg-stone-100 p-1">
                {[0, -1, -2].map(k => {
                    const d = addDays(today, k);
                    const on = o === k;
                    return (
                        <Tap key={k} onClick={() => onDate(d)} data-testid={`day-quick-${-k}`} aria-pressed={on}
                            className={`min-h-[48px] rounded-xl text-center ${on ? 'bg-white text-emerald-800 shadow' : 'text-stone-600'}`}>
                            <span className="block text-[14.5px] font-extrabold">{relLabel(d)}</span>
                            <span className="block text-[11.5px] font-bold opacity-70">{dateLabel(d)}</span>
                        </Tap>
                    );
                })}
            </div>
        </div>
    );
};
