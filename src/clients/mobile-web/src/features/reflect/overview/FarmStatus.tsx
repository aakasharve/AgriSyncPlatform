/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * शेताची स्थिती — the old "Farm Status" crop carousel + plot chips, on the farm's real crops and plots, in
 * plain words: "सर्व पिकं" or one crop (its photo, "2 पैकी 2 प्लॉट"), then that crop's plots, each with its
 * crop's colour. Picking here narrows EVERY section below. Every Marathi string is PROPOSED.
 */
import React from 'react';
import { Check, MapPin } from 'lucide-react';
import type { CropProfile } from '../../../types';
import { pickCrop, togglePlot, type ReflectSelection } from './reflectSelection';
import { CropPhoto, Num, Tap } from './ui';

export const FarmStatus: React.FC<{ crops: readonly CropProfile[]; sel: ReflectSelection; onSel: (s: ReflectSelection) => void }> = ({ crops, sel, onSel }) => {
    if (crops.length === 0) {
        return <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="farm-status-empty">अजून पीक जोडलेलं नाही — शेत सेटअपमध्ये पीक आणि प्लॉट जोडा.</p>;
    }
    const plotCount = (key: 'all' | string) => crops.filter(c => key === 'all' || c.id === key).reduce((n, c) => n + (c.plots?.length ?? 0), 0);
    const pickedCount = (key: 'all' | string) => crops.filter(c => key === 'all' || c.id === key)
        .reduce((n, c) => n + (c.plots ?? []).filter(p => sel.plotIds.includes(p.id)).length, 0);
    const tiles: { key: 'all' | string; name: string; crop?: CropProfile }[] = [
        ...(crops.length > 1 ? [{ key: 'all' as const, name: 'सर्व पिकं' }] : []),
        ...crops.map(c => ({ key: c.id, name: c.name, crop: c })),
    ];
    const plotsShown = crops.filter(c => sel.crop === 'all' || c.id === sel.crop).flatMap(c => (c.plots ?? []).map(p => ({ p, c })));

    return (
        <div data-testid="farm-status">
            <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
                {tiles.map(t => {
                    const on = sel.crop === t.key;
                    const total = plotCount(t.key);
                    return (
                        <Tap key={t.key} onClick={() => onSel(pickCrop(crops, t.key))} data-testid={`farm-crop-${t.key}`} aria-pressed={on}
                            className={`relative flex w-[108px] shrink-0 snap-start flex-col items-center rounded-3xl border-2 bg-white px-2 pb-2.5 pt-3 ${on ? 'border-emerald-600 shadow-[0_8px_20px_-10px_rgba(4,120,87,0.6)]' : 'border-stone-200'}`}>
                            {t.crop
                                ? <CropPhoto iconName={t.crop.iconName} name={t.crop.name} px={56} />
                                : <span className="flex h-14 w-14 items-center -space-x-4">{crops.slice(0, 3).map(c => <CropPhoto key={c.id} iconName={c.iconName} name={c.name} px={40} className="ring-2 ring-white" />)}</span>}
                            <span className="mt-1.5 line-clamp-1 text-[15px] font-extrabold text-stone-900">{t.name}</span>
                            <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[11.5px] font-extrabold ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
                                {total === 0 ? 'प्लॉट नाही' : <><Num>{on ? pickedCount(t.key) : total}</Num> पैकी <Num>{total}</Num> प्लॉट</>}
                            </span>
                            {on && <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white"><Check size={15} strokeWidth={3} aria-hidden="true" /></span>}
                        </Tap>
                    );
                })}
            </div>
            {plotsShown.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                    {plotsShown.map(({ p, c }) => {
                        const on = sel.plotIds.includes(p.id);
                        return (
                            <Tap key={p.id} onClick={() => onSel(togglePlot(crops, sel, p.id))} data-testid={`farm-plot-${p.id}`} aria-pressed={on}
                                className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-[14.5px] font-extrabold ${on ? 'bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500' : 'bg-white text-stone-500 ring-1 ring-stone-300'}`}>
                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.color}`} aria-hidden="true" />
                                <MapPin size={15} aria-hidden="true" />{p.name}
                                {on && <Check size={15} strokeWidth={3} className="text-emerald-600" aria-hidden="true" />}
                            </Tap>
                        );
                    })}
                </div>
            )}
            <p className="m-0 mt-2 text-[12.5px] font-semibold text-stone-500">खालचं सगळं (कामं, प्लॉटचं काम, नोंदी, कॅलेंडर, खर्च) याच प्लॉटचं दिसतं.</p>
        </div>
    );
};
