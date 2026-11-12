/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132..D-137, TAP-1) - the small building blocks of the own-schedule screens:
 * the "यासाठी बनवलं" line (crop, days worked out, then only the items that are set), a short pick row (tap again to clear), a number box with its
 * less / more buttons, a bottom sheet, and the name lookup for the people the seat may see. Every target is at least 44px (TAP-1).
 */
import React, { useMemo } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { FarmerProfile } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { tagLabel } from './madeFor';
import { MADE_FOR_KEYS, type MadeForTags } from './ownScheduleModel';
import { OWN_WORDS, type OwnLanguage } from './ownScheduleWords';

/** The short label of one made-for item, as the v3 page words it (variety / soil / region / climate). */
export const MADE_FOR_SHORT: Readonly<Record<OwnLanguage, Readonly<Record<typeof MADE_FOR_KEYS[number], string>>>> = {
    mr: { variety: 'वाण', soilType: 'माती', region: 'प्रदेश', climate: 'हवामान' },
    en: { variety: 'Variety', soilType: 'Soil', region: 'Region', climate: 'Climate' }, // PROPOSED (English)
};

/** The people the seat may see, by user id -> name. A person with no known name is simply absent: no name is shown, never an id. */
export function usePeopleNames(profile: FarmerProfile | null | undefined): (userId: string | null | undefined) => string | null {
    const operators = profile?.operators;
    const map = useMemo(() => new Map((operators ?? []).map(o => [o.id, (o.name ?? '').trim()] as const).filter(([, name]) => name.length > 0)), [operators]);
    return userId => (userId ? map.get(userId) ?? null : null);
}

export const MadeForPills: React.FC<{ cropName: string; days: number; madeFor: MadeForTags; language: OwnLanguage; testId?: string }> = ({ cropName, days, madeFor, language, testId }) => {
    const words = OWN_WORDS[language];
    return (
        <div className="mt-1.5 rounded-2xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200" data-testid={testId}>
            <div className="text-[13px] font-extrabold text-stone-600">{words.madeForTitle}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white px-2.5 py-1 text-[14px] font-bold text-stone-900 ring-1 ring-stone-300">{cropName}</span>
                {days > 0 && <span className="rounded-full bg-white px-2.5 py-1 text-[14px] font-bold text-stone-900 ring-1 ring-stone-300">{words.daysN(days)}</span>}
                {MADE_FOR_KEYS.filter(k => madeFor[k]).map(k => (
                    <span key={k} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[14px] font-bold text-emerald-900 ring-1 ring-emerald-200">
                        {MADE_FOR_SHORT[language][k]}: {tagLabel(k, madeFor[k] as string, language)}
                    </span>
                ))}
            </div>
        </div>
    );
};

/** A short pick row: one tap picks, a second tap on the same one clears it. */
export const PickRow: React.FC<{ testId: string; label: string; optional: string; options: ReadonlyArray<{ code: string; label: string }>; value: string | undefined; onPick: (code: string | undefined) => void }> = ({
    testId, label, optional, options, value, onPick,
}) => (
    <div className="mt-3">
        <div className="text-[15px] font-extrabold text-stone-900">{label} <span className="text-[13px] font-bold text-stone-500">· {optional}</span></div>
        <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label={label} data-testid={testId}>
            {options.map(o => (
                <Tap key={o.code} onClick={() => onPick(value === o.code ? undefined : o.code)} aria-pressed={value === o.code} data-testid={`${testId}-${o.code}`}
                    className={`min-h-[48px] rounded-full px-4 text-[16px] font-extrabold ring-1 ${value === o.code ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-stone-800 ring-stone-300'}`}>
                    {o.label}
                </Tap>
            ))}
        </div>
    </div>
);

/** A whole-number box with its less / more buttons (the v3 stepper). The box can be typed in; a blank or negative entry is read as 0. */
export const NumberBox: React.FC<{ testId: string; value: number; min?: number; onChange: (n: number) => void; label: string; language: OwnLanguage; bad?: boolean }> = ({
    testId, value, min = 0, onChange, label, language, bad = false,
}) => {
    const words = OWN_WORDS[language];
    return (
        <div className={`flex items-center gap-1.5 rounded-2xl p-1 ring-1 ${bad ? 'bg-rose-50 ring-rose-300' : 'bg-white ring-stone-300'}`}>
            <Tap onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} ${words.less}`} data-testid={`${testId}-less`}
                className="grid min-h-[48px] min-w-[48px] place-items-center rounded-xl bg-stone-100 text-stone-800"><Minus size={18} aria-hidden="true" /></Tap>
            <input type="number" inputMode="numeric" min={min} value={value} aria-label={label} data-testid={testId}
                onChange={e => { const n = Number.parseInt(e.target.value, 10); onChange(Number.isFinite(n) ? Math.max(min, n) : min); }}
                className="min-h-[48px] w-full min-w-0 bg-transparent text-center text-[18px] font-black text-stone-900 outline-none" />
            <Tap onClick={() => onChange(value + 1)} aria-label={`${label} ${words.more}`} data-testid={`${testId}-more`}
                className="grid min-h-[48px] min-w-[48px] place-items-center rounded-xl bg-stone-100 text-stone-800"><Plus size={18} aria-hidden="true" /></Tap>
        </div>
    );
};

export const Sheet: React.FC<{ testId: string; title: string; closeLabel: string; onClose: () => void; closeTestId: string; children: React.ReactNode }> = ({ testId, title, closeLabel, onClose, closeTestId, children }) => (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-4 pb-8 pt-3">
            <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[20px] font-black text-stone-900">{title}</h2>
                <Tap onClick={onClose} aria-label={closeLabel} data-testid={closeTestId} className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full text-stone-700"><X size={22} aria-hidden="true" /></Tap>
            </div>
            <div className="mt-3 space-y-3">{children}</div>
        </div>
    </div>
);

/** "आवृत्ती 2 · बनवलं: सुनील · 7 नोव्हें · 2 कामं · मालक: संजय" - the parts that exist, joined; a name nobody knows is not shown. */
export function versionLine(parts: { version: number; madeBy: string | null; date: string | null; works: number; owner: string | null }, language: OwnLanguage): string {
    const words = OWN_WORDS[language];
    return [
        words.versionN(parts.version),
        parts.madeBy ? words.madeBy(parts.madeBy) : null,
        parts.date,
        words.worksN(parts.works),
        parts.owner ? words.ownerLine(parts.owner) : null,
    ].filter((p): p is string => !!p).join(' · ');
}
