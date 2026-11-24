/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7 "plot head") - ONE row: the crop's photo, "G1 · २ एकर" (plot name and area from the plot's own
 * record), under it "<current stage> · छाटणी <start date>", and on the RIGHT "प्लॉट बदला" (opens the ONE canonical crop-then-plot selector). Every number is the phone's own; a part it
 * does not hold is left out (never a made-up area or date, P4). Marathi mode: Devanagari digits.
 */
import React from 'react';
import { PickerCropPhoto } from '../../context/components/CropPlotPicker';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { CropProfile, Plot } from '../../../types';
import { mrNum } from './scheduleCopy';
import type { ScheduleModel } from './scheduleModel';

const UNIT = { mr: { Acre: 'एकर', Guntha: 'गुंठा', Are: 'आर' }, en: { Acre: 'acre', Guntha: 'guntha', Are: 'are' } } as const;

export const HEAD_WORDS = {
    mr: { change: 'प्लॉट बदला', start: 'छाटणी', startOther: 'सुरुवात' },
    en: { change: 'Change plot', start: 'pruning', startOther: 'start' },
} as const;

/** "२ एकर" / "2 acre", or null when the plot has no area on this phone. */
export function areaText(plot: Plot | null | undefined, language: 'mr' | 'en'): string | null {
    const a = plot?.baseline?.totalArea;
    if (!a || !Number.isFinite(a) || a <= 0) return null;
    const unit = UNIT[language][plot?.baseline?.unit ?? 'Acre'] ?? '';
    const n = Number.isInteger(a) ? String(a) : String(Math.round(a * 100) / 100);
    return `${language === 'mr' ? mrNum(n) : n} ${unit}`.trim();
}

/** The calendar day the schedule starts (its stored day 0), as "१५ ऑक्टो", or null when the model does not hold that day. */
export function startDateText(model: ScheduleModel, language: 'mr' | 'en'): string | null {
    const day = model.days.find(d => d.day === 0);
    if (!day) return null;
    try {
        return new Intl.DateTimeFormat(language === 'mr' ? 'mr-IN-u-nu-deva' : 'en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day.key}T00:00:00Z`));
    } catch { return day.key; }
}

export const ScheduleTabHead: React.FC<{
    crop: CropProfile;
    plot: Plot;
    model: ScheduleModel;
    isGrape: boolean;
    onChangePlot?: () => void;
}> = ({ crop, plot, model, isGrape, onChangePlot }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = HEAD_WORDS[language];
    const area = areaText(plot, language);
    const start = startDateText(model, language);
    const stageLine = [model.currentStage?.name ?? null, start ? `${isGrape ? words.start : words.startOther} ${start}` : null].filter(Boolean).join(' · ');
    return (
        <section className="flex items-center gap-3" data-testid="plot-head">
            <PickerCropPhoto crop={{ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }} px={48} />
            <div className="min-w-0 flex-1">
                <h2 className="m-0 truncate text-[20px] font-black leading-tight text-stone-900" data-testid="plot-head-name">{plot.name}{area ? ` · ${area}` : ''}</h2>
                {stageLine && <p className="m-0 text-[14px] font-bold leading-snug text-stone-600" data-testid="plot-head-stage">{stageLine}</p>}
            </div>
            {onChangePlot && (
                <button type="button" onClick={onChangePlot} data-testid="change-plot"
                    className="min-h-[48px] shrink-0 rounded-full border-2 border-emerald-700 bg-white px-4 text-[16px] font-extrabold text-emerald-900">{words.change}</button>
            )}
        </section>
    );
};
