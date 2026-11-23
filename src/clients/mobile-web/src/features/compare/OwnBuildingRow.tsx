/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6; approved spec SM-12) - तुलना shows his own schedule while it is still being built as its OWN row,
 * under the main schedule's stage line (which it never changes). Every number is the server's (thin client): the phone never counts. A stage where nothing of
 * it asks a number says so in words (no number it cannot explain, P4); the works with no day and no stage yet are a line of their own. One language at a time,
 * Devanagari digits in Marathi, no emoji, no "AI" wording. Marathi lines are PROPOSED (G:\agrisync-scratch\sched6\MARATHI-WORDS.md).
 */
import React from 'react';
import { digitsFor } from '../../shared/utils/marathiDigits';
import type { OwnBuildingCompareDto, StageCompareCountsDto } from './data/compareDtos';

type Lang = 'mr' | 'en';

const WORDS = {
    mr: {
        title: 'माझं शेड्यूल · बनत आहे', // PROPOSED (Marathi)
        sub: 'अजून मुख्य नाही · मुख्य शेड्यूलचे टप्पे तसेच', // PROPOSED (Marathi)
        works: (n: string) => `${n} कामं`, // PROPOSED (Marathi)
        outOf: (asked: string, done: string) => `${asked} पैकी ${done} झालं`, // PROPOSED (Marathi)
        wordsOnly: 'या टप्प्यात दिवस अजून ठरलेला नाही', // PROPOSED (Marathi)
        none: 'या टप्प्यात यातलं काम नाही', // PROPOSED (Marathi)
        unknown: (n: string, done: string) => `टप्पा न ठरलेली ${n} कामं · ${done} नोंदी`, // PROPOSED (Marathi)
    },
    en: {
        title: 'My schedule · being made', // PROPOSED (English)
        sub: 'Not main yet · the main schedule’s stages stay as they are', // PROPOSED (English)
        works: (n: string) => `${n} works`, // PROPOSED (English)
        outOf: (asked: string, done: string) => `${done} of ${asked} done`, // PROPOSED (English)
        wordsOnly: 'No day fixed yet in this stage', // PROPOSED (English)
        none: 'None of its works in this stage', // PROPOSED (English)
        unknown: (n: string, done: string) => `${n} works with no stage yet · ${done} records`, // PROPOSED (English)
    },
} as const;

const itemsOf = (c: StageCompareCountsDto | null | undefined) => (c ? c.parts.flatMap(p => p.items) : []);

export const OwnBuildingRow: React.FC<{ row: OwnBuildingCompareDto; stageIndex: number; plotStageCount: number; lang: Lang }> = ({ row, stageIndex, plotStageCount, lang }) => {
    const w = WORDS[lang];
    const d = (n: number) => digitsFor(String(n), lang);
    // the row's stages line up with the plot's, or nothing is drawn under a stage it was not counted for
    const here = row.stages.length === plotStageCount ? row.stages[stageIndex] ?? null : null;
    const items = itemsOf(here);
    let line: string;
    if (here && here.asked !== null && here.done !== null) line = w.outOf(d(here.asked), d(here.done));
    else if (items.length > 0) line = w.wordsOnly;
    else line = w.none;
    const unknown = row.stageUnknown ? itemsOf(row.stageUnknown) : [];
    return (
        <section className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-3" data-testid="compare-own-building">
            <div className="flex items-baseline justify-between gap-2 px-1">
                <b className="text-[16px] text-amber-950">{w.title}</b>
                <small className="text-[14px] font-bold text-stone-700" data-testid="compare-own-building-works">{w.works(d(row.works))}</small>
            </div>
            <p className="m-0 px-1 text-[13px] font-bold text-stone-600">{w.sub}</p>
            <p className="m-0 mt-2 min-h-[44px] rounded-2xl bg-white px-3 py-2.5 text-[16px] font-extrabold text-stone-900" data-testid="compare-own-building-count">{line}</p>
            {unknown.length > 0 && (
                <p className="m-0 mt-1.5 rounded-2xl bg-white px-3 py-2 text-[14px] font-bold text-stone-700" data-testid="compare-own-building-unknown">
                    {w.unknown(d(unknown.length), d(unknown.reduce((s, i) => s + i.done, 0)))}
                </p>
            )}
        </section>
    );
};

export default OwnBuildingRow;
