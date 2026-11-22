/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, picture S3; notes 5.2 / 5.4 / 5.5) - the PICTURE MAP at the top of the
 * शेड्यूल tab: plots on the left (each with its crop's photo, its name and its day), the schedules they follow on the right (each with its maker's
 * badge, its name and "N प्लॉट"), and a coloured line from every plot to its schedule. Two plots on one schedule read at a glance: two lines into
 * one card. Each schedule has ONE colour (the farmer's own is green); the line, the card's border and a bar on the plot's own card all wear it, so the
 * join survives even where a line is hard to follow on a 360 px phone.
 *
 *   - tapping a PLOT chooses it: the page below shows that plot's schedule exactly as before;
 *   - tapping a SCHEDULE card lights every plot that follows it (and dims the rest); tapping it again clears it;
 *   - plots that follow no schedule sit in a dashed "शेड्यूल नाही" group, each with "शेड्यूल निवडा" that opens the library for THAT plot.
 * A pure view: it holds no choice of its own (only which schedule is lit) and decides nothing; the model and the rows' places are plain data
 * (`scheduleMapModel`).
 */
import React, { useMemo, useState } from 'react';
import { PickerCropPhoto, PlotCount } from '../../context/components/CropPlotPicker';
import { scheduleNameMr } from './scheduleNames';
import { shownScheduleDay } from './scheduleDates';
import { ScheduleMakerBadge } from '../pictures/ScheduleMakerBadge';
import { MAP_PLOT_H, layoutScheduleMap, type MapPlot, type MapSchedule, type ScheduleMapModel } from './scheduleMapModel';
import { scheduleMapWords, type ScheduleMapLanguage } from './scheduleMapCopy';

/** The width of the gap the lines cross (px); the two columns share the rest. */
const GAP_W = 40;

const PlotFace: React.FC<{ plot: MapPlot; day: string }> = ({ plot, day }) => (
    <>
        <PickerCropPhoto crop={{ name: plot.cropRawName, iconName: plot.iconName, masterId: plot.masterId }} px={40} />
        <span className="min-w-0 flex-1">
            <span className="line-clamp-1 block break-words text-[14px] font-extrabold leading-tight text-stone-900" data-part="plot-name">{plot.plotName}</span>
            <span className="block truncate text-[12px] font-bold leading-tight text-stone-600" data-part="plot-day">{day}</span>
        </span>
    </>
);

export const SchedulePictureMap: React.FC<{
    model: ScheduleMapModel;
    /** The plot whose schedule the page shows below. */
    selectedPlotId: string;
    onPickPlot: (cropId: string, plotId: string) => void;
    /** "शेड्यूल निवडा" on a plot that follows none: open the library with THAT plot chosen. */
    onChooseSchedule: (cropId: string, plotId: string) => void;
    language?: ScheduleMapLanguage;
}> = ({ model, selectedPlotId, onPickPlot, onChooseSchedule, language = 'mr' }) => {
    const words = scheduleMapWords(language);
    const [litRaw, setLit] = useState<string | null>(null);
    // A lit schedule that is no longer on the map (its last plot chose another) lights nothing and dims nothing.
    const lit = litRaw !== null && model.schedules.some(s => s.key === litRaw) ? litRaw : null;
    const layout = useMemo(() => layoutScheduleMap(model), [model]);
    const colourOf = useMemo(() => new Map(model.schedules.map(s => [s.key, s.colour])), [model]);
    const litPlots = useMemo(() => new Set(lit ? model.schedules.find(s => s.key === lit)?.plotIds ?? [] : []), [lit, model]);
    const dayOf = (p: MapPlot): string => (p.day === null ? '' : p.day >= 0 ? words.dayN(shownScheduleDay(p.day)) : words.dayNotStarted);

    const pick = (p: MapPlot) => { setLit(null); onPickPlot(p.cropId, p.plotId); };

    const plotCard = (p: MapPlot) => {
        const selected = p.plotId === selectedPlotId;
        const colour = p.mainKey ? colourOf.get(p.mainKey) : undefined;
        const isLit = lit !== null && litPlots.has(p.plotId);
        const dim = lit !== null && !isLit;
        return (
            <button key={p.plotId} type="button" onClick={() => pick(p)} aria-pressed={selected} data-testid={`map-plot-${p.plotId}`}
                data-schedule={p.mainKey ?? ''} data-colour={colour ?? ''} data-selected={selected ? 'yes' : 'no'} data-lit={isLit ? 'yes' : 'no'}
                style={{ top: layout.plotTop[p.plotId], height: MAP_PLOT_H, ...(isLit && colour ? { boxShadow: `0 0 0 3px ${colour}55` } : {}) }}
                className={`absolute inset-x-0 flex items-center gap-1.5 overflow-hidden rounded-2xl border-2 py-1.5 pl-3 pr-1.5 text-left transition active:scale-[0.98] ${selected ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'} ${dim ? 'opacity-45' : ''}`}>
                {colour && <span aria-hidden="true" data-part="bar" className="absolute inset-y-0 left-0 w-1.5" style={{ background: colour }} />}
                <PlotFace plot={p} day={dayOf(p)} />
                {p.keys.length > 1 && (
                    <span className="absolute bottom-1 right-1.5 rounded-full bg-stone-100 px-1.5 text-[10.5px] font-extrabold leading-4 text-stone-700" data-part="also">{words.alsoFollows(p.keys.length - 1)}</span>
                )}
            </button>
        );
    };

    const scheduleCard = (s: MapSchedule) => {
        const place = layout.schedule[s.key];
        const on = lit === s.key;
        const tall = place.height >= 110;
        const name = scheduleNameMr(s.template.name);
        return (
            <button key={s.key} type="button" onClick={() => setLit(on ? null : s.key)} aria-pressed={on} data-testid={`map-schedule-${s.key}`}
                data-colour={s.colour} data-plots={s.plotIds.length} data-own={s.own ? 'yes' : 'no'}
                style={{ top: place.top, height: place.height, borderColor: s.colour, ...(on ? { boxShadow: `0 0 0 3px ${s.colour}55` } : {}) }}
                className={`absolute inset-x-0 flex overflow-hidden rounded-2xl border-[3px] bg-white p-1.5 text-center transition active:scale-[0.98] ${tall ? 'flex-col items-center justify-center gap-1' : 'items-center gap-1.5 text-left'}`}>
                <ScheduleMakerBadge template={s.template} size={tall ? 44 : 34} tone="light" testId={`map-badge-${s.key}`} />
                <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block break-words text-[12px] font-extrabold leading-tight text-stone-900" data-part="schedule-name">{name}</span>
                    <span className="mt-0.5 inline-block rounded-full px-2 text-[11px] font-extrabold leading-[18px] text-white" style={{ background: s.colour }} data-part="plot-count">
                        <PlotCount total={s.plotIds.length} language={language} />
                    </span>
                </span>
            </button>
        );
    };

    return (
        <section className="space-y-2" data-testid="schedule-map" aria-label={words.mapAria}>
            {model.plots.length > 0 && (
                <div className="grid" style={{ gridTemplateColumns: `minmax(0,1fr) ${GAP_W}px minmax(0,1fr)`, height: layout.height }} data-testid="schedule-map-board">
                    <div className="relative" role="group" aria-label={words.plotsAria}>{model.plots.map(plotCard)}</div>
                    <svg width="100%" height={layout.height} viewBox={`0 0 100 ${layout.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" data-testid="schedule-map-lines">
                        {layout.lines.map(l => {
                            const dim = lit !== null && !(lit === l.key && litPlots.has(l.plotId));
                            return (
                                <path key={`${l.plotId}-${l.key}`} d={`M0 ${l.y1} C50 ${l.y1}, 50 ${l.y2}, 100 ${l.y2}`} fill="none" stroke={colourOf.get(l.key)}
                                    strokeWidth={l.main ? 3 : 2} strokeDasharray={l.main ? undefined : '5 4'} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={dim ? 0.2 : 1}
                                    data-testid={`map-line-${l.plotId}-${l.key}`} data-colour={colourOf.get(l.key)} data-main={l.main ? 'yes' : 'no'} />
                            );
                        })}
                    </svg>
                    <div className="relative" role="group" aria-label={words.schedulesAria}>{model.schedules.map(scheduleCard)}</div>
                </div>
            )}

            {model.unscheduled.length > 0 && (
                <div className="space-y-1.5 rounded-2xl border-2 border-dashed border-stone-400 bg-white p-2" data-testid="map-unscheduled">
                    <p className="m-0 px-1 text-[14px] font-extrabold text-stone-700" data-testid="map-unscheduled-title">{words.noScheduleGroup}</p>
                    {model.unscheduled.map(p => {
                        const selected = p.plotId === selectedPlotId;
                        return (
                            <div key={p.plotId} className="flex flex-wrap items-center gap-2" data-testid={`map-unscheduled-${p.plotId}`}>
                                <button type="button" onClick={() => pick(p)} aria-pressed={selected} data-testid={`map-plot-${p.plotId}`} data-schedule="" data-selected={selected ? 'yes' : 'no'}
                                    className={`flex min-h-[52px] min-w-0 flex-1 items-center gap-1.5 rounded-2xl border-2 px-1.5 py-1 text-left active:scale-[0.98] ${selected ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-stone-50'}`}>
                                    <PlotFace plot={p} day="" />
                                </button>
                                <button type="button" onClick={() => onChooseSchedule(p.cropId, p.plotId)} data-testid={`map-choose-${p.plotId}`}
                                    className="min-h-[48px] shrink-0 rounded-xl border-2 border-[#1448E6] bg-white px-3 text-[14.5px] font-extrabold text-[#1448E6] active:scale-95">
                                    {words.chooseSchedule}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {model.emptyCrops.map(c => (
                <p key={c.id} className="m-0 px-1 text-[14px] font-bold text-stone-600" data-testid={`map-empty-crop-${c.id}`}>{words.cropNoPlots(c.name)}</p>
            ))}
        </section>
    );
};

export default SchedulePictureMap;
