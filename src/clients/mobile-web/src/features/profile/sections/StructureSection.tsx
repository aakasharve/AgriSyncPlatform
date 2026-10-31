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
 *   - per crop: the active schedule (or "not chosen") → the schedule library;
 *   - per plot: area + unit, irrigation, "mapped"; draw / redraw its boundary; remove it — the redraw
 *     and remove buttons used to appear only on mouse hover, so a phone could not see them; they are
 *     now always shown, and removing asks first;
 *   - add a plot → the 3-step AddPlotWizard (rendered by ProfilePage, unchanged).
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, MapPin, Plus, Sprout, Trash2 } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { cropById, cropLabel, normName } from '../../../domain/crops/cropMaster';
import { cropNameIn } from '../../../shared/names/namesIn';
import { cropMasterIdOf, useCropPicture } from '../../context/components/cropImage';
import CropMasterPicker, { CropPicture, type PickedCrop } from '../components/CropMasterPicker';
import type { CropProfile } from '../../../domain/types/farm.types';
import { CropSymbol } from '../../context/components/CropSelector';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../../../infrastructure/reference/TemplateCatalog';
import { BigButton, GlassCard, IconDot, Tap } from '../../../shared/components/ui/placeUi';
import { IRRIGATION_LABEL, LAND_UNIT_LABEL } from '../components/setupLabels';

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
    onOpenScheduleLibrary?: (cropId?: string) => void;
}

/** The hook's error strings are English; the farmer reads one of these two instead. */
const DUPLICATE_CROP = 'हे पीक आधीच जोडलेलं आहे — एक पीक एकदाच जोडता येतं.';
const CROP_NAME_NEEDED = 'पिकाचं नाव लिहा (किमान 2 अक्षरं).';
// PROPOSED (English) — the same two reasons in English mode (spec I18: English mode shows English only).
const DUPLICATE_CROP_EN = 'This crop is already added — a crop can be added only once.';
const CROP_NAME_NEEDED_EN = 'Write the crop name (at least 2 letters).';
// PROPOSED (Marathi) / PROPOSED (English) — the add-crop form's own words, per language.
const FORM_WORDS = {
    mr: { change: 'बदला', save: 'पीक जतन करा', cancel: 'रद्द', typed: 'तुम्ही लिहिलेलं नाव' },
    en: { change: 'Change', save: 'Save crop', cancel: 'Cancel', typed: 'The name you typed' },
} as const;

/** The farm crop's own picture (spec I18: by the crop master), else its old symbol on the crop's colour. */
const FarmCropMark: React.FC<{ crop: CropProfile }> = ({ crop }) => {
    const { src, onError } = useCropPicture({ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }, 480);
    return src
        ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} className="h-12 w-12 shrink-0 select-none rounded-xl object-cover shadow-sm" />
        : <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-sm ${crop.color}`}><CropSymbol name={crop.iconName} size="md" /></span>;
};

const ScheduleBox: React.FC<{ crop: CropProfile; onOpen: () => void }> = ({ crop, onOpen }) => {
    const activeSchedule = crop.activeScheduleId ? getScheduleById(crop.activeScheduleId) : null;
    const altCount = Math.max(0, getSchedulesForCrop(crop.name).length - 1);
    if (!activeSchedule) {
        return (
            <div className="flex items-center gap-2 rounded-2xl bg-orange-50 p-3 ring-1 ring-orange-200" data-testid={`schedule-missing-${crop.id}`}>
                <AlertTriangle size={18} className="shrink-0 text-orange-600" aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1 text-[14px] font-extrabold text-orange-800">अजून वेळापत्रक निवडलेलं नाही</p>
                <Tap onClick={onOpen} data-testid={`schedule-open-${crop.id}`} className="min-h-[44px] shrink-0 rounded-full bg-orange-600 px-3.5 text-[14px] font-extrabold text-white">आता निवडा</Tap>
            </div>
        );
    }
    return (
        <div className="rounded-2xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100" data-testid={`schedule-${crop.id}`}>
            <p className="m-0 text-[12.5px] font-extrabold text-emerald-800">पिकाचं वेळापत्रक</p>
            <div className="mt-1 flex items-center gap-2.5">
                <CalendarDays size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-[15px] font-extrabold leading-tight text-stone-900">{activeSchedule.name}</p>
                    <p className="m-0 text-[13px] font-semibold text-stone-600">
                        {activeSchedule.totalDurationDays ? `${activeSchedule.totalDurationDays} दिवस` : '—'}{altCount > 0 ? ` · आणखी ${altCount} पर्याय` : ''}
                    </p>
                </div>
                <Tap onClick={onOpen} data-testid={`schedule-open-${crop.id}`} className="min-h-[44px] shrink-0 rounded-full bg-white px-3.5 text-[14px] font-extrabold text-emerald-800 ring-1 ring-emerald-300">बदला</Tap>
            </div>
        </div>
    );
};

const StructureSection: React.FC<StructureSectionProps> = ({
    crops, isAddingCrop, setIsAddingCrop, newCropData, setNewCropData, cropNameError, setCropNameError,
    normalizedNewCropName, isDuplicateCropName, handleAddCrop,
    setMappingPlotId, deletePlot, setWizardCropId, onOpenScheduleLibrary,
}) => {
    const [confirmPlot, setConfirmPlot] = useState<string | null>(null);

    const language = useOptionalLanguage()?.language ?? 'mr';
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

    return (
        <div className="space-y-3" data-testid="hub-crops">
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
            ) : (
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

            {crops.map(crop => (
                <GlassCard key={crop.id} testId={`crop-${crop.id}`}>
                    <div className="flex items-center gap-3">
                        <FarmCropMark crop={crop} />
                        <div className="min-w-0 flex-1">
                            <p className="m-0 text-[18px] font-extrabold text-stone-900" data-testid={`crop-name-${crop.id}`}>{cropNameIn(crop.name, language, crop.masterId)}</p>
                            <p className="m-0 text-[13.5px] font-semibold text-stone-600">{crop.plots.length} प्लॉट</p>
                        </div>
                    </div>
                    <div className="mt-2.5 space-y-2">
                        <ScheduleBox crop={crop} onOpen={() => onOpenScheduleLibrary?.(crop.id)} />
                        {crop.plots.map(p => {
                            const irrigation = p.infrastructure?.irrigationMethod ? IRRIGATION_LABEL[p.infrastructure.irrigationMethod] : null;
                            const confirming = confirmPlot === p.id;
                            return (
                                <div key={p.id} className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`plot-${p.id}`}>
                                    <div className="min-w-0">
                                        <p className="m-0 text-[15.5px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{p.name}</p>
                                        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-stone-600">
                                            <span>{p.baseline.totalArea} {LAND_UNIT_LABEL[p.baseline.unit] ?? p.baseline.unit}</span>
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
                        })}
                        <Tap onClick={() => setWizardCropId(crop.id)} data-testid={`plot-add-${crop.id}`}
                            className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-emerald-400 text-[15px] font-extrabold text-emerald-800">
                            <Plus size={18} aria-hidden="true" />या पिकात प्लॉट जोडा
                        </Tap>
                    </div>
                </GlassCard>
            ))}
        </div>
    );
};

export default StructureSection;
