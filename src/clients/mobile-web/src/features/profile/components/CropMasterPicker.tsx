/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18, PENDING D-25 default) — choosing a crop to add, from the
 * founder's crop master (the app's ONE crop list, stored in the app so it works offline):
 *   - the policy's "tile" crops (the 43 core crops) as picture tiles, and the crops already on the farm marked
 *     "already added" (they are never filtered away, whatever their level);
 *   - every searchable crop found by typing any of its names — Marathi, English or any local name in the sheet
 *     (the phone keyboard's mic types a spoken name the same way); hidden crops are not offered;
 *   - a crop the list does not have can still be added as typed (shown as entered, never rewritten).
 * Names follow the app's language strictly. Pictures load one by one as tiles are seen (`useCropPicture`).
 * Every string here is PROPOSED (Marathi) / PROPOSED (English).
 */
import React, { useMemo, useState } from 'react';
import { Check, Plus, Search, Sprout } from 'lucide-react';
import { cropGroupLabel, cropLabel, cropTiles, normName, otherNamesIn, searchCrops, type CropMasterRow } from '../../../domain/crops/cropMaster';
import { useCropPicture } from '../../context/components/cropImage';
import { Tap } from '../../../shared/components/ui/placeUi';

export const PICKER_WORDS = {
    mr: {
        search: 'पीक शोधा', // PROPOSED (Marathi)
        searchHint: 'मराठी, इंग्रजी किंवा गावचं नाव लिहा', // PROPOSED (Marathi)
        tilesTitle: 'नेहमीची पिकं', // PROPOSED (Marathi)
        added: 'जोडलेलं', // PROPOSED (Marathi)
        none: 'या नावाचं पीक यादीत नाही.', // PROPOSED (Marathi)
        addTyped: (name: string) => `“${name}” असंच जोडा`, // PROPOSED (Marathi)
    },
    en: {
        search: 'Find a crop', // PROPOSED (English)
        searchHint: 'Type its Marathi, English or local name', // PROPOSED (English)
        tilesTitle: 'Common crops', // PROPOSED (English)
        added: 'Added', // PROPOSED (English)
        none: 'No crop by this name in the list.', // PROPOSED (English)
        addTyped: (name: string) => `Add “${name}” as typed`, // PROPOSED (English)
    },
} as const;

/** What the farmer chose: a crop of the master, or a name he typed that the master does not have. */
export type PickedCrop = { kind: 'master'; row: CropMasterRow } | { kind: 'typed'; name: string };

export const CropPicture: React.FC<{ row: CropMasterRow; size: 480 | 960; className: string }> = ({ row, size, className }) => {
    const { src, onError } = useCropPicture({ masterId: row.id, name: row.en }, size);
    return src
        ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} className={`select-none object-cover ${className}`} />
        : <span aria-hidden="true" className={`grid place-items-center bg-gradient-to-br from-emerald-100 to-lime-100 text-emerald-700 ${className}`}><Sprout size={28} /></span>;
};

const Tile: React.FC<{ row: CropMasterRow; language: string; added: boolean; label: string; onPick: () => void }> = ({ row, language, added, label, onPick }) => (
    <Tap onClick={onPick} disabled={added} data-testid={`crop-tile-${row.id}`} aria-label={added ? `${cropLabel(row, language)} — ${label}` : cropLabel(row, language)}
        className="flex flex-col overflow-hidden rounded-2xl bg-white text-left ring-1 ring-stone-200 disabled:opacity-60">
        <CropPicture row={row} size={480} className="h-[72px] w-full" />
        <span className="flex min-h-[44px] items-center gap-1 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-stone-900 [overflow-wrap:anywhere]">{cropLabel(row, language)}</span>
            {added && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11.5px] font-extrabold text-emerald-800"><Check size={13} aria-hidden="true" />{label}</span>}
        </span>
    </Tap>
);

export const CropMasterPicker: React.FC<{
    language: string;
    /** The MHCR ids of the crops already on this farm. */
    onFarm: ReadonlySet<string>;
    /** Names already on this farm (a typed crop is never added twice). */
    onFarmNames: ReadonlySet<string>;
    onPick: (picked: PickedCrop) => void;
}> = ({ language, onFarm, onFarmNames, onPick }) => {
    const w = language === 'en' ? PICKER_WORDS.en : PICKER_WORDS.mr;
    const [query, setQuery] = useState('');
    const typed = query.trim();
    const hits = useMemo(() => searchCrops(typed, { onFarm }), [typed, onFarm]);
    const tiles = useMemo(() => cropTiles(onFarm), [onFarm]);
    const exact = hits.some(r => [r.en, r.mr, ...r.altEn, ...r.altMr].some(n => normName(n) === normName(typed)));
    const canAddTyped = typed.length >= 2 && !exact && !onFarmNames.has(normName(typed));

    return (
        <div className="space-y-3" data-testid="crop-picker">
            <label className="block">
                <span className="text-[13.5px] font-extrabold text-stone-700">{w.search}</span>
                <span className="mt-1 flex min-h-[52px] items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-stone-300 focus-within:ring-2 focus-within:ring-emerald-500">
                    <Search size={18} className="shrink-0 text-stone-500" aria-hidden="true" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder={w.searchHint} data-testid="crop-search"
                        className="min-w-0 flex-1 bg-transparent text-[17px] font-bold text-stone-900 outline-none" />
                </span>
            </label>

            {typed ? (
                <ul className="m-0 list-none space-y-2 p-0" data-testid="crop-results">
                    {hits.map(row => {
                        const added = onFarm.has(row.id);
                        const others = otherNamesIn(row, language).slice(0, 3).join(', ');
                        return (
                            <li key={row.id}>
                                <Tap onClick={() => onPick({ kind: 'master', row })} disabled={added} data-testid={`crop-result-${row.id}`}
                                    className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white px-2.5 py-2 text-left ring-1 ring-stone-200 disabled:opacity-60">
                                    <CropPicture row={row} size={480} className="h-11 w-11 shrink-0 rounded-xl" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[16px] font-extrabold leading-tight text-stone-900">{cropLabel(row, language)}</span>
                                        <span className="block text-[12.5px] font-semibold leading-snug text-stone-600">{[others, cropGroupLabel(row, language)].filter(Boolean).join(' · ')}</span>
                                    </span>
                                    {added && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-extrabold text-emerald-800"><Check size={14} aria-hidden="true" />{w.added}</span>}
                                </Tap>
                            </li>
                        );
                    })}
                    {hits.length === 0 && <li className="px-1 text-[14px] font-bold text-stone-600" data-testid="crop-results-none">{w.none}</li>}
                    {canAddTyped && (
                        <li>
                            <Tap onClick={() => onPick({ kind: 'typed', name: typed })} data-testid="crop-add-typed"
                                className="flex min-h-[52px] w-full items-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400 px-3 text-left text-[15px] font-extrabold text-emerald-800">
                                <Plus size={18} aria-hidden="true" />{w.addTyped(typed)}
                            </Tap>
                        </li>
                    )}
                </ul>
            ) : (
                <div>
                    <p className="m-0 mb-1.5 text-[13.5px] font-extrabold text-stone-700">{w.tilesTitle}</p>
                    <div className="grid grid-cols-3 gap-2" data-testid="crop-tiles">
                        {tiles.map(row => <Tile key={row.id} row={row} language={language} added={onFarm.has(row.id)} label={w.added} onPick={() => onPick({ kind: 'master', row })} />)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CropMasterPicker;
