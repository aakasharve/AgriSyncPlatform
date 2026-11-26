/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "पिकं आणि प्लॉट" — crops, their schedule and their plots.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look over the SAME
 * props and handlers as before (state stays in `useCropPlotState`; changes go out through the
 * page's `onUpdateCrops`). Every real control is kept:
 *   - add a crop — spec I18: chosen from the founder's crop master (`CropMasterPicker`: picture tiles, search by any
 *     name, or a crop he types that the list does not have), the same duplicate rule (a crop already on the farm
 *     cannot be chosen again), save, cancel. The chosen crop is stored by its English name (the server keeps crop
 *     names in English) with its MHCR id; every crop name is SHOWN in the app's language (`cropNameIn`);
 *   - per crop (redesign item 7, UI-9a): the crop's photo once, "<N> प्लॉट", one sentence COUNTED FROM THE PLOTS ("१५ पैकी १३ प्लॉटवर शेड्यूल")
 *     with "शेड्यूल बघा" (opens the schedule tab on this crop), or the orange "शेड्यूल नाही" with "निवडा" (the schedule library) when no plot
 *     follows one. From 4 plots the plots are the shared grid (`SinglePlotSection`) and the tapped plot's card opens under it; up to 3 plots
 *     keep one card each, as before;
 *   - per plot: area + unit, irrigation, "mapped"; draw / redraw its boundary; remove it — the redraw
 *     and remove buttons used to appear only on mouse hover, so a phone could not see them; they are
 *     now always shown, and removing asks first;
 *   - add a plot → the 3-step AddPlotWizard (rendered by ProfilePage, unchanged).
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, MapPin, Plus, Sprout, Trash2 } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { cropById, cropLabel, normName } from '../../../domain/crops/cropMaster';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { cropMasterIdOf } from '../../context/components/cropImage';
import CropMasterPicker, { CropPicture, type PickedCrop } from '../components/CropMasterPicker';
import type { CropProfile, Plot } from '../../../domain/types/farm.types';
import { PlotCount } from '../../context/components/CropPlotPicker';
import { PlotGroupHeader, SinglePlotSection } from '../../context/components/PlotSelector';
import { photoOnceFor } from '../../context/components/plotSelectorRules';
import { usePlotScheduleChoices } from '../../scheduler/schedulePage/usePlotScheduleChoices';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { BigButton, GlassCard, IconDot, Tap } from '../../../shared/components/ui/placeUi';
import { IRRIGATION_LABEL, LAND_UNIT_LABEL } from '../components/setupLabels';
import { SCHEDULE_LINE_WORDS, plotsFollowingCount, scheduleLineText } from './cropScheduleLine';
import { cropNameIn } from '../../../shared/names/namesIn';
import { PLOT_PENDING_WORDS, pendingPlots, type PlotPendingReason } from './plotPending';

/**
 * Repair FIX-1 item 5 (founder's word: RED) - the small red mark on a plot that still misses a link: the app's danger colour
 * (rose-600, the colour of its remove and refuse buttons), a dot in the tile's top-left corner, the tick keeps the right one.
 */
const PendingDot: React.FC<{ plotId: string }> = ({ plotId }) => (
    <span aria-hidden="true" data-testid={`plot-pending-dot-${plotId}`}
        className="absolute left-[3px] top-[3px] h-3 w-3 rounded-full bg-rose-600 ring-2 ring-white" />
);

