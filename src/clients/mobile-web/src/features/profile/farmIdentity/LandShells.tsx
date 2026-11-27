/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S7; drawing V4-B; founder A8.1-A8.7; CTO ruling Q7 = A) - the land and 7/12
 * part of a farm's "शेताची ओळख" page, as EMPTY shells: nothing can be typed, nothing is stored or sent, every part says "लवकरच", and nothing in it
 * says "पडताळलेलं" or shows a tick (P5: a truthful missing feature).
 *
 *   - Seen by the owner and co-owner only (A8.6); a मुकादम or कामगार sees only "ही माहिती फक्त मालक आणि सहमालक पाहू शकतात."
 *   - One 7/12 square, the −/+ greyed with "लवकरच" (Q7 = A: a counter that forgets would look like it works). The squares sit five in a row, so
 *     25 or more stay usable when the count becomes real (A8.7: no limit).
 *   - The two area boxes stay "—" (A8.2 shells only), though the server knows the mapped area: it fills the second box in the 7/12 build.
 */
import React, { useState } from 'react';
import { Clock3, Lock, Plus, ShieldCheck, Upload } from 'lucide-react';
import { GlassCard } from '../../../shared/components/ui/placeUi';
import { farmPageWords } from './landShellWords';

/** The roles that see the land part (A8.6). */
export const LAND_ROLES: ReadonlySet<string> = new Set(['PrimaryOwner', 'SecondaryOwner']);

const Dash: React.FC = () => <b className="shrink-0 text-[15px] font-extrabold text-stone-400">—</b>;

const Line: React.FC<{ label: string; last?: boolean }> = ({ label, last }) => (
    <div className={`flex justify-between gap-2 py-2 text-[13px] font-bold leading-snug text-stone-700 ${last ? '' : 'border-b border-stone-100'}`}>
        <span>{label}</span><Dash />
    </div>
);

