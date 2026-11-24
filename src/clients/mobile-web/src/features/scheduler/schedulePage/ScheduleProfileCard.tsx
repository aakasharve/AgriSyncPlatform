/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 1; version 7) - the profile of the schedule the plot follows: its name and THREE separate lines (made by,
 * source, checked by), the words read from `dayCards/sourceLines` (the same words the day card's source card uses). No logo of any institution is drawn (no written permission
 * for NRCG's: SM-17); the source is a TEXT line. Read from this phone's copy first, so it draws with no signal (P10). Draws nothing until the version is known.
 */
import React, { useEffect, useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { dayCardWords } from '../dayCards/dayCardWords';
import { loadDayCards, type DayCardsLoad } from '../dayCards/dayCardsStore';
import type { DayCardsDetail } from '../dayCards/dayCardsTypes';
import { checkedByLine, madeByLine, scheduleSources } from '../dayCards/sourceLines';

export const ScheduleProfileCard: React.FC<{ templateId: string; plotName: string; load?: (id: string) => Promise<DayCardsLoad> }> = ({ templateId, plotName, load = loadDayCards }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = dayCardWords(language);
    const [detail, setDetail] = useState<DayCardsDetail | null>(null);
    useEffect(() => {
        let alive = true;
        void load(templateId).then(r => { if (alive) setDetail(r.ok ? r.detail : null); }).catch(() => { if (alive) setDetail(null); });
        return () => { alive = false; };
    }, [templateId, load]);
    if (!detail) return null;
    const sources = scheduleSources(detail);
    const row = (id: string, label: string, lines: string[]) => (
        <div data-testid={id} className="rounded-2xl bg-stone-50 px-3 py-2"><p className="m-0 text-[13px] font-extrabold text-stone-500">{label}</p>
            {lines.map(l => <p key={l} className="m-0 text-[17px] font-bold text-stone-900">{l}</p>)}</div>
    );
    return (
        <section className="space-y-2 rounded-3xl border-2 border-emerald-700 bg-white p-3" data-testid="schedule-profile" data-check={detail.check.state}>
            <p className="m-0 text-[14px] font-extrabold text-stone-600">{plotName} · {language === 'en' ? 'schedule followed' : 'पाळत असलेलं शेड्यूल'}</p>
            <h3 className="m-0 text-[20px] font-black text-stone-900" data-testid="profile-name">{detail.name}</h3>
            {row('line-made-by', words.source.madeBy, [madeByLine(detail, words)])}
            {row('line-source', words.source.source, sources.length > 0 ? sources : [words.source.noSource])}
            {row('line-checked-by', words.source.checkedBy, [checkedByLine(detail, words)])}
            {detail.kind === 'reference' && !detail.check.isChecked && <p className="m-0 text-[14px] font-bold text-amber-900" data-testid="profile-unchecked">{words.uncheckedLine}</p>}
        </section>
    );
};
