/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted verbatim from `pages/ProfilePage.tsx`.
 * 3-step wizard for adding a plot to a crop. Used only by StructureSection.
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, P7; R2-A item 14) - with the open farm's set (`farmSetup`, once the server sent it), step 3
 * also asks "या प्लॉटला पाण्याची सोय कशी केली आहे?" from the farm's own sources and motors (`PlotWaterQuestion`). The answer goes to `onSave` beside the
 * plot (absent when he said nothing: the plot is saved and shows बाकी); the caller queues it AFTER the plot. The old `irrigationMethod: 'None'` default
 * (never his answer) is not written then. Without the farm's set the plot is saved exactly as before.
 */

import React, { useState } from 'react';
import { X, ArrowRight, Save, AlertTriangle } from 'lucide-react';
import {
    FarmerProfile, CropProfile, Plot, LandUnit,
    PlotInfrastructure, PlantingMaterial
} from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { createInitialScheduleInstance } from '../../scheduler/planning/ClientPlanEngine';
import { useLanguage } from '../../../i18n/LanguageContext';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';
import { VarietySelector } from '../../context/components/VarietySelector';
import { cropNameIn } from '../../../shared/names/namesIn';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import PlotStartQuestion, { type PlotStartMode } from '../plotStart/PlotStartQuestion';
import { nextPlotName, plotWizardWords } from './addPlotWords';
import {
    checkedScheduleForCrop, dayCountOn, earliestPlantingDate, plantingDateProblem, plantingWordKey,
    type NewPlotStart,
} from '../plotStart/plotStartChoice';
import type { LocalFarmSetup } from '../farmSetup/farmSetupLocal';
import type { PlotWaterInput } from '../farmSetup/farmSetupCommands';
import { PlotWaterQuestion, type PlotWaterAnswer } from '../farmSetup/PlotWaterQuestion';

interface PlotWizardProps {
    crop: CropProfile;
    /** The farm setup on this phone. Not read since the machines question left (FIX-1 item 4); the plot's water question will read it (D-9). */
    profile: FarmerProfile;
    /**
     * The new plot, and (spec: plr-d10 lane WIZARD-F2) the day it counts from and the checked schedule that follows by itself; and (repair D-9) its
     * water answer, only when he gave one.
     */
    onSave: (plot: Plot, start: NewPlotStart, water?: Omit<PlotWaterInput, 'plotId'>) => void;
    onCancel: () => void;
    /** repair D-9 - the open farm's set, once the server sent it (absent / not received: no water question, the plot as before). */
    farmSetup?: LocalFarmSetup | null;
    /** repair D-9 - "आधी पाण्याचा स्रोत जोडा": the door to पाणी आणि वीज. The plot is SAVED first (its water बाकी), then the page opens. */
    onOpenWaterPage?: () => void;
}

/**
 * UI-9a (redesign item 10): the labels of steps 1 and 2 are 16 px in #44403c (stone-700) - they were 12 px light grey (#94a3b8), too small and too
 * pale to read in the sun. Step 3 (the date question and its tools list) keeps its own look.
 */
const LABEL = 'block text-[16px] font-bold text-stone-700 mb-1';

