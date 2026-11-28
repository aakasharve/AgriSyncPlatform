/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the result's top card as the final design draws it
 * (result-v12-final.html `.hdr`): the crop's photo, its name, the plot selector, and "आज कोणी सांगितलं" with each speaker's count.
 *
 *   - The photo is the crop page's own picture (`useCropPicture`: the published crop image by its master id, else the app's photo of
 *     the same crop, else a plain sprout mark); the whole farm has the app's whole-farm picture.
 *   - The plot selector names the plot(s) of this talk. It is a button only when tapping it can really change the plot: it opens
 *     the existing "बदला" screen for this log, whose "प्लॉट बदला" moves a saved entry (`canMoveSavedEntry`). A talk that named several
 *     plots (one log each) shows them as a plain chip (P5: never a control that cannot do what it shows).
 *   - The day chip (the existing move-day, lane OF-S) stays beside it when the day can be moved or is not today.
 */
import React from 'react';
import { MapPin, Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { cropNameIn } from '../../../../shared/names/namesIn';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { CropProfile, DailyLog } from '../../../../types';
import { ENTIRE_FARM_IMAGE, useCropPicture } from '../../../context/components/cropImage';
import type { Speaker } from '../voiceResult/resultModel';
import { resultStr } from '../voiceResult/resultStrings';
import { SANS } from './savedBits';

const SERIF = "'Noto Serif Devanagari', serif";
const FARM_GLOBAL = 'FARM_GLOBAL';

/** The crop and plot(s) a talk is about, as the log names them. */
export interface HeadPlace {
    /** The crop as stored (shown through `cropNameIn`); '' for the whole farm or several crops. */
    cropName: string;
    cropId: string | null;
    plotNames: string[];
    wholeFarm: boolean;
    severalCrops: boolean;
}

export function headPlaceOf(logs: readonly DailyLog[]): HeadPlace {
    const sel = logs.flatMap(l => l.context?.selection ?? []);
    const wholeFarm = sel.length === 0 || sel.every(s => s.cropId === FARM_GLOBAL);
    const crops = [...new Set(sel.filter(s => s.cropId !== FARM_GLOBAL).map(s => s.cropId).filter(Boolean))];
    const first = sel.find(s => s.cropId !== FARM_GLOBAL);
    return {
        cropName: wholeFarm || crops.length > 1 ? '' : (first?.cropName ?? ''),
        cropId: wholeFarm || crops.length > 1 ? null : (first?.cropId ?? null),
        plotNames: [...new Set(sel.flatMap(s => s.selectedPlotNames ?? []).filter(Boolean))],
        wholeFarm,
        severalCrops: crops.length > 1,
    };
}

const CropPhoto: React.FC<{ name: string; iconName?: string; masterId?: string; alt: string }> = ({ name, iconName, masterId, alt }) => {
    const { src, onError } = useCropPicture({ name, iconName, masterId }, 480);
    return src
        ? <img src={src} alt={alt} width={60} height={60} onError={onError} draggable={false} data-testid="vr2-crop-photo"
            className="h-[60px] w-[60px] flex-none select-none rounded-[14px] object-cover shadow-[0_0_0_2px_#E3F3E8,0_2px_6px_rgba(0,0,0,0.08)]" />
        : <span className="grid h-[60px] w-[60px] flex-none place-items-center rounded-[14px] bg-emerald-100 text-emerald-700" data-testid="vr2-crop-photo-none"><Sprout size={34} aria-hidden="true" /></span>;
};

export interface ResultHeadProps {
    logs: readonly DailyLog[];
    crops?: readonly CropProfile[];
    /** The place as the screen already words it (used for the whole farm and several crops). */
    placeLabel: string;
    speakers: readonly Speaker[];
    /** "आज कोणी सांगितलं" (or the day's own words for a recording saved for another day). */
    whoLabel: string;
    /** Opens the "बदला" screen of this log (where "प्लॉट बदला" is); absent = the plot is a plain chip. */
    onChangePlot?: () => void;
    /** The existing day chip, when it is offered. */
    dayChip?: React.ReactNode;
}

export const ResultHead: React.FC<ResultHeadProps> = ({ logs, crops, placeLabel, speakers, whoLabel, onChangePlot, dayChip }) => {
    const language = useOptionalLanguage()?.language;
    const RS = resultStr(language);
    const place = headPlaceOf(logs);
    const crop = place.cropId ? crops?.find(c => c.id === place.cropId) : undefined;
    const title = place.wholeFarm ? RS.wholeFarm : place.severalCrops ? placeLabel : cropNameIn(place.cropName, language, crop?.masterId) || placeLabel;
    const plots = place.plotNames.join(', ');
    const chip = 'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border-[1.5px] border-[#94A3B8] bg-white px-3 py-[5px] text-[14px] font-extrabold text-[#1C1917]';
    return (
        <div className="flex flex-col gap-2 rounded-[20px] border border-[#E5E7E1] bg-white px-3 py-2.5" data-testid="vr2-head" style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-3">
                {place.wholeFarm
                    ? <img src={ENTIRE_FARM_IMAGE} alt="" width={60} height={60} draggable={false} data-testid="vr2-crop-photo"
                        className="h-[60px] w-[60px] flex-none select-none rounded-[14px] object-cover" />
                    : <CropPhoto name={crop?.name ?? place.cropName} iconName={crop?.iconName} masterId={crop?.masterId} alt={title} />}
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <b className="text-[18px] font-bold leading-[1.2]" style={{ fontFamily: SERIF }} data-testid="vr2-crop-name">{title}</b>
                    <div className="flex max-w-full flex-wrap items-center gap-1.5">
                        {plots && (onChangePlot ? (
                            <button type="button" onClick={onChangePlot} className={`${chip} active:scale-95`} data-testid="vr2-plot-select" data-can-change="yes">
                                <MapPin size={14} className="flex-none text-[#0F6B3A]" aria-hidden="true" />
                                <span className="truncate">{plots}</span>
                                <span className="text-[12px] text-[#5F6B63]" aria-hidden="true">▾</span>
                            </button>
                        ) : (
                            <span className={chip} data-testid="vr2-plot-select" data-can-change="no">
                                <MapPin size={14} className="flex-none text-[#0F6B3A]" aria-hidden="true" />
                                <span className="truncate">{plots}</span>
                            </span>
                        ))}
                        {dayChip}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#E5E7E1] pt-2 text-[12.5px] font-extrabold text-[#5F6B63]" data-testid="vr2-speakers">
                <span>{whoLabel}:</span>
                {speakers.map(s => (
                    <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                        className={`rounded-full border px-2.5 py-px text-[12.5px] font-extrabold ${s.you ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#14532D]' : 'border-[#93C5FD] bg-[#EFF6FF] text-[#1E3A8A]'}`}>
                        {s.name} · {digitsFor(RS.times(s.times), language)}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default ResultHead;
