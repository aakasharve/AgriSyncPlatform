/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; decision 5; slice 9 finding) - the Schedule tab's "same work" cards.
 * A work that two schedules the plot follows both hold is ONE card, with a choice of the source it is taken from; each source shows its own day. Taking records the
 * PICKED source. A source whose version is not checked is marked and offers no dose and no take (following opens after the check). Reads the versions from this phone's
 * copy first (`loadDayCards`), so the card draws with no signal (P10). Draws nothing while there is no shared work. Marathi words PROPOSED (MARATHI-WORDS.md).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { dayCardWords } from '../dayCards/dayCardWords';
import { loadDayCards, type DayCardsLoad } from '../dayCards/dayCardsStore';
import type { DayCardsDetail, ShownDay } from '../dayCards/dayCardsTypes';
import { TakeIntoMyScheduleButton, type TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';
import { scheduleNameIn } from './scheduleNames';
import { dueOnDay, groupSameWork, type SameWorkGroup } from './sameWork';

const WORDS = {
    mr: { title: 'एकच काम, एकापेक्षा जास्त शेड्यूल', none: 'आज या शेड्यूलमध्ये कोणतं काम नाही.', pick: 'कोणत्या शेड्यूलमधून घ्यायचं?', unchecked: 'श्रमसफलने अजून तपासलेलं नाही — तपासणीनंतर घेता येईल', doseLater: 'मात्रा तपासणीनंतर दिसेल' },
    en: { title: 'One work, more than one schedule', none: 'No work is due today in these schedules.', pick: 'Take it from which schedule?', unchecked: 'Not yet checked by ShramSafal - it can be taken after the check', doseLater: 'The dose shows after the check' },
} as const;

export const SameWorkSection: React.FC<{
    /** The versions this plot follows (the main one and the others). */
    versionIds: readonly string[];
    load?: (id: string) => Promise<DayCardsLoad>;
    /** Absent = no take (a seat without the right); the cards are still read. */
    take?: TakeHost;
    /** The "today, all schedules" list: only the works due on this stored day, the single-source ones too. Absent = the works two schedules share, on any day. */
    todayStored?: number;
}> = ({ versionIds, load = loadDayCards, take, todayStored }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = WORDS[language];
    const dayWords = dayCardWords(language);
    const [details, setDetails] = useState<DayCardsDetail[]>([]);
    const idsKey = versionIds.join(',');
    useEffect(() => {
        let alive = true;
        void Promise.all(idsKey.split(',').filter(Boolean).map(id => load(id).catch(() => ({ ok: false as const, reason: 'failed' as const }))))
            .then(rs => { if (alive) setDetails(rs.flatMap(r => (r.ok ? [r.detail] : []))); });
        return () => { alive = false; };
    }, [idsKey, load]);
    const groups = useMemo(() => (todayStored === undefined ? groupSameWork(details) : groupSameWork(details.map(d => dueOnDay(d, todayStored)), 1)), [details, todayStored]);
    if (groups.length === 0) return todayStored === undefined ? null : <p className="m-0 rounded-2xl bg-stone-50 px-3 py-3 text-[15px] font-bold text-stone-600" data-testid="same-work-none">{words.none}</p>;
    return (
        <section className="space-y-2" data-testid="same-work-section">
            {todayStored === undefined && <h3 className="m-0 px-1 text-[17px] font-black text-stone-900">{words.title}</h3>}
            {groups.map(g => <SameWorkCard key={g.key} group={g} take={take} language={language} words={words} dayText={d => dayText(d, dayWords)} />)}
        </section>
    );
};

const dayText = (d: ShownDay | null, w: ReturnType<typeof dayCardWords>): string => (!d ? '' : d.shown !== null ? w.dayN(d.shown) : d.daysBeforeStart !== null ? w.daysBefore(d.daysBeforeStart) : '');

const SameWorkCard: React.FC<{ group: SameWorkGroup; take?: TakeHost; language: 'mr' | 'en'; words: (typeof WORDS)['mr'] | (typeof WORDS)['en']; dayText: (d: ShownDay | null) => string }> = ({ group, take, language, words, dayText: dt }) => {
    // Opens on the first source that can be taken, else the first.
    const [pickedId, setPickedId] = useState<string>((group.sources.find(s => s.takeable) ?? group.sources[0]).versionId);
    const picked = group.sources.find(s => s.versionId === pickedId) ?? group.sources[0];
    return (
        <article className="space-y-2 rounded-2xl border-2 border-stone-200 bg-white p-3" data-testid="same-work-card" data-work-key={group.key}>
            <p className="m-0 text-[17px] font-black text-stone-900">{group.name}</p>
            {group.sources.length > 1 && <p className="m-0 text-[13.5px] font-bold text-stone-600">{words.pick}</p>}
            <div className="flex flex-wrap gap-2" role="radiogroup">
                {group.sources.map(s => (
                    <button key={s.versionId} type="button" role="radio" aria-checked={s.versionId === picked.versionId} onClick={() => setPickedId(s.versionId)}
                        data-testid={`same-work-source-${s.versionId}`}
                        className={`min-h-[48px] rounded-full border-2 px-3 text-left text-[15px] font-extrabold ${s.versionId === picked.versionId ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white text-stone-800'}`}>
                        {scheduleNameIn(s.versionName, language)} · {dt(s.day)}
                    </button>
                ))}
            </div>
            {!picked.checked && (
                <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[14px] font-bold text-amber-900" data-testid="same-work-unchecked">{words.unchecked}</p>
            )}
            {picked.takeable && take && take.mayTake && (
                <TakeIntoMyScheduleButton place={take.place} sourceVersionId={picked.versionId} task={picked.task} language={language} dayStored={picked.storedDay} todayStored={take.todayStored ?? null}
                    mayTake planning={take.planning} onOpenConflicts={take.onOpenConflicts} />
            )}
        </article>
    );
};
