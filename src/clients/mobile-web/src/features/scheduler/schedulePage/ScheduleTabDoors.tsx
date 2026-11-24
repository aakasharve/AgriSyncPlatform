/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7 items 6 and 7) - the two door cards of the tab:
 *   "<plot> चं नियोजन करा / शेड्यूलमधून घ्या किंवा बोलून सांगा" -> the existing planning door (drawn ONLY for a seat that may plan: a worker has no such card);
 *   "शेड्यूल बनवा / एकेक काम, एकेक कार्ड" -> the existing schedule maker (drawn ONLY for a seat that may make).
 * They only open those doors; nothing is written here. A seat without the right sees no card (no greyed button).
 */
import React from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

export const DOOR_WORDS = {
    mr: { plan: (plot: string) => `${plot} चं नियोजन करा`, planHint: 'शेड्यूलमधून घ्या किंवा बोलून सांगा', make: 'शेड्यूल बनवा', makeHint: 'एकेक काम, एकेक कार्ड' },
    en: { plan: (plot: string) => `Plan ${plot}`, planHint: 'Take from a schedule or say it aloud', make: 'Make a schedule', makeHint: 'One work, one card' },
} as const;

export const ScheduleTabDoors: React.FC<{ plotName: string; onPlan?: () => void; onMake?: () => void }> = ({ plotName, onPlan, onMake }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const w = DOOR_WORDS[language];
    const card = (id: string, title: string, hint: string, onClick: () => void) => (
        <button type="button" onClick={onClick} data-testid={id} className="flex min-h-[64px] w-full flex-col items-start rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm">
            <strong className="text-[19px] font-black leading-snug text-stone-900">{title}</strong>
            <span className="text-[17px] font-extrabold leading-snug text-stone-800">{hint}</span>
        </button>
    );
    return (
        <>
            {onPlan && card('tab-door-plan', w.plan(plotName), w.planHint, onPlan)}
            {onMake && card('tab-door-make', w.make, w.makeHint, onMake)}
        </>
    );
};
