/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P7; R2-A item 14; founder A9.2: a plot may have many sources and motors) -
 * "या प्लॉटला पाण्याची सोय कशी केली आहे?": a tick for each motor of each of the FARM's sources (one or more; a source with no motor, or a canal, can be
 * ticked without a motor - by gravity), then the method ठिबक / पाट पाणी / तुषार / पाण्याची सोय नाही. "पाण्याची सोय नाही" takes no link (the server
 * refuses `none` with links). The farm has no source yet: "आधी पाण्याचा स्रोत जोडा" with a door to पाणी आणि वीज - the method can still be said, and
 * the plot is still saved (बाकी). Used by add plot (step 3) and by the plot card. The page's font is inherited.
 */
import React from 'react';
import { Check, Droplets } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { FarmSetupWaterSource, PlotWaterLink, PlotWaterMethod } from '../../../domain/types/farmSetup.types';
import { PLOT_WATER_METHODS } from '../../../domain/types/farmSetup.types';
import { farmSetupWords } from './farmSetupWords';

export interface PlotWaterAnswer {
    method: PlotWaterMethod | null;
    links: PlotWaterLink[];
}

interface Props {
    sources: readonly FarmSetupWaterSource[];
    value: PlotWaterAnswer;
    onChange: (next: PlotWaterAnswer) => void;
    language?: string | null;
    onOpenWaterPage?: () => void;
}

const sameLink = (a: PlotWaterLink, b: PlotWaterLink) => a.waterSourceId === b.waterSourceId && a.motorId === b.motorId;

/** The ticks a source offers: each motor; and "without a motor" for a source with none, or a canal (gravity). */
function ticksOf(source: FarmSetupWaterSource): PlotWaterLink[] {
    const motors = source.motors.map(m => ({ waterSourceId: source.id, motorId: m.id }));
    const gravity = source.motors.length === 0 || source.sourceType === 'canal' ? [{ waterSourceId: source.id, motorId: null }] : [];
    return [...motors, ...gravity];
}

export const PlotWaterQuestion: React.FC<Props> = ({ sources, value, onChange, language, onOpenWaterPage }) => {
    const w = farmSetupWords(language).plotWater;
    const noWater = value.method === 'none';
    const toggle = (link: PlotWaterLink) => {
        const has = value.links.some(l => sameLink(l, link));
        onChange({ ...value, links: has ? value.links.filter(l => !sameLink(l, link)) : [...value.links, link] });
    };
    const pickMethod = (method: PlotWaterMethod) => onChange({ method, links: method === 'none' ? [] : value.links });

    return (
        <div className="space-y-2.5" data-testid="plot-water-question">
            <p className="m-0 text-[16px] font-extrabold text-stone-800">{w.question}</p>
            {sources.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-orange-50 p-3 ring-1 ring-orange-300" data-testid="plot-water-no-source">
                    <p className="m-0 min-w-0 flex-1 basis-[9rem] text-[14.5px] font-extrabold text-orange-900">{w.noSourceYet}</p>
                    {onOpenWaterPage && (
                        <Tap onClick={onOpenWaterPage} data-testid="plot-water-open-water-page"
                            className="min-h-[44px] shrink-0 rounded-full bg-orange-700 px-4 text-[14px] font-extrabold text-white">{w.openWaterPage}</Tap>
                    )}
                </div>
            ) : (
                <>
                    <p className="m-0 text-[13.5px] font-semibold text-stone-600">{w.sourcesHint}</p>
                    {sources.map(source => (
                        <div key={source.id} className="space-y-1.5 rounded-2xl bg-white p-2.5 ring-1 ring-stone-200">
                            <p className="m-0 flex items-center gap-1.5 text-[14.5px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">
                                <Droplets size={16} className="shrink-0 text-blue-700" aria-hidden="true" />{source.name}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {ticksOf(source).map(link => {
                                    const on = value.links.some(l => sameLink(l, link));
                                    const label = link.motorId ? (source.motors.find(m => m.id === link.motorId)?.name ?? '') : w.noMotor;
                                    return (
                                        <Tap key={`${link.waterSourceId}-${link.motorId ?? 'none'}`} onClick={() => toggle(link)} disabled={noWater} aria-pressed={on}
                                            data-testid={`plot-water-link-${link.waterSourceId}-${link.motorId ?? 'none'}`}
                                            className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-[14px] font-extrabold disabled:opacity-40 ${on ? 'bg-blue-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>
                                            {on && <Check size={15} aria-hidden="true" />}{label}
                                        </Tap>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </>
            )}
            <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{w.method}</p>
            <div className="flex flex-wrap gap-1.5">
                {PLOT_WATER_METHODS.map(method => (
                    <Tap key={method} onClick={() => pickMethod(method)} aria-pressed={value.method === method} data-testid={`plot-water-method-${method}`}
                        className={`min-h-[44px] rounded-full px-3.5 text-[14.5px] font-extrabold ${value.method === method ? 'bg-emerald-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>
                        {w.methods[method]}
                    </Tap>
                ))}
            </div>
        </div>
    );
};