interface StructureSectionProps {
    crops: CropProfile[];
    isAddingCrop: boolean;
    setIsAddingCrop: (v: boolean) => void;
    newCropData: Partial<CropProfile>;
    setNewCropData: (d: Partial<CropProfile>) => void;
    cropNameError: string;
    setCropNameError: (s: string) => void;
    normalizeCropName: (name: string) => string;
    normalizedNewCropName: string;
    isDuplicateCropName: boolean;
    handleAddCrop: () => void;
    setMappingPlotId: (v: { cropId: string, plotId: string } | null) => void;
    deletePlot: (cId: string, pId: string) => void;
    setWizardCropId: (id: string | null) => void;
    /**
     * lane 2b (D-15 via D-26) — the server lets this person add a plot ("edit farm setup"). False:
     * no add-plot door, since the server would refuse the plot (P5) — and no add-crop door either (FIX-1
     * round 1, Bug 3: a crop is part of the farm's structure too). Absent = true.
     */
    canAddPlot?: boolean;
    onOpenScheduleLibrary?: (cropId?: string) => void;
    /**
     * Redesign item 7 - "शेड्यूल बघा": open the शेड्यूल tab on this crop (its home view, not the library). Absent = the nearest door the page
     * has, `onOpenScheduleLibrary` (it opens the same tab on the same crop, on its library view).
     */
    onOpenSchedule?: (cropId?: string) => void;
}

/** The hook's error strings are English; the farmer reads one of these two instead. */
const DUPLICATE_CROP = 'हे पीक आधीच जोडलेलं आहे — एक पीक एकदाच जोडता येतं.';
const CROP_NAME_NEEDED = 'पिकाचं नाव लिहा (किमान २ अक्षरं).'; // UI-9a item 9: Marathi digit
// PROPOSED (English) — the same two reasons in English mode (spec I18: English mode shows English only).
const DUPLICATE_CROP_EN = 'This crop is already added — a crop can be added only once.';
const CROP_NAME_NEEDED_EN = 'Write the crop name (at least 2 letters).';
// PROPOSED (Marathi) / PROPOSED (English) — the add-crop form's own words, per language.
const FORM_WORDS = {
    mr: { change: 'बदला', save: 'पीक जतन करा', cancel: 'रद्द', typed: 'तुम्ही लिहिलेलं नाव' },
    en: { change: 'Change', save: 'Save crop', cancel: 'Cancel', typed: 'The name you typed' },
} as const;

/**
 * The crop's one schedule line, counted from its plots (never from the crop-level field). Some plots follow a schedule: a calm box with the
 * sentence and "शेड्यूल बघा" (the शेड्यूल tab on this crop). None does: the orange "शेड्यूल नाही" with "निवडा" (the schedule library for this crop).
 */
