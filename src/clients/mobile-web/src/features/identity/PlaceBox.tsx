/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S5/S6; CTO rulings Q8, Q9) - one place box of "माझी ओळख" (गाव, तालुका or
 * जिल्हा): type two or three letters, pick a row from the government list, or keep what you typed ("‹text› — यादीत नाही, असंच ठेवा", P9: never
 * reject a real place). No mic on it (Q9 = A).
 *
 * A plain text input (no focus handler, no hidden input: a UI lane once broke real sign-in with a focus trick). The rows sit under the box in the
 * page flow, not floating, so they never cover the next box at 320 px. In Marathi mode a row never shows an English taluka name (Q8 open): it says
 * the village and the district only, and adds the PIN when two rows would read the same.
 */
import React, { useMemo, useState } from 'react';
import { searchDistricts, searchTalukas, searchVillages, type VillageHit } from '../../domain/places/placeSearch';
import type { PlaceData } from './placeData';
import type { PlaceValue } from './identityForm';
import type { IdentityWords } from './identityWords';
import { digitsFor } from '../../shared/utils/marathiDigits';

export type PlaceKind = 'village' | 'taluka' | 'district';

export interface PlaceBoxProps {
    kind: PlaceKind;
    testId: string;
    label: string;
    required?: boolean;
    value: PlaceValue;
    language: 'mr' | 'en';
    words: IdentityWords;
    data: PlaceData | null;
    dataState: 'idle' | 'loading' | 'ready' | 'failed';
    /** Asked on the first letter typed: the list is read only when a box is used. */
    onNeedData: () => void;
    /** A chosen taluka / district narrows the rows. */
    talukaCode?: number | null;
    districtCode?: number | null;
    /** A picked or kept value (null = the box was emptied); a village row also gives its taluka, district and PIN. */
    onPick: (value: PlaceValue, hit?: VillageHit) => void;
}

/** How a chosen value reads in the box. */
export function placeText(value: PlaceValue, language: 'mr' | 'en'): string {
    if (!value) return '';
    if (value.kind === 'typed') return value.text;
    return language === 'mr' ? value.nameMr ?? value.nameEn : value.nameEn;
}

interface Row {
    key: string;
    title: string;
    line?: string;
    pick: () => void;
}

export const PlaceBox: React.FC<PlaceBoxProps> = ({
    kind, testId, label, required, value, language, words, data, dataState, onNeedData, talukaCode, districtCode, onPick,
}) => {
    // null = the box shows the chosen value; text = he is typing and has not picked yet.
    const [query, setQuery] = useState<string | null>(null);
    const shown = query ?? placeText(value, language);

    const rows = useMemo<Row[]>(() => {
        if (query === null || !data) return [];
        const done = (v: PlaceValue, hit?: VillageHit) => () => { setQuery(null); onPick(v, hit); };
        if (kind === 'village') {
            const hits = searchVillages(data.index, query, { talukaCode, districtCode });
            const base = hits.map(h => ({
                h,
                title: language === 'mr' ? h.village.nameMr ?? h.village.nameEn : h.village.nameEn,
                line: language === 'mr' ? words.districtInRow(h.district.nameMr) : words.talukaDistrictInRow(h.taluka.nameEn, h.district.nameEn),
            }));
            const seen = new Map<string, number>();
            for (const r of base) seen.set(`${r.title}|${r.line}`, (seen.get(`${r.title}|${r.line}`) ?? 0) + 1);
            return base.map(({ h, title, line }) => ({
                key: String(h.village.code),
                title,
                line: (seen.get(`${title}|${line}`) ?? 0) > 1 && h.village.pin ? `${line} · ${words.pinInRow(digitsFor(h.village.pin, language))}` : line,
                pick: done({ kind: 'list', code: h.village.code, nameMr: h.village.nameMr, nameEn: h.village.nameEn }, h),
            }));
        }
        if (kind === 'taluka') {
            // Q8 open: the list has English taluka names only, so Marathi mode offers no taluka row (typed only).
            if (language === 'mr') return [];
            return searchTalukas(data.index, query, { districtCode }).map(t => ({
                key: String(t.code),
                title: t.nameEn,
                line: words.districtInRow(data.index.list.districts.get(t.districtCode)?.nameEn ?? ''),
                pick: done({ kind: 'list', code: t.code, nameMr: null, nameEn: t.nameEn }),
            }));
        }
        return searchDistricts(data.index, query).map(d => ({
            key: String(d.code),
            title: language === 'mr' ? d.nameMr : d.nameEn,
            pick: done({ kind: 'list', code: d.code, nameMr: d.nameMr, nameEn: d.nameEn }),
        }));
    }, [query, data, kind, language, words, talukaCode, districtCode, onPick]);

    const typed = query?.trim() ?? '';
    const uncommitted = query !== null && typed !== '' && typed !== placeText(value, language).trim();

    return (
        <div className="mt-3" data-testid={testId}>
            <label className="block">
                <span className="block text-[13.5px] font-extrabold text-stone-700">
                    {label}{required && <b className="ml-1 text-rose-600" aria-hidden="true">*</b>}
                </span>
                <input
                    type="text"
                    value={shown}
                    autoComplete="off"
                    maxLength={100}
                    data-testid={`${testId}-input`}
                    onChange={e => {
                        const next = e.target.value;
                        onNeedData();
                        if (next.trim() === '') { setQuery(null); onPick(null); return; }
                        setQuery(next);
                    }}
                    className="mt-1 min-h-[52px] w-full rounded-xl bg-white px-3 text-[17px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 focus:ring-2 focus:ring-emerald-500"
                />
            </label>
            {value && value.kind === 'typed' && query === null && (
                <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-amber-800" data-testid={`${testId}-not-in-list`}>
                    {words.notInList}
                </span>
            )}
            {query !== null && (
                <div className="mt-1 overflow-hidden rounded-2xl bg-white shadow-[0_12px_28px_-8px_rgba(0,0,0,0.3)] ring-1 ring-stone-200" role="listbox" data-testid={`${testId}-rows`}>
                    {dataState === 'loading' && <p className="m-0 px-3 py-2 text-[13px] font-bold text-stone-500">{words.listLoading}</p>}
                    {dataState === 'failed' && <p className="m-0 px-3 py-2 text-[13px] font-bold text-stone-500" data-testid={`${testId}-list-failed`}>{words.listFailed}</p>}
                    {rows.map(r => (
                        <button key={r.key} type="button" role="option" aria-selected={false} onClick={r.pick} data-testid={`${testId}-row`}
                            className="block w-full border-b border-stone-100 px-3 py-2.5 text-left text-[15px] font-bold text-stone-900">
                            {r.title}
                            {r.line && <small className="block text-[12px] font-semibold text-stone-500">{r.line}</small>}
                        </button>
                    ))}
                    {typed !== '' && (
                        <button type="button" onClick={() => { setQuery(null); onPick({ kind: 'typed', text: query ?? '' }); }} data-testid={`${testId}-keep`}
                            className="block w-full px-3 py-2.5 text-left text-[14.5px] font-extrabold text-amber-900">
                            {words.keepTyped(typed)}
                        </button>
                    )}
                </div>
            )}
            {uncommitted && <p className="m-0 mt-1 text-[12.5px] font-bold text-amber-800" data-testid={`${testId}-not-chosen`}>{words.notChosen}</p>}
        </div>
    );
};
