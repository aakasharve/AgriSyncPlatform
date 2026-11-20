/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted verbatim from `pages/ProfilePage.tsx`.
 * 3-step wizard for adding a plot to a crop. Used only by StructureSection.
 */

import React, { useState } from 'react';
import {
    X, ArrowRight, Save,
    CheckCircle2, Wrench, AlertTriangle, Tractor
} from 'lucide-react';
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
import PlotStartQuestion, { type PlotStartMode } from '../plotStart/PlotStartQuestion';
import {
    checkedScheduleForCrop, dayCountOn, earliestPlantingDate, plantingDateProblem, plantingWordKey,
    type NewPlotStart,
} from '../plotStart/plotStartChoice';

interface PlotWizardProps {
    crop: CropProfile;
    profile: FarmerProfile;
    /** The new plot, and (spec: plr-d10 lane WIZARD-F2) the day it counts from and the checked schedule that follows by itself. */
    onSave: (plot: Plot, start: NewPlotStart) => void;
    onCancel: () => void;
}

const AddPlotWizard: React.FC<PlotWizardProps> = ({ crop, profile, onSave, onCancel }) => {
    const { t, language } = useLanguage();
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



    const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);

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

    // --- VALIDATION STATE ---
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    // --- VALIDATION FUNCTIONS ---
    const validateStep1 = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        if (!plotName.trim()) {
            newErrors.plotName = 'Plot name is required';
        }
        // spec: plr-d10-redesign-real-integration-2026-10-25 (I9). The server refuses a plot
        // with no area, and an area is never guessed for him — so it is asked for here.
        if (!(Number(area) > 0)) {
            newErrors.area = 'क्षेत्र लिहा · Enter the area';
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
            newErrors.variety = 'Enter Variety name or Seed/Nursery name (at least one required)';
        }

        // Seed/seedlings quantity required
        if (materialType === 'Seed' && (!seedQty || seedQty <= 0)) {
            newErrors.seedQty = 'Seed quantity is required';
        }
        if (materialType === 'Nursery' && (!plantAge || plantAge <= 0)) {
            newErrors.plantAge = 'Plant age is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = () => {
        if (!plotName.trim()) {
            setErrors({ plotName: 'Plot name is required' });
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

        const infrastructure: PlotInfrastructure = {
            irrigationMethod: 'None',
            linkedMachineryIds: selectedMachineIds
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
            infrastructure,
            schedule: instance
        };

        onSave(newPlot, { scheduleTemplateId: checkedSchedule?.templateId ?? null, referenceDate: chosenKey });
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
                    <span className="text-xs font-bold text-slate-400 uppercase">{t('profile.step')} {step}/3</span>
                </div>

                <div className="p-6 overflow-y-auto flex-1">

                    {/* STEP 1: IDENTITY */}
                    {step === 1 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.plotName')} *</label>
                                <input
                                    autoFocus
                                    className={`w-full p-3 border rounded-xl font-bold text-lg outline-none focus:border-emerald-500 ${errors.plotName ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                    placeholder="e.g. Riverside Plot"
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
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.area')}</label>
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
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.unit')}</label>
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
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.variety')}</label>
                                <VarietySelector
                                    cropName={crop.name}
                                    value={variety}
                                    onChange={(v) => {
                                        setVariety(v);
                                        if (errors.variety) setErrors({ ...errors, variety: '' });
                                    }}
                                    error={errors.variety}
                                />
                                <p className="text-slate-400 text-xs mt-1">Or provide seed/nursery name in next step</p>
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
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{t('profile.whatDidYouPlant')} *</label>
                                <div className="flex bg-slate-100 p-1 rounded-xl">
                                    <button
                                        onClick={() => setMaterialType('Seed')}
                                        className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${materialType === 'Seed' ? 'bg-white shadow text-emerald-800' : 'text-slate-500'}`}
                                    >
                                        {t('profile.seeds')} (बियाणं)
                                    </button>
                                    <button
                                        onClick={() => setMaterialType('Nursery')}
                                        className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${materialType === 'Nursery' ? 'bg-white shadow text-emerald-800' : 'text-slate-500'}`}
                                    >
                                        {t('profile.saplings')} (रोप)
                                    </button>
                                </div>
                            </div>

                            {materialType === 'Seed' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.companyName')} {!variety.trim() && '*'}</label>
                                        <input
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.variety && !variety.trim() ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                                            placeholder="e.g. Mahabeej"
                                            value={seedCompany}
                                            onChange={e => {
                                                setSeedCompany(e.target.value);
                                                if (errors.variety) setErrors({ ...errors, variety: '' });
                                            }}
                                        />
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.quantityPerAcre')} *</label>
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
                                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.unit')}</label>
                                            <select
                                                className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none"
                                                value={seedUnit}
                                                onChange={e => setSeedUnit(e.target.value)}
                                            >
                                                <option value="kg">kg</option>
                                                <option value="gm">gm</option>
                                                <option value="Packets">Pkt</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.nurseryName')} {!variety.trim() && '*'}</label>
                                        <input
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.variety && !variety.trim() ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                                            placeholder="e.g. Nashik Grapes"
                                            value={nurseryName}
                                            onChange={e => {
                                                setNurseryName(e.target.value);
                                                if (errors.variety) setErrors({ ...errors, variety: '' });
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.plantAgeDays')} *</label>
                                        <input
                                            type="number"
                                            className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 ${errors.plantAge ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                            placeholder="Days old when planted"
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

                    {/* STEP 3: SCHEDULE & MACHINERY */}
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

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{t('profile.selectTools')}</label>
                                <div className="space-y-2">
                                    {(profile.machineries || []).map(m => {
                                        const isSelected = selectedMachineIds.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                onClick={() => {
                                                    if (isSelected) setSelectedMachineIds(selectedMachineIds.filter(id => id !== m.id));
                                                    else setSelectedMachineIds([...selectedMachineIds, m.id]);
                                                }}
                                                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${isSelected ? 'bg-emerald-50 border-emerald-200 shadow-sm' : 'bg-white border-slate-100'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-white text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                                        {m.type === 'Tractor' ? <Tractor size={18} /> : <Wrench size={18} />}
                                                    </div>
                                                    <div className="text-left">
                                                        <p className={`text-sm font-bold ${isSelected ? 'text-emerald-900' : 'text-slate-700'}`}>{m.name}</p>
                                                        <p className="text-xs text-slate-400">{m.type} • {m.capacity ? `${m.capacity}L` : m.ownership}</p>
                                                    </div>
                                                </div>
                                                {isSelected && <CheckCircle2 size={20} className="text-emerald-500" />}
                                            </button>
                                        )
                                    })}
                                    {(!profile.machineries || profile.machineries.length === 0) && (
                                        <div className="p-4 text-center border-2 border-dashed border-slate-100 rounded-xl">
                                            <p className="text-slate-400 text-sm">{t('profile.noMachinery')}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
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
