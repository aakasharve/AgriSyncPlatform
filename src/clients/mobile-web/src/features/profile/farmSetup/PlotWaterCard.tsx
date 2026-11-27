/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P7) - a plot's water on its card in पिकं आणि प्लॉट, from the FARM's set: one
 * line (`plotWaterLine`), the honest lines (waiting / refused), and - for a person who may change the farm setup - "पाण्याची सोय बदला": the same
 * question as add plot, saved whole through `farmsetup.plot_water.set` on the revision the phone last received.
 */
import React, { useState } from 'react';
import { Droplets, Pencil } from 'lucide-react';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { LocalFarmSetup } from './farmSetupLocal';
import { closeRefusedChange, setPlotWater } from './farmSetupCommands';
import { RefusedBox, SetupMessage, WaitingLine, saveProblemWords } from './FarmSetupLines';
import { farmSetupWords } from './farmSetupWords';
import { liveLinks, plotWaterLine } from './plotWaterModel';
import { PlotWaterQuestion, type PlotWaterAnswer } from './PlotWaterQuestion';

interface Props {
    plotId: string;
    farmSetup: LocalFarmSetup;
    canEdit: boolean;
    language?: string | null;
    onOpenWaterPage?: () => void;
}

export const PlotWaterCard: React.FC<Props> = ({ plotId, farmSetup, canEdit, language, onOpenWaterPage }) => {
    const w = farmSetupWords(language).plotWater;
    const sources = farmSetup.waterSources.map(s => s.item);
    const entry = farmSetup.plotWater.get(plotId) ?? null;
    const [editing, setEditing] = useState<PlotWaterAnswer | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const open = (answer?: PlotWaterAnswer) => setEditing(answer ?? { method: entry?.item.method ?? null, links: liveLinks(entry?.item, sources) });
    const save = async () => {
        if (!editing?.method) return;
        try {
            await setPlotWater({ farmId: farmSetup.farmId, plotId, method: editing.method, links: editing.links });
        } catch (error) {
            const said = saveProblemWords(error, language);
            if (!said) throw error;
            setMessage(said);
            return;
        }
        setMessage(null);
        setEditing(null);
    };

    return (
        <div className="space-y-1.5" data-testid={`plot-water-${plotId}`}>
            <p className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-stone-700" data-testid={`plot-water-line-${plotId}`}>
                <Droplets size={14} className="shrink-0 text-blue-700" aria-hidden="true" />{plotWaterLine(entry?.item, sources, language)}
            </p>
            {entry?.state === 'waiting' && <WaitingLine language={language} />}
            {entry?.refusal && <RefusedBox refusal={entry.refusal} language={language} onSeeNew={() => { void closeRefusedChange(entry.refusal!.rowId); }}
                onRedo={canEdit ? () => {
                    const typed = entry.refusal!.payload as { method?: PlotWaterAnswer['method']; links?: { waterSourceId: string; motorId?: string }[] };
                    void closeRefusedChange(entry.refusal!.rowId).then(() => open({
                        method: typed.method ?? null, links: (typed.links ?? []).map(l => ({ waterSourceId: l.waterSourceId, motorId: l.motorId ?? null })),
                    }));
                } : undefined} />}
            {editing ? (
                <div className="space-y-2 rounded-2xl bg-blue-50/60 p-2.5 ring-1 ring-blue-200">
                    <PlotWaterQuestion sources={sources} value={editing} onChange={setEditing} language={language} onOpenWaterPage={onOpenWaterPage} />
                    <SetupMessage text={message} />
                    <div className="grid grid-cols-2 gap-2">
                        <Tap onClick={() => { setEditing(null); setMessage(null); }} data-testid="plot-water-cancel"
                            className="min-h-[46px] rounded-full bg-white text-[14px] font-extrabold text-stone-700 ring-1 ring-stone-300">{w.cancel}</Tap>
                        <Tap onClick={() => { void save(); }} disabled={!editing.method} data-testid="plot-water-save"
                            className="min-h-[46px] rounded-full bg-emerald-700 text-[14px] font-extrabold text-white disabled:opacity-40">{w.save}</Tap>
                    </div>
                </div>
            ) : canEdit && (
                <Tap onClick={() => open()} data-testid={`plot-water-change-${plotId}`}
                    className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-white text-[14px] font-extrabold text-blue-800 ring-1 ring-blue-200">
                    <Pencil size={15} aria-hidden="true" />{w.change}
                </Tap>
            )}
        </div>
    );
};
