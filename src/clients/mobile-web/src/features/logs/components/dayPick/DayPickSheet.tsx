/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-57 / D-60 and rule TAP-1) — THE calendar a day
 * chip opens (the founder's working phones `OLDFORM-leftovers`, "कामाचं कॅलेंडर"): one month, ‹ › to any earlier month,
 * every past day tappable, a future day never (no future work, no future हजेरी), today ringed, the chosen day filled.
 * A dot under a day = something is recorded that day; no dot = nothing was said that day (the missed days to fill).
 *
 * Over everything, with its own close button inside it (rule FOOT-1: nothing behind the bottom bar).
 */
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { PHONE_COLUMN } from '../phoneColumn';
import { keyToUtc, monthCells, monthTitle, weekHeads } from './dayWords';

const SANS = "'Noto Sans Devanagari', sans-serif";

const WORDS = {
    mr: {
        dots: 'ठिपका = त्या दिवशी नोंद आहे. ठिपका नाही = त्या दिवशी काही सांगितलं नाही.', // PROPOSED (Marathi) — the working phones
        close: 'बंद करा', // REUSED (Marathi)
        prev: 'मागचा महिना', // REUSED (Marathi) — ActivityCalendar
        next: 'पुढचा महिना', // REUSED (Marathi) — ActivityCalendar
    },
    en: {
        dots: 'A dot = something is recorded that day. No dot = nothing was said that day.', // PROPOSED (English)
        close: 'Close', // PROPOSED (English)
        prev: 'Previous month', // PROPOSED (English)
        next: 'Next month', // PROPOSED (English)
    },
} as const;

export interface DayPickSheetProps {
    /** The day shown chosen (`yyyy-MM-dd`). */
    value: string;
    onPick: (dayKey: string) => void;
    onClose: () => void;
    /** A line saying what the day is for (e.g. "हे काम कोणत्या दिवसाचं ते निवडा"); the dot key when absent. */
    note?: string;
    /** Days that have something recorded (a dot). */
    hasRecords?: (dayKey: string) => boolean;
    /** Injectable for tests; the phone's farm day otherwise. */
    todayKey?: string;
}

export const DayPickSheet: React.FC<DayPickSheetProps> = ({ value, onPick, onClose, note, hasRecords, todayKey = getDateKey() }) => {
    const language = useOptionalLanguage()?.language;
    const w = language === 'en' ? WORDS.en : WORDS.mr;
    const start = new Date(keyToUtc(value || todayKey));
    const [view, setView] = useState({ y: start.getUTCFullYear(), m: start.getUTCMonth() });
    const today = new Date(keyToUtc(todayKey));
    const atThisMonth = view.y === today.getUTCFullYear() && view.m === today.getUTCMonth();
    useBackDismiss(true, onClose);
    const move = (n: number) => setView(v => {
        const m = v.m + n;
        return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45" onClick={onClose} data-testid="day-pick-sheet" style={{ fontFamily: SANS }}>
            <div className={`max-h-[92%] overflow-y-auto rounded-t-[28px] bg-white p-4 pb-6 shadow-2xl ${PHONE_COLUMN}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={monthTitle(view.y, view.m, language)}>
                <div className="mb-2 flex items-center justify-between">
                    <button type="button" onClick={() => move(-1)} aria-label={w.prev} data-testid="day-pick-prev" className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-700"><ChevronLeft size={22} aria-hidden="true" /></button>
                    <b className="text-[17px] font-extrabold text-stone-900" data-testid="day-pick-title">{monthTitle(view.y, view.m, language)}</b>
                    <button type="button" onClick={() => move(1)} disabled={atThisMonth} aria-label={w.next} data-testid="day-pick-next" className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-stone-700 disabled:opacity-30"><ChevronRight size={22} aria-hidden="true" /></button>
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {weekHeads(language).map((h, i) => <span key={`h${i}`} className="text-center text-[12px] font-extrabold text-stone-500">{h}</span>)}
                    {monthCells(view.y, view.m).map((key, i) => {
                        if (!key) return <span key={`e${i}`} />;
                        const future = key > todayKey;
                        const day = Number(key.slice(8, 10));
                        if (future) return <span key={key} className="grid min-h-[44px] place-items-center text-[14px] font-bold text-stone-300" data-testid={`day-pick-future-${key}`}>{day}</span>;
                        const chosen = key === value;
                        return (
                            <button key={key} type="button" onClick={() => onPick(key)} data-testid={`day-pick-${key}`} aria-pressed={chosen}
                                className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl text-[15px] font-extrabold ${chosen ? 'bg-emerald-700 text-white' : key === todayKey ? 'ring-2 ring-emerald-500 text-emerald-800' : 'text-stone-800'}`}>
                                {day}
                                <span className="mt-0.5 h-1.5">{hasRecords?.(key) && <span className={`block h-1.5 w-1.5 rounded-full ${chosen ? 'bg-white' : 'bg-violet-600'}`} data-testid={`day-pick-dot-${key}`} />}</span>
                            </button>
                        );
                    })}
                </div>
                <p className="m-0 mt-3 text-[13.5px] font-bold leading-snug text-stone-600" data-testid="day-pick-note">{note ?? w.dots}</p>
                <button type="button" onClick={onClose} data-testid="day-pick-close" className="mt-3 min-h-[52px] w-full rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800">{w.close}</button>
            </div>
        </div>
    );
};

export default DayPickSheet;