const AddPlotWizard: React.FC<PlotWizardProps> = ({ crop, onSave, onCancel, farmSetup, onOpenWaterPage }) => {
    const { t, language } = useLanguage();
    // The words of steps 1 and 2 that were English on a Marathi screen (placeholders, errors, hint, units); English mode keeps its English.
    const w = plotWizardWords(language);
    // The name placeholder shows the next name in HIS pattern ("G16" after G15) when his plot names end in a number; never a value, never a guess.
    const nextName = nextPlotName(crop.plots.map(p => p.name));
    const [step, setStep] = useState(1);

    // --- FORM STATE ---
    const [plotName, setPlotName] = useState('');
    const [area, setArea] = useState<number | ''>('');
    const [areaUnit, setAreaUnit] = useState<LandUnit>('Acre');
    const [variety, setVariety] = useState('');

    const [materialType, setMaterialType] = useState<'Seed' | 'Nursery'>('Seed');
    const [seedCompany, setSeedCompany] = useState('');
    const [seedQty, setSeedQty] = useState<number | ''>('');
    const [seedUnit, setSeedUnit] = useState('kg');
    const [nurseryName, setNurseryName] = useState('');
    const [plantAge, setPlantAge] = useState<number | ''>('');

    // spec: plr-d10 lane WIZARD-F2 (founder pick F2, 2026-11-19) - step 3 asks ONE required question, when the crop was planted / pruned /
    // sown. NOTHING is pre-selected (a date is never guessed for him); the finish button stays off until one of the two choices is made.
    // The schedule is not chosen here: the crop's ShramSafal-checked one follows by itself, or none when the crop has none.
    const [startMode, setStartMode] = useState<PlotStartMode>(null);
    const [earlierKey, setEarlierKey] = useState('');
    const todayKey = getDateKey();
    const checkedSchedule = checkedScheduleForCrop(crop.name);
    const earlierProblem = startMode === 'earlier' && earlierKey !== '' ? plantingDateProblem(earlierKey, todayKey) : null;
    /** The day he named (YYYY-MM-DD), or null while nothing usable is chosen. */
    const chosenKey: string | null = startMode === 'today'
        ? todayKey
        : startMode === 'earlier' && earlierKey !== '' && earlierProblem === null ? earlierKey : null;

    // repair D-9 - the plot's water, asked only when the server has sent the farm's set.
    const server = farmSetup?.received ? farmSetup : null;
    const [water, setWater] = useState<PlotWaterAnswer>({ method: null, links: [] });

    // --- VALIDATION STATE ---
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    // --- VALIDATION FUNCTIONS ---
    const validateStep1 = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        if (!plotName.trim()) {
            newErrors.plotName = w.plotNameNeeded;
        }
        // spec: plr-d10-redesign-real-integration-2026-10-25 (I9). The server refuses a plot
        // with no area, and an area is never guessed for him — so it is asked for here.
        if (!(Number(area) > 0)) {
            newErrors.area = w.areaNeeded;
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const validateStep2 = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        // At least one: variety OR seed company/nursery name
        const hasVariety = variety.trim().length > 0;
        const hasSeedInfo = materialType === 'Seed' ? seedCompany.trim().length > 0 : nurseryName.trim().length > 0;

        if (!hasVariety && !hasSeedInfo) {
            newErrors.variety = w.varietyNeeded;
        }

        // Seed/seedlings quantity required
        if (materialType === 'Seed' && (!seedQty || seedQty <= 0)) {
            newErrors.seedQty = w.seedQtyNeeded;
        }
        if (materialType === 'Nursery' && (!plantAge || plantAge <= 0)) {
            newErrors.plantAge = w.plantAgeNeeded;
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = () => {
        if (!plotName.trim()) {
            setErrors({ plotName: w.plotNameNeeded });
            return;
        }
        // The finish button is off until the date question is answered; this keeps a stray call from making a plot with a guessed day.
        if (!chosenKey) return;

        const plantingMaterial: PlantingMaterial = materialType === 'Seed' ? {
            type: 'Seed',
            seedCompany,
            seedQuantity: Number(seedQty),
            seedUnit
        } : {
            type: 'Nursery',
            nurseryName,
            plantAgeDays: Number(plantAge)
        };

        // Saved exactly as before (no machine was ever required): machines are the farm's, not the plot's (FIX-1 item 4). Repair D-9: with the farm's
        // set the plot's water lives on the server, and the old 'None' default (never his answer) is not written.
        const infrastructure: PlotInfrastructure | undefined = server ? undefined : {
            irrigationMethod: 'None',
            linkedMachineryIds: []
        };

        // spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3). A bare GUID, the id the
        // server will keep: a `p_` prefix failed the sync contract's GUID check, so the plot
        // and every log on it never left the phone.
        const plotId = idGenerator.generate();

        // spec: plr-d10 lane WIZARD-F2 - the plot's start date (and so its crop cycle's), the schedule's day 0 and the choice sent with the
        // plot are ONE day: the one he named. A plain YYYY-MM-DD, the app's own day, never a timestamp ("now" was the old, silent answer).
        const startDate = chosenKey;
        const instance = createInitialScheduleInstance(plotId, crop.name, chosenKey);
        if (checkedSchedule) {
            instance.templateId = checkedSchedule.templateId;
            instance.referenceType = checkedSchedule.referenceType;
        } else {
            // A crop with no checked schedule makes a plot with none: no template named, so neither the app's stand-in nor an unchecked
            // sample is ever stored as its schedule (and none is adopted, `onSave` below says so).
            instance.templateId = '';
            instance.referenceType = 'PLANTING';
        }

        const newPlot: Plot = {
            id: plotId,
            name: plotName,
            variety,
            startDate,
            createdAt: systemClock.nowISO(),
            baseline: {
                totalArea: Number(area),
                unit: areaUnit
            },
            plantingMaterial,
            ...(infrastructure ? { infrastructure } : {}),
            schedule: instance
        };

        const waterAnswer = server && water.method ? { farmId: server.farmId, method: water.method, links: water.method === 'none' ? [] : water.links } : undefined;
        onSave(newPlot, { scheduleTemplateId: checkedSchedule?.templateId ?? null, referenceDate: chosenKey }, waterAnswer);
    };

    const nextStep = () => {
        // Validate current step before proceeding
        if (step === 1 && !validateStep1()) return;
        if (step === 2 && !validateStep2()) return;
        setStep(step + 1);
    };
    const prevStep = () => setStep(step - 1);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-slate-50 p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onCancel} className="p-2 hover:bg-slate-200 rounded-full"><X size={20} className="text-slate-500" /></button>
                        <div>
                            <h3 className="font-bold text-slate-800">{t('profile.addPlotTo')} {cropNameIn(crop.name, language, crop.masterId)}</h3>
                            <div className="flex gap-1 mt-1">
                                {[1, 2, 3].map(s => (
                                    <div key={s} className={`h-1.5 w-8 rounded-full ${s <= step ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                                ))}
                            </div>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase">{t('profile.step')} {digitsFor(step, language)}/{digitsFor(3, language)}</span>
                </div>

                <div className="p-6 overflow-y-auto flex-1">

                    {/* STEP 1: IDENTITY */}
                    {step === 1 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4">
                            <div>
                                <label className={LABEL}>{t('profile.plotName')} *</label>
                                <input
                                    autoFocus
                                    className={`w-full p-3 border rounded-xl font-bold text-lg outline-none focus:border-emerald-500 ${errors.plotName ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                    placeholder={w.plotNameExample(nextName)}
                                    value={plotName}
                                    onChange={e => {
                                        setPlotName(e.target.value);
                                        if (errors.plotName) setErrors({ ...errors, plotName: '' });
                                    }}
                                />
                                {errors.plotName && (
                                    <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                                        <AlertTriangle size={12} /> {errors.plotName}
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className={LABEL}>{t('profile.area')}</label>
                                    <input
                                        type="number"
                                        data-testid="plot-area"
                                        className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.area ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                        placeholder="0"
                                        value={area}
                                        onChange={e => {
                                            setArea(parseFloat(e.target.value));
                                            if (errors.area) setErrors({ ...errors, area: '' });
                                        }}
                                    />
                                    {errors.area && (
                                        <p data-testid="plot-area-error" className="mt-1 flex items-center gap-1 text-xs font-bold text-red-600">
                                            <AlertTriangle size={12} /> {errors.area}
                                        </p>
                                    )}
                                </div>
                                <div className="w-1/3">
                                    <label className={LABEL}>{t('profile.unit')}</label>
                                    <select
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold outline-none"
                                        value={areaUnit}
                                        onChange={e => setAreaUnit(e.target.value as LandUnit)}
                                    >
                                        <option value="Acre">{t('profile.acre')}</option>
                                        <option value="Guntha">{t('profile.guntha')}</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className={LABEL}>{t('profile.variety')}</label>
                                <VarietySelector
                                    cropName={crop.name}
                                    value={variety}
                                    onChange={(v) => {
                                        setVariety(v);
                                        if (errors.variety) setErrors({ ...errors, variety: '' });
                                    }}
                                    error={errors.variety}
                                    language={language}
                                />
                                <p className="text-slate-400 text-xs mt-1">{w.varietyOrNext}</p>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: MATERIAL */}
                    {step === 2 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4">
                            {/* Show variety error from step 1 if not provided */}
                            {errors.variety && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-red-700 text-sm">
                                    <AlertTriangle size={16} />
                                    {errors.variety}
                                </div>
                            )}

                            <div>
                                <label className="block text-[16px] font-bold text-stone-700 mb-2">{t('profile.whatDidYouPlant')} *</label>
                                <div className="flex bg-slate-100 p-1 rounded-xl">
                                    <button
                                        onClick={() => setMaterialType('Seed')}
                                        className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${materialType === 'Seed' ? 'bg-white shadow text-emerald-800' : 'text-slate-500'}`}
                                    >
                                        {t('profile.seeds')}
                                    </button>
                                    <button
                                        onClick={() => setMaterialType('Nursery')}
                                        className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${materialType === 'Nursery' ? 'bg-white shadow text-emerald-800' : 'text-slate-500'}`}
                                    >
                                        {t('profile.saplings')}
                                    </button>
                                </div>
                            </div>

                            {materialType === 'Seed' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className={LABEL}>{t('profile.companyName')} {!variety.trim() && '*'}</label>
                                        <input
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.variety && !variety.trim() ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                                            placeholder={w.seedCompanyExample}
                                            value={seedCompany}
                                            onChange={e => {
                                                setSeedCompany(e.target.value);
                                                if (errors.variety) setErrors({ ...errors, variety: '' });
                                            }}
                                        />
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-1">
                                            <label className={LABEL}>{t('profile.quantityPerAcre')} *</label>
                                            <input
                                                type="number"
                                                className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.seedQty ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                                placeholder="0"
                                                value={seedQty}
                                                onChange={e => {
                                                    setSeedQty(parseFloat(e.target.value));
                                                    if (errors.seedQty) setErrors({ ...errors, seedQty: '' });
                                                }}
                                            />
                                            {errors.seedQty && (
                                                <p className="text-red-500 text-xs mt-1">{errors.seedQty}</p>
                                            )}
                                        </div>
                                        <div className="w-1/3">
                                            <label className={LABEL}>{t('profile.unit')}</label>
                                            <select
                                                className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none"
                                                value={seedUnit}
                                                onChange={e => setSeedUnit(e.target.value)}
                                            >
                                                <option value="kg">{w.units.kg}</option>
                                                <option value="gm">{w.units.gm}</option>
                                                <option value="Packets">{w.units.Packets}</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className={LABEL}>{t('profile.nurseryName')} {!variety.trim() && '*'}</label>
                                        <input
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.variety && !variety.trim() ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                                            placeholder={w.nurseryExample}
                                            value={nurseryName}
                                            onChange={e => {
                                                setNurseryName(e.target.value);
                                                if (errors.variety) setErrors({ ...errors, variety: '' });
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL}>{t('profile.plantAgeDays')} *</label>
                                        <input
                                            type="number"
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.plantAge ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                            placeholder={w.plantAgeExample}
                                            value={plantAge}
                                            onChange={e => {
                                                setPlantAge(parseFloat(e.target.value));
                                                if (errors.plantAge) setErrors({ ...errors, plantAge: '' });
                                            }}
                                        />
                                        {errors.plantAge && (
                                            <p className="text-red-500 text-xs mt-1">{errors.plantAge}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 3: THE START DATE */}
                    {step === 3 && (
                        <div className="space-y-4 animate-in slide-in-from-right-4">
                            {/* spec: plr-d10 lane WIZARD-F2 (founder pick F2) - ONE required question replaces the schedule list. */}
                            <PlotStartQuestion
                                language={language}
                                wordKey={plantingWordKey(checkedSchedule?.referenceType)}
                                mode={startMode}
                                onMode={setStartMode}
                                earlierKey={earlierKey}
                                onEarlierKey={setEarlierKey}
                                minKey={earliestPlantingDate(todayKey)}
                                maxKey={todayKey}
                                problem={earlierProblem}
                                dayCount={chosenKey ? dayCountOn(chosenKey, todayKey) : null}
                                checked={checkedSchedule}
                            />
                            {/* Repair FIX-1 item 4 (R2-A 14): no machines question here. Machines belong to the whole farm,
                                not to one plot. Repair D-9: the plot's water question, from the farm's own sources and motors. */}
                            {server && (
                                <PlotWaterQuestion sources={server.waterSources.map(s => s.item)} value={water} onChange={setWater} language={language}
                                    onOpenWaterPage={onOpenWaterPage && chosenKey ? () => { handleSave(); onOpenWaterPage(); } : undefined} />
                            )}
                        </div>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-slate-100 flex gap-3">
                    {step > 1 && (
                        <button
                            onClick={prevStep}
                            className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                        >
                            {t('profile.back')}
                        </button>
                    )}
                    {/* The wizard has THREE steps (the header says N/3). The test was `step < 4`, so step 3 offered "next" and led to a blank step 4
                        before "finish" (found 2026-11-19 reading how a schedule is chosen). Step 3 now ends with the finish button. */}
                    {step < 3 ? (
                        <Button onClick={nextStep} className="flex-1 py-3 text-sm" disabled={!plotName}>
                            {t('profile.nextStep')} <ArrowRight size={16} className="ml-2" />
                        </Button>
                    ) : (
                        <Button onClick={handleSave} disabled={!chosenKey} className="flex-1 py-3 text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg">
                            <Save size={16} className="mr-2" /> {t('profile.finishSetup')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddPlotWizard;
