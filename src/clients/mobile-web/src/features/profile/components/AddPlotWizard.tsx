/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted verbatim from `pages/ProfilePage.tsx`.
 * 3-step wizard for adding a plot to a crop. Used only by StructureSection.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    Plus, Trash2, X, Crosshair, ArrowRight, ArrowLeft, Save,
    CheckCircle2, Wrench, AlertTriangle, Tractor
} from 'lucide-react';
import {
    FarmerProfile, CropProfile, Plot, LandUnit,
    PlotInfrastructure, PlantingMaterial
} from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { createInitialScheduleInstance } from '../../scheduler/planning/ClientPlanEngine';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../../../infrastructure/reference/TemplateCatalog';
import { useLanguage } from '../../../i18n/LanguageContext';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';
import { VarietySelector } from '../../context/components/VarietySelector';

interface PlotWizardProps {
    crop: CropProfile;
    profile: FarmerProfile;
    onSave: (plot: Plot) => void;
    onCancel: () => void;
}

const AddPlotWizard: React.FC<PlotWizardProps> = ({ crop, profile, onSave, onCancel }) => {
    const { t } = useLanguage();
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
    const availableSchedules = useMemo(
        () => getSchedulesForCrop(crop.name).slice(0, 3),
        [crop.name]
    );
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(crop.activeScheduleId || null);

    // --- VALIDATION STATE ---
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    useEffect(() => {
        if (!selectedTemplateId && availableSchedules.length > 0) {
            setSelectedTemplateId(crop.activeScheduleId || availableSchedules[0].id);
        }
    }, [selectedTemplateId, availableSchedules, crop.activeScheduleId]);

    // --- VALIDATION FUNCTIONS ---
    const validateStep1 = (): boolean => {
        const newErrors: { [key: string]: string } = {};
        if (!plotName.trim()) {
            newErrors.plotName = 'Plot name is required';
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
        if (!selectedTemplateId) {
            setErrors(prev => ({ ...prev, schedule: 'Select one schedule from library options' }));
            return;
        }

        const selectedTemplate = getScheduleById(selectedTemplateId);

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

        const plotId = `p_${idGenerator.generate()}`;
        const startDate = systemClock.nowISO();

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
            schedule: (() => {
                const instance = createInitialScheduleInstance(plotId, crop.name, getDateKey());
                if (selectedTemplate) {
                    instance.templateId = selectedTemplate.id;
                    instance.referenceType = selectedTemplate.referenceType;
                }
                return instance;
            })()
        };

        onSave(newPlot);
    };

    const nextStep = () => {
        // Validate current step before proceeding
        if (step === 1 && !validateStep1()) return;
        if (step === 2 && !validateStep2()) return;
        setStep(step + 1);
    };
    const prevStep = () => setStep(step - 1);

    const progress = (step / 4) * 100;

    const irrMethodLabels: Record<string, string> = {
        'Drip': t('profile.drip'),
        'Flood': t('profile.flood'),
        'Sprinkler': t('profile.sprinkler'),
        'None': t('profile.none'),
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-slate-50 p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onCancel} className="p-2 hover:bg-slate-200 rounded-full"><X size={20} className="text-slate-500" /></button>
                        <div>
                            <h3 className="font-bold text-slate-800">{t('profile.addPlotTo')} {crop.name}</h3>
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
                                        className="w-full p-3 border border-slate-200 rounded-xl font-bold outline-none focus:border-emerald-500"
                                        placeholder="0"
                                        value={area}
                                        onChange={e => setArea(parseFloat(e.target.value))}
                                    />
                                </div>
                                <div className="w-1/3">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{t('profile.unit')}</label>
                                    <select
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold outline-none"
                                        value={areaUnit}
                                        onChange={e => setAreaUnit(e.target.value as any)}
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
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Choose Schedule (3 options)</p>
                                        <p className="text-xs text-emerald-700/80 mt-1">This schedule becomes baseline for compare and timeline.</p>
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-wide bg-white border border-emerald-200 px-2 py-1 rounded-full text-emerald-700">
                                        Required
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    {availableSchedules.map(template => {
                                        const isSelected = selectedTemplateId === template.id;
                                        return (
                                            <button
                                                type="button"
                                                key={template.id}
                                                onClick={() => {
                                                    setSelectedTemplateId(template.id);
                                                    if (errors.schedule) setErrors({ ...errors, schedule: '' });
                                                }}
                                                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${isSelected ? 'bg-emerald-50 border-emerald-500 shadow-sm ring-1 ring-emerald-500' : 'bg-white/70 border-slate-200 hover:bg-white border-dashed'}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-slate-800 truncate">{template.name}</p>
                                                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">Created by: {template.createdBy}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xs font-black text-emerald-700">{template.adoptionScore || 0}/100</p>
                                                        <p className="text-[10px] text-slate-500">Adoption</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                                    <span>{template.totalDurationDays || '-'} days</span>
                                                    <span>{template.followersCount || 0} followers</span>
                                                    {isSelected && <span className="text-emerald-700 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-emerald-200"><CheckCircle2 size={12}/> Selected</span>}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {errors.schedule && (
                                    <p className="text-red-500 text-xs mt-2 flex items-center gap-1">
                                        <AlertTriangle size={12} /> {errors.schedule}
                                    </p>
                                )}
                            </div>

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
                    {step < 4 ? (
                        <Button onClick={nextStep} className="flex-1 py-3 text-sm" disabled={!plotName}>
                            {t('profile.nextStep')} <ArrowRight size={16} className="ml-2" />
                        </Button>
                    ) : (
                        <Button onClick={handleSave} className="flex-1 py-3 text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg">
                            <Save size={16} className="mr-2" /> {t('profile.finishSetup')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddPlotWizard;
