/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7) - the profile of the schedule the plot follows (or the tile he tapped): the crop's photo,
 * "<plot> पाळत असलेलं शेड्यूल", the schedule's name IN THE SCREEN'S LANGUAGE, then THREE separate labelled lines (बनवणारे / स्रोत / तपासणी) whose values are read from
 * `dayCards/sourceLines` (the same words the day card's source card uses), the grey note when the source is an institution that did not check it, and "पूर्ण ओळख पाहा" (a sheet
 * built from the phone's own copy of the version: its stages and the documents its works name). NO logo of any institution and no "logo place" box is drawn (no written permission
 * for NRCG's: SM-17); the source is TEXT. Reads the phone's copy first (`loadDayCards`), so it draws with no signal (P10). Draws nothing until the version is known.
 */
import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { PickerCropPhoto } from '../../context/components/CropPlotPicker';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { CropProfile } from '../../../types';
import { dayCardWords } from '../dayCards/dayCardWords';
import { loadDayCards, type DayCardsLoad } from '../dayCards/dayCardsStore';
import type { DayCardsDetail } from '../dayCards/dayCardsTypes';
import { checkedByLine, madeByLine, scheduleSources } from '../dayCards/sourceLines';
import { mrNum } from './scheduleCopy';
import { scheduleNameIn } from './scheduleNames';

export const PROFILE_WORDS = {
    mr: { followed: 'पाळत असलेलं शेड्यूल', madeBy: 'बनवणारे', source: 'स्रोत', checkedBy: 'तपासणी', full: 'पूर्ण ओळख पाहा', fullTitle: 'शेड्यूलची पूर्ण ओळख', stages: 'अवस्था', works: 'कामं', docs: 'माहितीचे स्रोत', close: 'बंद करा',
        notChecked: (who: string) => `स्रोत: ${who}. ${'हे शेड्यूल तपासलेलं किंवा मंजूर केलेलं नाही.'}`, dayRange: (a: string, b: string) => `दिवस ${a}–${b}`, dayBefore: (n: string) => `छाटणीआधी ${n} दिवस` },
    en: { followed: 'schedule followed', madeBy: 'Made by', source: 'Source', checkedBy: 'Checked by', full: 'See the full identity', fullTitle: 'Full identity of the schedule', stages: 'Stages', works: 'Works', docs: 'Sources of the information', close: 'Close',
        notChecked: (who: string) => `Source: ${who}. It has not checked or approved this schedule.`, dayRange: (a: string, b: string) => `Day ${a}-${b}`, dayBefore: (n: string) => `${n} days before the start` },
} as const;

/** "ICAR-NRCG ने ..." only when the source's first word is a Latin-letter name (an institution's short name); otherwise a neutral "या स्रोताने". */
export function instituteWord(label: string, language: 'mr' | 'en'): string {
    const first = label.trim().split(/\s+/)[0] ?? '';
    return /^[A-Za-z][A-Za-z-]+$/.test(first) ? first : language === 'mr' ? 'या स्रोताने' : 'The source';
}

const Row: React.FC<{ id: string; label: string; lines: string[] }> = ({ id, label, lines }) => (
    <div className="flex items-start gap-3" data-testid={id}>
        <p className="m-0 w-[72px] shrink-0 pt-0.5 text-[14px] font-extrabold text-stone-500">{label}</p>
        <div className="min-w-0 flex-1">{lines.map(l => <p key={l} className="m-0 text-[16px] font-extrabold leading-snug text-stone-900">{l}</p>)}</div>
    </div>
);

export const ScheduleProfileCard: React.FC<{
    templateId: string;
    plotName: string;
    crop?: Pick<CropProfile, 'name' | 'iconName' | 'masterId'>;
    /** The schedule's own "where it comes from" line as the catalog holds it (e.g. "ICAR-NRCG ची प्रकाशनं"); the documents its works name are the fallback. */
    sourceLabel?: string | null;
    load?: (id: string) => Promise<DayCardsLoad>;
    children?: React.ReactNode;
}> = ({ templateId, plotName, crop, sourceLabel, load = loadDayCards, children }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = dayCardWords(language);
    const pw = PROFILE_WORDS[language];
    const [detail, setDetail] = useState<DayCardsDetail | null>(null);
    const [full, setFull] = useState(false);
    useEffect(() => {
        let alive = true;
        void load(templateId).then(r => { if (alive) setDetail(r.ok ? r.detail : null); }).catch(() => { if (alive) setDetail(null); });
        return () => { alive = false; };
    }, [templateId, load]);
    if (!detail) return null;
    const docs = scheduleSources(detail);
    const sourceLines = sourceLabel ? [sourceLabel] : docs.length > 0 ? docs.slice(0, 2) : [words.source.noSource];
    const showNote = detail.kind === 'reference' && !detail.check.isChecked && !!sourceLabel;
    return (
        <section className="space-y-3 rounded-3xl border-2 border-emerald-700 bg-white p-4 shadow-sm" data-testid="schedule-profile" data-check={detail.check.state}>
            <div className="flex items-start gap-3">
                {crop && <PickerCropPhoto crop={crop} px={72} className="rounded-xl" />}
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] font-extrabold text-stone-600">{plotName} {pw.followed}</p>
                    <h3 className="m-0 text-[22px] font-black leading-snug text-emerald-900" data-testid="profile-name">{scheduleNameIn(detail.name, language)}</h3>
                </div>
            </div>
            <Row id="line-made-by" label={pw.madeBy} lines={[madeByLine(detail, words)]} />
            <Row id="line-source" label={pw.source} lines={detail.kind === 'own' ? [words.source.own] : sourceLines} />
            <Row id="line-checked-by" label={pw.checkedBy} lines={[checkedByLine(detail, words)]} />
            {showNote && <p className="m-0 rounded-xl bg-stone-100 px-3 py-2 text-[13.5px] font-bold leading-snug text-stone-700" data-testid="profile-unchecked">{language === 'mr' ? `स्रोत: ${sourceLabel}. ${instituteWord(sourceLabel ?? '', 'mr')} ने हे शेड्यूल तपासलेलं किंवा मंजूर केलेलं नाही.` : pw.notChecked(sourceLabel ?? '')}</p>}
            {children}
            <button type="button" onClick={() => setFull(true)} data-testid="profile-full" className="ml-auto flex min-h-[48px] items-center gap-1 text-[16px] font-extrabold text-emerald-800">{pw.full}<ChevronRight size={18} aria-hidden="true" /></button>
            {full && <IdentitySheet detail={detail} language={language} onClose={() => setFull(false)} docs={docs} />}
        </section>
    );
};

