/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 8; version 7) - the plot lists below the tab: one block per crop (in the canonical order of the
 * crops the seat holds - a worker or a mukadam is given only his own plots, so only they are listed), inside it one box per schedule the plots follow (its name and
 * "N plots") with a chip per plot, and a dashed "no schedule" box for plots that follow none. Tapping a chip chooses the plot (the page above changes). Pure view of
 * `scheduleMapModel`; the picture map with its schedule lighting stays reachable in its own row under it.
 */
import React from 'react';
import { PickerCropPhoto, PlotCount } from '../../context/components/CropPlotPicker';
import type { CropProfile } from '../../../types';
import { scheduleNameMr } from './scheduleNames';
import { scheduleMapWords, type ScheduleMapLanguage } from './scheduleMapCopy';
import type { MapPlot, ScheduleMapModel } from './scheduleMapModel';

export const PlotChipLists: React.FC<{
    crops: readonly CropProfile[];
    model: ScheduleMapModel;
    selectedPlotId: string;
    onPickPlot: (cropId: string, plotId: string) => void;
    language: ScheduleMapLanguage;
}> = ({ crops, model, selectedPlotId, onPickPlot, language }) => {
    const words = scheduleMapWords(language);
    const byId = new Map<string, MapPlot>([...model.plots, ...model.unscheduled].map(p => [p.plotId, p]));
    const nameOf = (key: string): string => {
        const s = model.schedules.find(x => x.key === key);
        return s ? (language === 'mr' ? scheduleNameMr(s.template.name) : s.template.name) : '';
    };
    return (
        <div className="space-y-3" data-testid="plot-chip-lists">
            {crops.filter(c => c.plots.length > 0).map(crop => {
                const plots = crop.plots.map(p => byId.get(p.id)).filter((p): p is MapPlot => !!p);
                const groups = new Map<string, MapPlot[]>();
                for (const p of plots) { const k = p.mainKey ?? ''; groups.set(k, [...(groups.get(k) ?? []), p]); }
                const first = plots[0];
                return (
                    <section key={crop.id} className="space-y-2 rounded-3xl border border-stone-200 bg-white p-3" data-testid={`chip-crop-${crop.id}`}>
                        <div className="flex items-center gap-3">
                            <PickerCropPhoto crop={{ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }} px={44} />
                            <div className="min-w-0">
                                <p className="m-0 truncate text-[18px] font-black text-stone-900">{first?.cropName ?? crop.name}</p>
                                <p className="m-0 text-[13px] font-bold text-stone-600"><PlotCount total={crop.plots.length} language={language} /></p>
                            </div>
                        </div>
                        {[...groups.entries()].map(([key, list]) => (
                            <div key={key || 'none'} className={`space-y-2 rounded-2xl border-2 p-2 ${key ? 'border-emerald-600' : 'border-dashed border-stone-400'}`} data-testid={`chip-group-${key || 'none'}`}>
                                <p className="m-0 text-[15px] font-extrabold text-stone-900">{key ? `${nameOf(key)} · ` : `${words.noScheduleGroup} · `}<PlotCount total={list.length} language={language} /></p>
                                <div className="flex flex-wrap gap-2">
                                    {list.map(p => (
                                        <button key={p.plotId} type="button" onClick={() => onPickPlot(p.cropId, p.plotId)} aria-pressed={p.plotId === selectedPlotId} data-testid={`chip-plot-${p.plotId}`}
                                            className={`min-h-[48px] rounded-full border-2 px-4 text-[16px] font-extrabold ${p.plotId === selectedPlotId ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-emerald-600 bg-white text-emerald-900'}`}>
                                            {p.plotName}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                );
            })}
        </div>
    );
};