const CropScheduleLine: React.FC<{ crop: CropProfile; following: number; language: 'mr' | 'en'; onSee: () => void; onChoose: () => void }> = ({ crop, following, language, onSee, onChoose }) => {
    const w = SCHEDULE_LINE_WORDS[language];
    if (following === 0) {
        return (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-orange-50 p-3 ring-1 ring-orange-300" data-testid={`schedule-missing-${crop.id}`}>
                <AlertTriangle size={18} className="shrink-0 text-orange-700" aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1 basis-[7rem] text-[15px] font-extrabold text-orange-900">{w.none}</p>
                <Tap onClick={onChoose} data-testid={`schedule-open-${crop.id}`} className="min-h-[44px] shrink-0 rounded-full bg-orange-700 px-4 text-[15px] font-extrabold text-white">{w.choose}</Tap>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50/70 p-3 ring-1 ring-emerald-200" data-testid={`schedule-${crop.id}`}>
            <p className="m-0 min-w-0 flex-1 basis-[10rem] text-[15px] font-extrabold leading-snug text-stone-900" data-testid={`schedule-line-${crop.id}`}>
                {scheduleLineText(crop.plots.length, following, language)}
            </p>
            <Tap onClick={onSee} data-testid={`schedule-see-${crop.id}`} className="min-h-[44px] shrink-0 rounded-full bg-white px-4 text-[15px] font-extrabold text-emerald-800 ring-1 ring-emerald-400">{w.see}</Tap>
        </div>
    );
};

const StructureSection: React.FC<StructureSectionProps> = ({
    crops, isAddingCrop, setIsAddingCrop, newCropData, setNewCropData, cropNameError, setCropNameError,
    normalizedNewCropName, isDuplicateCropName, handleAddCrop,
    setMappingPlotId, deletePlot, setWizardCropId, onOpenScheduleLibrary, onOpenSchedule, canAddPlot = true,
}) => {
    const [confirmPlot, setConfirmPlot] = useState<string | null>(null);
    // From 4 plots a crop's plots are the shared grid and ONE plot's card is open under it (by crop id); a crop with up to 3 plots shows every card.
    const [openPlotByCrop, setOpenPlotByCrop] = useState<Record<string, string | null>>({});
    // What each plot follows, live (the schedule tab reads the same); the schedule sentence is counted from it, never from the crop-level field.
    const scheduleChoices = usePlotScheduleChoices();
    const todayKey = getDateKey();

    const language = useOptionalLanguage()?.language ?? 'mr';
    const lineLanguage: 'mr' | 'en' = language === 'en' ? 'en' : 'mr';
    const words = language === 'en' ? FORM_WORDS.en : FORM_WORDS.mr;
    // The crops already on this farm, as crop master ids and as names: neither can be chosen again.
    const onFarm = useMemo(() => new Set(crops.map(c => cropMasterIdOf(c)).filter((id): id is string => !!id)), [crops]);
    const onFarmNames = useMemo(() => new Set(crops.map(c => normName(c.name))), [crops]);
    const picked = cropById(newCropData.masterId);

    const pick = (choice: PickedCrop) => {
        setCropNameError('');
        if (choice.kind === 'master') setNewCropData({ ...newCropData, name: choice.row.en || choice.row.mr, masterId: choice.row.id });
        else setNewCropData({ ...newCropData, name: choice.name, masterId: undefined });
    };
    const changePick = () => { setCropNameError(''); setNewCropData({ iconName: newCropData.iconName ?? 'Sprout' }); };

    const cancelAddCrop = () => { setIsAddingCrop(false); setCropNameError(''); setNewCropData({ iconName: 'Sprout' }); };
    const shownCropError = cropNameError
        ? (isDuplicateCropName ? (language === 'en' ? DUPLICATE_CROP_EN : DUPLICATE_CROP) : (language === 'en' ? CROP_NAME_NEEDED_EN : CROP_NAME_NEEDED))
        : undefined;
    const chosenName = picked ? cropLabel(picked, language) : (newCropData.name ?? '').trim();

    // Repair FIX-1 item 5 - the plots still missing a link (the hub's line counts the same list).
    const pending = useMemo(() => pendingPlots(crops, scheduleChoices, todayKey), [crops, scheduleChoices, todayKey]);
    const pendingById = useMemo(() => new Map(pending.map(x => [x.plotId, x.reasons])), [pending]);
    const pendingWords = PLOT_PENDING_WORDS[lineLanguage];
    const reasonsLine = (reasons: readonly PlotPendingReason[]) => reasons.map(r => pendingWords.reason[r]).join(' · ');
    /** A tap on a "बाकी" line opens that plot (its card, under the grid from 4 plots) and brings it into view. */
    const openPendingPlot = (cropId: string, plotId: string) => {
        setConfirmPlot(null);
        setOpenPlotByCrop(prev => ({ ...prev, [cropId]: plotId }));
        window.setTimeout(() => document.getElementById(`setup-plot-${plotId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
    };

    /** One plot's card, as it always was: area, irrigation, "mapped"; draw / redraw its boundary; remove it (asks first). */
    const renderPlotCard = (crop: CropProfile, p: Plot) => {
        const irrigation = p.infrastructure?.irrigationMethod ? IRRIGATION_LABEL[p.infrastructure.irrigationMethod] : null;
        const confirming = confirmPlot === p.id;
        return (
            <div key={p.id} id={`setup-plot-${p.id}`} className="relative space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`plot-${p.id}`}>
                {pendingById.has(p.id) && <PendingDot plotId={p.id} />}
                <div className="min-w-0">
                    <p className="m-0 text-[15.5px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{p.name}</p>
                    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-stone-600">
                        <span>{digitsFor(p.baseline.totalArea ?? '', language)} {LAND_UNIT_LABEL[p.baseline.unit] ?? p.baseline.unit}</span>
                        {irrigation && <span>· {irrigation}</span>}
                        {p.geoData && <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[12px] font-extrabold text-emerald-800"><MapPin size={12} aria-hidden="true" />नकाशावर आखलेला</span>}
                    </p>
                </div>
                {confirming ? (
                    <div className="rounded-xl bg-rose-50 p-2.5 ring-1 ring-rose-200" data-testid={`plot-remove-confirm-${p.id}`}>
                        <p className="m-0 text-[14px] font-extrabold text-rose-900">हा प्लॉट यादीतून काढायचा?</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <Tap onClick={() => setConfirmPlot(null)} className="min-h-[44px] rounded-full bg-white text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">नको</Tap>
                            <Tap onClick={() => { deletePlot(crop.id, p.id); setConfirmPlot(null); }} data-testid={`plot-remove-yes-${p.id}`}
                                className="min-h-[44px] rounded-full bg-rose-600 text-[14px] font-extrabold text-white">हो, काढा</Tap>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <Tap onClick={() => setMappingPlotId({ cropId: crop.id, plotId: p.id })} data-testid={`plot-map-${p.id}`}
                            className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-extrabold ${p.geoData ? 'bg-white text-emerald-800 ring-1 ring-emerald-300' : 'bg-emerald-700 text-white'}`}>
                            <MapPin size={16} aria-hidden="true" />{p.geoData ? 'हद्द पुन्हा आखा' : 'नकाशावर हद्द आखा'}
                        </Tap>
                        <Tap onClick={() => setConfirmPlot(p.id)} aria-label="प्लॉट काढा" data-testid={`plot-remove-${p.id}`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-rose-600 ring-1 ring-rose-200"><Trash2 size={18} aria-hidden="true" /></Tap>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-3" data-testid="hub-crops">
            {pending.length > 0 && (
                <GlassCard className="ring-1 ring-rose-200" testId="plots-pending">
                    <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-rose-800">
                        <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />{pendingWords.title}
                    </p>
                    <div className="mt-2 space-y-1.5">
                        {pending.map(x => {
                            const crop = crops.find(c => c.id === x.cropId);
                            return (
                                <Tap key={x.plotId} onClick={() => openPendingPlot(x.cropId, x.plotId)} data-testid={`plots-pending-row-${x.plotId}`}
                                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-stone-200">
                                    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-rose-600" />
                                    <span className="min-w-0 flex-1 text-[14.5px] font-bold leading-snug text-stone-800">
                                        <span className="font-extrabold text-stone-900">{crop ? `${cropNameIn(crop.name, lineLanguage, crop.masterId)} · ` : ''}{x.plotName}</span>
                                        {' — '}{reasonsLine(x.reasons)}
                                    </span>
                                </Tap>
                            );
                        })}
                    </div>
                </GlassCard>
            )}

            {isAddingCrop ? (
                <GlassCard className="ring-2 ring-emerald-300" testId="crop-form">
                    <div className="space-y-3">
                        {chosenName ? (
                            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200" data-testid="crop-chosen">
                                {picked && <CropPicture row={picked} size={960} className="h-[120px] w-full" />}
                                <div className="flex items-center gap-2 p-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="m-0 text-[19px] font-extrabold leading-tight text-stone-900" data-testid="crop-chosen-name">{chosenName}</p>
                                        {!picked && <p className="m-0 text-[13px] font-semibold text-stone-600">{words.typed}</p>}
                                    </div>
                                    <Tap onClick={changePick} data-testid="crop-change" className="min-h-[44px] shrink-0 rounded-full bg-white px-3.5 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">{words.change}</Tap>
                                </div>
                            </div>
                        ) : (
                            <CropMasterPicker language={language} onFarm={onFarm} onFarmNames={onFarmNames} onPick={pick} />
                        )}
                        {shownCropError && <p className="m-0 text-[13px] font-extrabold text-rose-700" data-testid="crop-name-error">{shownCropError}</p>}
                        <div className="grid grid-cols-2 gap-2">
                            <Tap onClick={cancelAddCrop} data-testid="crop-cancel" className="min-h-[50px] rounded-full bg-stone-100 text-[15px] font-extrabold text-stone-700">{words.cancel}</Tap>
                            <Tap onClick={handleAddCrop} data-testid="crop-save" disabled={normalizedNewCropName.length < 2 || isDuplicateCropName}
                                className="min-h-[50px] rounded-full bg-emerald-700 text-[15px] font-extrabold text-white disabled:opacity-40">{words.save}</Tap>
                        </div>
                    </div>
                </GlassCard>
            ) : canAddPlot && (
                // Repair FIX-1 round 1 (Bug 3): a crop is part of the farm's structure, like a plot — the same
                // "edit farm setup" rule draws both doors (a seat without it never sees a door the server would refuse).
                <BigButton onClick={() => setIsAddingCrop(true)} tone="white" testId="crop-add"><Plus size={20} aria-hidden="true" />नवीन पीक जोडा</BigButton>
            )}

            {crops.length === 0 && (
                <GlassCard testId="crops-empty">
                    <div className="flex items-center gap-3">
                        <IconDot tone="green"><Sprout size={22} aria-hidden="true" /></IconDot>
                        <p className="m-0 text-[15px] font-bold leading-snug text-stone-700">अजून पीक जोडलेलं नाही. पहिलं पीक जोडा, मग त्याचे प्लॉट.</p>
                    </div>
                </GlassCard>
            )}

            {crops.map(crop => {
                const following = plotsFollowingCount(crop, scheduleChoices, todayKey);
                const manyPlots = photoOnceFor(crop.plots.length);
                const openPlot = crop.plots.find(p => p.id === openPlotByCrop[crop.id]) ?? null;
                const tapPlot = (plotId: string) => {
                    setConfirmPlot(null);
                    setOpenPlotByCrop(prev => ({ ...prev, [crop.id]: prev[crop.id] === plotId ? null : plotId }));
                };
                return (
                    <GlassCard key={crop.id} testId={`crop-${crop.id}`}>
                        <PlotGroupHeader crop={crop} testId={`crop-header-${crop.id}`} nameTestId={`crop-name-${crop.id}`} language={lineLanguage}
                            sub={<span data-testid={`crop-count-${crop.id}`}><PlotCount total={crop.plots.length} language={lineLanguage} /></span>} />
                        <div className="mt-2.5 space-y-2">
                            <CropScheduleLine crop={crop} following={following} language={lineLanguage}
                                onSee={() => (onOpenSchedule ?? onOpenScheduleLibrary)?.(crop.id)}
                                onChoose={() => onOpenScheduleLibrary?.(crop.id)} />
                            {manyPlots ? (
                                <>
                                    <SinglePlotSection crop={crop} plotId={openPlot?.id ?? null} onPickPlot={tapPlot} language={lineLanguage}
                                        sectionTestId={`plots-${crop.id}`}
                                        testIds={{ plot: id => `plot-pick-${id}`, grid: `plot-grid-${crop.id}` }}
                                        mark={id => (pendingById.has(id) ? <PendingDot plotId={id} /> : null)} />
                                    {openPlot
                                        ? renderPlotCard(crop, openPlot)
                                        : <p className="m-0 text-[14px] font-bold text-stone-700" data-testid={`plot-hint-${crop.id}`}>{SCHEDULE_LINE_WORDS[lineLanguage].hint}</p>}
                                </>
                            ) : crop.plots.map(p => renderPlotCard(crop, p))}
                            {canAddPlot && (
                                <Tap onClick={() => setWizardCropId(crop.id)} data-testid={`plot-add-${crop.id}`}
                                    className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-emerald-400 text-[15px] font-extrabold text-emerald-800">
                                    <Plus size={18} aria-hidden="true" />या पिकात प्लॉट जोडा
                                </Tap>
                            )}
                        </div>
                    </GlassCard>
                );
            })}
        </div>
    );
};

export default StructureSection;