const IdentitySheet: React.FC<{ detail: DayCardsDetail; language: 'mr' | 'en'; docs: string[]; onClose: () => void }> = ({ detail, language, docs, onClose }) => {
    const pw = PROFILE_WORDS[language];
    const words = dayCardWords(language);
    const num = (n: number) => (language === 'mr' ? mrNum(n) : String(n));
    const day = (d: { shown: number | null; daysBeforeStart: number | null }) => (d.shown !== null ? num(d.shown) : d.daysBeforeStart !== null ? pw.dayBefore(num(d.daysBeforeStart)) : '');
    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={pw.fullTitle} data-testid="profile-identity">
            <div className="max-h-[88vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white px-4 pb-8 pt-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="m-0 text-[20px] font-black text-stone-900">{scheduleNameIn(detail.name, language)}</h2>
                    <button type="button" onClick={onClose} aria-label={pw.close} data-testid="profile-identity-close" className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full text-stone-700"><X size={22} aria-hidden="true" /></button>
                </div>
                <Row id="identity-made-by" label={pw.madeBy} lines={[madeByLine(detail, words)]} />
                <Row id="identity-checked-by" label={pw.checkedBy} lines={[checkedByLine(detail, words)]} />
                <h3 className="m-0 text-[17px] font-black text-stone-900">{pw.stages} · {num(detail.stages.length)}</h3>
                <ol className="m-0 list-none space-y-1.5 p-0" data-testid="identity-stages">
                    {detail.stages.map(s => (
                        <li key={s.index} className="rounded-xl bg-stone-50 px-3 py-2"><strong className="block text-[16px] font-extrabold text-stone-900">{s.name}</strong>
                            <span className="block text-[13.5px] font-bold text-stone-600">{pw.dayRange(day(s.from), day(s.to))}</span></li>
                    ))}
                </ol>
                <p className="m-0 text-[15px] font-extrabold text-stone-800" data-testid="identity-works">{pw.works}: {num(detail.tasks.length)}</p>
                <h3 className="m-0 text-[17px] font-black text-stone-900">{pw.docs}</h3>
                <ul className="m-0 list-none space-y-1 p-0" data-testid="identity-docs">
                    {(docs.length > 0 ? docs : [words.source.noSource]).map(d => <li key={d} className="text-[15px] font-bold text-stone-800">{d}</li>)}
                </ul>
            </div>
        </div>
    );
};
