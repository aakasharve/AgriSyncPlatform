/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, items 6 and 7; version 7) - two small cards of the tab.
 *   LookMemoriesCard ("पाहणीच्या आठवणी"): filled from the followed schedule's OWN look and question fields on the day-card detail the phone caches - the works due today
 *     that carry a question or a look. With none today it says its rule (show the rule, never vanish). Tapping opens the ONE viewer on today's cards.
 *   FollowTotalsSlot ("कोणाची पद्धत किती फॉलो होते?"): a slot for slice 13 (follow totals; "follow" = taken; no number without evidence, P4). It shows its rule and NEVER a number:
 *     the prop `totals` is not given by anything yet.
 * Marathi words are PROPOSED (MARATHI-WORDS.md).
 */
import React, { useEffect, useState } from 'react';
import { Eye, Users } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { DayCardsViewer } from '../dayCards/DayCardsViewer';
import { loadDayCards, type DayCardsLoad } from '../dayCards/dayCardsStore';
import type { DayCardsDetail } from '../dayCards/dayCardsTypes';
import type { TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';
import { mrNum } from './scheduleCopy';
import { shownScheduleDay } from './scheduleDates';

export const TAB_CARD_WORDS = {
    mr: {
        looks: 'पाहणीच्या आठवणी', looksRule: 'आज पाहणी किंवा प्रश्न असलेलं काम या शेड्यूलमध्ये नाही. असं काम असेल तेव्हा इथे त्याचा प्रश्न दिसेल.', todayQ: 'आजचा प्रश्न: ',
        totals: 'कोणाची पद्धत किती फॉलो होते?', totalsRule: 'फॉलो म्हणजे "माझ्या वेळापत्रकात घेतलं". पुराव्याशिवाय आकडा दाखवत नाही; ही माहिती आल्यावर इथे दिसेल.',
    },
    en: {
        looks: 'Look reminders', looksRule: 'No work with a look or a question is due today in this schedule. When there is one, its question shows here.', todayQ: 'Today\'s question: ',
        totals: 'Whose method is followed how much?', totalsRule: 'Followed means "taken into my schedule". No number is shown without evidence; it will show here when that information arrives.',
    },
} as const;

/** The works of the detail due on a stored day that carry a look or a question. */
export function looksDueOn(detail: DayCardsDetail, storedDay: number) {
    return detail.tasks.filter(t => {
        if (!t.task.ask && !t.task.look) return false;
        const from = t.shown.from?.stored ?? t.shown.expectedFrom?.stored ?? null;
        const to = t.shown.to?.stored ?? t.shown.expectedTo?.stored ?? from;
        return from !== null && to !== null && storedDay >= from && storedDay <= to;
    });
}

export const LookMemoriesCard: React.FC<{ templateId: string; todayStored: number; load?: (id: string) => Promise<DayCardsLoad>; take?: TakeHost }> = ({ templateId, todayStored, load = loadDayCards, take }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = TAB_CARD_WORDS[language];
    const [detail, setDetail] = useState<DayCardsDetail | null>(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        let alive = true;
        void load(templateId).then(r => { if (alive) setDetail(r.ok ? r.detail : null); }).catch(() => { if (alive) setDetail(null); });
        return () => { alive = false; };
    }, [templateId, load]);
    const due = detail ? looksDueOn(detail, todayStored) : [];
    const first = due.find(t => t.task.ask)?.task.ask?.question ?? null;
    const count = language === 'mr' ? mrNum(due.length) : String(due.length);
    return (
        <>
            <button type="button" onClick={() => due.length > 0 && setOpen(true)} data-testid="look-memories" data-count={due.length} aria-disabled={due.length === 0}
                className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-pink-300 bg-pink-50 px-3 py-2 text-left">
                <Eye size={24} className="shrink-0 text-pink-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <strong className="block text-[17px] font-black text-pink-900">{words.looks}</strong>
                    <span className="block text-[14px] font-bold text-stone-700" data-testid="look-memories-line">{due.length > 0 ? `${first ? words.todayQ + first : ''}` : words.looksRule}</span>
                </span>
                {due.length > 0 && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pink-700 text-[16px] font-black text-white" data-testid="look-memories-count">{count}</span>}
            </button>
            {open && <DayCardsViewer source={{ templateId }} target={{ day: shownScheduleDay(todayStored) }} onClose={() => setOpen(false)} take={take ? { ...take, todayStored: take.todayStored ?? todayStored } : undefined} />}
        </>
    );
};

export const FollowTotalsSlot: React.FC<{ totals?: null }> = () => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = TAB_CARD_WORDS[language];
    return (
        <div className="flex items-start gap-3 rounded-2xl bg-indigo-50 px-3 py-3" data-testid="follow-totals-slot">
            <Users size={22} className="mt-0.5 shrink-0 text-indigo-800" aria-hidden="true" />
            <div className="min-w-0"><strong className="block text-[17px] font-black text-indigo-900">{words.totals}</strong>
                <span className="block text-[14px] font-bold text-stone-700" data-testid="follow-totals-rule">{words.totalsRule}</span></div>
        </div>
    );
};
