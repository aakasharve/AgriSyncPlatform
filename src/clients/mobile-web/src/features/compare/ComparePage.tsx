/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-83 = 1, D-104, D-139 fifth note / F259; P4, P5, P9, P10)
 *
 * तुलना, drawn from the SERVER's read (`GET /shramsafal/farms/{farmId}/compare`, `useFarmCompare`): the phone does not compare its own logs
 * any more (the old engine files stay in the tree, unreferenced by this page, for the later clean-up lane).
 *
 *   Screen 1 = the log page's own crop -> plot selector (`CropSelector`, stepper layout, Sathi asks "कोणत्या पिकाची तुलना पाहायची ?"):
 *              a crop with ONE plot opens the compare straight away (the stepper chooses its only plot for him); a tap on a plot opens it.
 *   Screen 2 = `CompareView`: the crop+plot chip (tap = back to the selector), the stage line, the primary card, the other schedules, the
 *              four category tiles, the sheets.
 *
 * तुलना is a HOME TAB (PLR-D9 N5): no back arrow of its own. A worker does not reach this tab (`core/navigation/hiddenViews.ts`, unchanged;
 * the server refuses anyway). `logs` and `onTellPlot` / `onTell` are kept in the props for the caller; nothing here reads the phone's logs.
 */
import React, { useMemo, useState } from 'react';
import type { CropProfile, DailyLog, FarmerProfile, Plot } from '../../types';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
import { cropNameIn } from '../../shared/names/namesIn';
import CropSelector from '../context/components/CropSelector';
import { SathiAskBand } from '../logs/components/entry/SathiAskBand';
import { useFarmCompare } from './data/compareClient';
import { SANS_FONT } from './compareBits';
import { compareWords } from './compareWords';
import CompareView from './CompareView';

interface Props {
    /** Kept for callers; the page reads each crop's own plots. */
    plots?: Plot[];
    crops: CropProfile[];
    /** Kept for callers; the phone's logs are not read (the server counts). */
    logs?: DailyLog[];
    onTellPlot?: (cropId: string, plotId: string) => void;
    onTell?: () => void;
    /** "शेड्यूल निवडा": the real शेड्यूल page (the planning route). */
    onOpenSchedule?: () => void;
    /** The farmer's profile, for the mic's parse (the same one the log's recorder is given). */
    farmerProfile?: FarmerProfile;
}

type Picked = { cropId: string; plotId: string };

export const ComparePage: React.FC<Props> = ({ crops = [], onOpenSchedule, farmerProfile }) => {
    const language = useOptionalLanguage()?.language;
    const words = compareWords(language);
    const farm = useOptionalFarmContext();
    const farmId = farm?.currentFarmId ?? SessionStore.getCurrentFarmId() ?? null;
    const answer = useFarmCompare(farmId);

    const [picked, setPicked] = useState<Picked | null>(null);
    const [chosenCrops, setChosenCrops] = useState<string[]>([]);
    const [chosenPlots, setChosenPlots] = useState<Record<string, string[]>>({});

    const crop = picked ? crops.find(c => c.id === picked.cropId) ?? null : null;
    const plotName = crop?.plots.find(p => p.id === picked?.plotId)?.name ?? '';
    const chip = crop ? `${cropNameIn(crop.name, language ?? 'mr', crop.masterId)} · ${plotName}` : '';
    const plot = useMemo(() => (picked && answer?.kind === 'compare' ? answer.compare.plots.find(p => p.plotId === picked.plotId) ?? null : null), [picked, answer]);

    const backToSelector = () => { setPicked(null); setChosenCrops([]); setChosenPlots({}); };
    const onSelect = (cropIds: string[], plots: Record<string, string[]>) => {
        setChosenCrops(cropIds);
        setChosenPlots(plots);
        // a plot chosen (or a crop with one plot, which the stepper chooses for him): the compare opens
        for (const cropId of cropIds) {
            const first = plots[cropId]?.[0];
            if (first) { setPicked({ cropId, plotId: first }); return; }
        }
    };

    let body: React.ReactNode;
    if (crops.length === 0) {
        body = <p className="m-3 rounded-2xl bg-white p-4 text-[16px] font-bold leading-snug text-stone-800" data-testid="compare-no-plots">{words.noCropsAtAll}</p>;
    } else if (!picked) {
        const noPlots = chosenCrops.length > 0 && crops.filter(c => chosenCrops.includes(c.id)).every(c => c.plots.length === 0);
        body = (
            <div data-testid="compare-selector">
                <CropSelector
                    mode="log" layout="stepper" crops={crops}
                    selectedCrops={chosenCrops} selectedPlots={chosenPlots}
                    onSelectionChange={onSelect}
                    stepper={{
                        lead: ctx => (
                            <>
                                <SathiAskBand {...ctx} text={{ question: words.askCrop, hint: ctx.step === 'crop' ? words.askCropHint : words.askPlotHint }} />
                                {ctx.step === 'plot' && noPlots && <p className="m-0 mb-3 rounded-2xl bg-white p-3 text-[16px] font-bold text-stone-800" data-testid="compare-crop-no-plots">{words.cropNoPlots}</p>}
                            </>
                        ),
                        hideEntireFarm: true,
                        hideAddCrop: true,
                        calmRings: true, // two colours only: no amber ring on the chosen crop
                    }}
                />
            </div>
        );
    } else if (!farmId) {
        // a phone that knows no farm has nothing to ask: the same plain line as a refusal, never a loading line that never ends
        body = <ScreenLine chip={chip} words={words.change} onChange={backToSelector} line={words.refused} testId="compare-refused" />;
    } else if (answer === undefined) {
        body = <p className="m-3 rounded-2xl bg-white p-4 text-[16px] font-bold text-stone-800" data-testid="compare-loading" role="status">{words.loading}</p>;
    } else if (answer.kind === 'offline') {
        body = <ScreenLine chip={chip} words={words.change} onChange={backToSelector} line={words.offlineNothing} testId="compare-offline-nothing" />;
    } else if (answer.kind === 'none') {
        // the server refused (403/404: the farm's तुलना is not his to see) or the answer could not be read: nothing of an answer is drawn
        body = <ScreenLine chip={chip} words={words.change} onChange={backToSelector} line={words.refused} testId="compare-refused" />;
    } else {
        body = (
            <CompareView
                key={picked.plotId}
                result={answer} plot={plot} farmId={farmId} chip={chip} language={language}
                crops={crops} profile={farmerProfile} onChange={backToSelector} onOpenSchedule={onOpenSchedule}
            />
        );
    }

    return (
        <div className="mx-auto max-w-4xl" style={{ fontFamily: SANS_FONT }} data-testid="compare-page">{body}</div>
    );
};

const ScreenLine: React.FC<{ chip: string; words: string; onChange: () => void; line: string; testId: string }> = ({ chip, words, onChange, line, testId }) => (
    <div className="space-y-3 px-3 pt-2">
        <button type="button" onClick={onChange} data-testid="compare-chip" aria-label={`${chip} · ${words}`}
            className="flex min-h-[48px] w-full items-center gap-1.5 rounded-2xl border-2 border-emerald-700 bg-white px-3 text-left text-[16px] font-extrabold text-emerald-900">
            <span className="min-w-0 flex-1 truncate">{chip}</span><span className="shrink-0 text-[14px] font-bold text-stone-600">{words}</span>
        </button>
        <p className="m-0 rounded-2xl bg-white p-4 text-[16px] font-bold leading-snug text-stone-800" data-testid={testId} role="status">{line}</p>
    </div>
);

export default ComparePage;