export const LandShells: React.FC<{ role: string | null; language: 'mr' | 'en' }> = ({ role, language }) => {
    const w = farmPageWords(language);
    // Q7 = A: one extract, and nothing remembers a different count.
    const count = 1;
    const [selected, setSelected] = useState(0);

    if (!role || !LAND_ROLES.has(role)) {
        return (
            <p className="m-0 flex items-start gap-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-3 text-[13.5px] font-bold leading-snug text-stone-600" data-testid="land-owners-only">
                <Lock size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{w.ownersOnly}
            </p>
        );
    }

    const soonChip = <span className="inline-flex shrink-0 rounded-full bg-stone-100 px-2.5 py-0.5 text-[12.5px] font-extrabold text-stone-700">{w.soon}</span>;
    const n = selected + 1;
    return (
        <div className="space-y-3" data-testid="land-shells">
            <p className="m-0 flex items-start gap-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-3 text-[13.5px] font-bold leading-snug text-stone-600">
                <Clock3 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{w.designNote}
            </p>
            <div className="px-1 pt-1">
                <h2 className="m-0 text-[17px] font-extrabold text-stone-900">{w.landHead}</h2>
                <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[12.5px] font-bold text-stone-600"><Lock size={14} aria-hidden="true" />{w.landSeenBy}</p>
            </div>
            <GlassCard testId="land-area">
                <p className="m-0 text-[17px] font-black text-stone-900">{w.areaHead}</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl bg-stone-100 p-2.5">
                        <span className="block text-[12.5px] font-extrabold leading-snug text-stone-700">{w.areaOnPaper}</span>
                        <span className="mt-1.5 block text-[22px] font-black text-stone-400">—</span>
                        <span className="mt-1 block text-[11.5px] font-semibold text-stone-500">{w.soon}</span>
                    </div>
                    <div className="rounded-2xl bg-stone-100 p-2.5">
                        <span className="block text-[12.5px] font-extrabold leading-snug text-stone-700">{w.areaMapped}</span>
                        <span className="mt-0.5 block text-[11.5px] font-semibold text-stone-500">{w.areaCultivated}</span>
                        <span className="mt-1.5 block text-[22px] font-black text-stone-400">—</span>
                        <span className="mt-1 block text-[11.5px] font-semibold text-stone-500">{w.soon}</span>
                    </div>
                </div>
                <p className="m-0 mt-2 text-[12.5px] font-semibold text-stone-500">{w.unit}</p>
            </GlassCard>
            <GlassCard testId="land-count">
                <p className="m-0 text-[18px] font-black leading-snug text-stone-900">{w.question}</p>
                <p className="m-0 mt-1 text-[13px] font-semibold text-stone-500">{w.questionHint}</p>
                <div className="mt-2.5 flex items-center justify-center gap-3.5">
                    <button type="button" disabled aria-disabled="true" data-testid="land-count-minus"
                        className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-[22px] font-black text-stone-400">−</button>
                    <b className="min-w-[64px] text-center text-[34px] font-black text-stone-900" data-testid="land-count-value">{w.digits(count)}</b>
                    <button type="button" disabled aria-disabled="true" data-testid="land-count-plus"
                        className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-[22px] font-black text-stone-400">+</button>
                </div>
                <p className="m-0 mt-1 text-center">{soonChip}</p>
            </GlassCard>
            <GlassCard testId="land-tiles">
                <p className="m-0 text-[14px] font-extrabold text-stone-600">{w.countLine(n, count)}</p>
                <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                    {Array.from({ length: count }, (_, i) => (
                        <button key={i} type="button" onClick={() => setSelected(i)} aria-pressed={i === selected} data-testid={`land-tile-${i + 1}`}
                            className={`flex h-[50px] flex-col items-center justify-center rounded-xl text-[16px] font-black ${i === selected ? 'border-2 border-emerald-600 bg-emerald-50 text-emerald-800' : 'border border-stone-200 bg-white text-stone-900'}`}>
                            <small className="text-[9.5px] font-bold leading-none text-stone-400">{w.tile}</small>{w.digits(i + 1)}
                        </button>
                    ))}
                </div>
            </GlassCard>
            <div className="rounded-[18px] border-[1.5px] border-dashed border-stone-300 bg-[#FFFDF8] p-3" data-testid={`land-extract-${n}`}>
                <div className="flex items-center justify-between gap-2 text-[17px] font-black text-stone-900"><span>{w.extract(n)}</span>{soonChip}</div>
                <button type="button" disabled aria-disabled="true" data-testid="land-upload"
                    className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-stone-400 bg-stone-100 text-[14.5px] font-extrabold text-stone-500">
                    <Upload size={18} aria-hidden="true" />{w.upload}
                </button>
                <div className="mt-1.5"><Line label={w.gat} /><Line label={w.hissa} /><Line label={w.areaOnPaper} last /></div>
                <div className="mt-2.5 rounded-[14px] bg-stone-100 px-2.5 py-2">
                    <p className="m-0 text-[14px] font-black text-stone-900">{w.owners}</p>
                    <Line label={w.name} /><Line label={w.mobile} /><Line label={w.mobileCheck} last />
                </div>
                <div className="mt-2.5 rounded-[14px] bg-stone-100 px-2.5 py-2">
                    <p className="m-0 text-[14px] font-black text-stone-900">{w.coOwners}</p>
                    <Line label={w.name} /><Line label={w.mobile} /><Line label={w.mobileCheck} /><Line label={w.share} last />
                    <button type="button" disabled aria-disabled="true" data-testid="land-add-co-owner"
                        className="mt-1.5 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-stone-400 bg-stone-100 text-[14.5px] font-extrabold text-stone-500">
                        <Plus size={16} aria-hidden="true" />{w.addCoOwner}
                    </button>
                </div>
                <p className="m-0 mt-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-stone-600"><ShieldCheck size={15} aria-hidden="true" />{w.mobileIsNotOwnership}</p>
            </div>
        </div>
    );
};
