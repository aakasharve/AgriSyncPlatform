/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useMemo, useState } from 'react';
import { 
    FlaskConical,

    User, Zap, MapPin, Plus, Trash2, X, Sprout, Crosshair, Clock,
    Settings2, ArrowRight, Droplets, Tractor, BarChart3, CalendarDays,
    ChevronRight, CheckCircle2, Wrench, Cylinder, ArrowLeft, Save, BrainCircuit,
    Medal, ShieldCheck, Check, Users, Settings, Phone, AlertTriangle, FileText, Upload, Eye, LogOut,
    PanelLeftClose, PanelLeftOpen, Cloud
} from 'lucide-react';
import {
    FarmerProfile, WaterResource, FarmMotor,
    CropProfile, Plot, IrrigationPlan, LandUnit, FarmMachinery,
    IrrigationFrequency, IrrigationTimeWindow, PlotInfrastructure, PlantingMaterial,
    OperatorCapability, VerificationStatus, CropScheduleTemplate
} from '../types';
import Button from '../shared/components/ui/Button';
import { CropSymbol } from '../features/context/components/CropSelector';
import VocabManager from '../features/voice/components/VocabManager';
// import Link from 'next/link'; // REMOVED
import PeopleDirectory from '../features/people/components/PeopleDirectory';
import { Person, PlotGeoData } from '../types';
import { AddMemberWizard } from '../features/people/components/AddMemberWizard';
import FarmInviteQrSheet from '../features/onboarding/qr/FarmInviteQrSheet';
import { QrCode } from 'lucide-react';
import EntitlementBanner, { type SubscriptionSnapshotView } from '../features/admin/billing/EntitlementBanner';
import MembershipsList from '../features/people/components/MembershipsList';
import type { MyFarmDto, FarmDetailsDto } from '../features/onboarding/qr/inviteApi';
import { getFarmDetails, updateFarmBoundary, probeFarmWeather } from '../features/onboarding/qr/inviteApi';

// Local-only flag remembering that the owner explicitly opted in to live weather
// for a given farm. This is UX consent — the backend always serves weather once
// the canonical centre is set; this flag just collapses the "Connect Farm to
// Weather" tile after the user has acknowledged the link.
const WEATHER_CONNECTED_KEY = (farmId: string) => `farm:weatherConnected:${farmId}`;
const readWeatherConnected = (farmId: string): boolean => {
    try { return window.localStorage.getItem(WEATHER_CONNECTED_KEY(farmId)) === 'true'; }
    catch { return false; }
};
const writeWeatherConnected = (farmId: string, value: boolean): void => {
    try { window.localStorage.setItem(WEATHER_CONNECTED_KEY(farmId), value ? 'true' : 'false'); }
    catch { /* noop */ }
};
import { PlotMap } from '../features/context/components/PlotMap';
import { getDateKey } from '../core/domain/services/DateKeyService';
import { createInitialScheduleInstance } from '../features/scheduler/planning/ClientPlanEngine';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../infrastructure/reference/TemplateCatalog';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../app/providers/AuthProvider';
import { idGenerator } from '../core/domain/services/IdGenerator';
import { systemClock } from '../core/domain/services/Clock';
import ElectricityTimingConfigurator from '../features/profile/components/ElectricityTimingConfigurator';
import { SoilHealthReportsManager } from '../features/profile/components/SoilHealthReportsManager';
import { VarietySelector } from '../features/context/components/VarietySelector';
import ReliabilityScoreCard from '../features/work/components/ReliabilityScoreCard';
import { useWorkerProfile } from '../features/work/hooks/useWorkerProfile';
import { useFarmContext } from '../core/session/FarmContext';



// Identity verification status for farmer ID
type IdentityStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

// Identity status helper - maps VerificationStatus enum to IdentityStatus
const getIdentityStatus = (profile: FarmerProfile): IdentityStatus => {
    if (profile.verificationStatus === VerificationStatus.GovernmentVerified) return 'VERIFIED';
    if (profile.verificationStatus === VerificationStatus.PhoneVerified) return 'PENDING';
    if (profile.verificationStatus === VerificationStatus.Unverified) return 'NOT_STARTED';
    return 'PENDING'; // Default to PENDING to show the red banner
};

interface ProfilePageProps {
    profile: FarmerProfile;
    crops: CropProfile[];
    onUpdateProfile: (p: FarmerProfile) => void;
    onUpdateCrops: (c: CropProfile[]) => void;
    waterResources?: any;
    electricity?: any;
    // People Handlers
    onAddPerson?: (person: Person) => void;
    onDeletePerson?: (id: string) => void;
    onOpenScheduleLibrary?: (cropId?: string) => void;
    onOpenFinanceManager?: () => void;
    onOpenReferrals?: () => void;
    onOpenQrDemo?: () => void;
}

// --- CONSTANTS ---
const CROP_ICONS = ['Grape', 'Sugarcane', 'Cotton', 'Wheat', 'Onion', 'Sprout', 'Pomegranate', 'Trees'];

// 20+ unique Tailwind colors for crops - guaranteed no repetition for typical farm sizes
const CROP_COLORS = [
    'bg-emerald-500',   // 1
    'bg-blue-500',      // 2
    'bg-purple-500',    // 3
    'bg-orange-500',    // 4
    'bg-pink-500',      // 5
    'bg-teal-500',      // 6
    'bg-rose-500',      // 7
    'bg-amber-500',     // 8
    'bg-indigo-500',    // 9
    'bg-cyan-500',      // 10
    'bg-lime-500',      // 11
    'bg-fuchsia-500',   // 12
    'bg-sky-500',       // 13
    'bg-violet-500',    // 14
    'bg-red-500',       // 15
    'bg-green-600',     // 16
    'bg-blue-600',      // 17
    'bg-yellow-600',    // 18
    'bg-purple-600',    // 19
    'bg-orange-600',    // 20
];

// Helper: Get the next unused color based on existing crops
const getNextUnusedColor = (existingCrops: CropProfile[]): string => {
    const usedColors = new Set(existingCrops.map(c => c.color));
    // Find first unused color from palette
    for (const color of CROP_COLORS) {
        if (!usedColors.has(color)) {
            return color;
        }
    }
    // Fallback if all colors used: generate a unique shade based on index
    const index = existingCrops.length;
    const shades = ['400', '500', '600', '700'];
    const baseColors = ['emerald', 'blue', 'purple', 'orange', 'pink', 'teal', 'rose', 'amber', 'indigo', 'cyan'];
    const baseColor = baseColors[index % baseColors.length];
    const shade = shades[Math.floor(index / baseColors.length) % shades.length];
    return `bg-${baseColor}-${shade}`;
};

// --- SUB-COMPONENT: PLOT WIZARD (NEW) ---

interface PlotWizardProps {
    crop: CropProfile;
    profile: FarmerProfile;
    onSave: (plot: Plot) => void;
    onCancel: () => void;
}

const PlotWizard: React.FC<PlotWizardProps> = ({ crop, profile, onSave, onCancel }) => {
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

// --- SUB-COMPONENT: IRRIGATION PLANNER (UPDATED) ---

const IrrigationPlanner = ({ crops, motors, onUpdateCrops }: { crops: CropProfile[], motors: FarmMotor[], onUpdateCrops: (c: CropProfile[]) => void }) => {
    const { t } = useLanguage();
    const [selectedCropId, setSelectedCropId] = useState<string>(crops[0]?.id || '');
    const [selectedPlotId, setSelectedPlotId] = useState<string>('');

    const activeCrop = crops.find(c => c.id === selectedCropId);
    const activePlot = activeCrop?.plots.find(p => p.id === selectedPlotId);

    // Initialize editing state when plot is selected
    const [editPlan, setEditPlan] = useState<Partial<IrrigationPlan>>({});

    const handlePlotSelect = (plotId: string) => {
        setSelectedPlotId(plotId);
        const plot = activeCrop?.plots.find(p => p.id === plotId);
        if (plot && plot.irrigationPlan) {
            setEditPlan({ ...plot.irrigationPlan });
        } else {
            // Default blank plan
            setEditPlan({
                frequency: 'Daily',
                durationMinutes: 60,
                preferredTime: 'Morning',
                planStartDate: getDateKey()
            });
        }
    };

    const savePlan = () => {
        if (!activeCrop || !activePlot) return;
        const updatedPlots = activeCrop.plots.map(p => {
            if (p.id === selectedPlotId) {
                // Keep the infrastructure defaults synced or let them diverge?
                // For now, updating Plan updates the 'Schedule', Infra remains 'Hardware'
                return { ...p, irrigationPlan: editPlan as IrrigationPlan };
            }
            return p;
        });
        const updatedCrops = crops.map(c => c.id === selectedCropId ? { ...c, plots: updatedPlots } : c);
        onUpdateCrops(updatedCrops);
        alert("Irrigation Schedule Saved!");
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                    <div className="bg-blue-100 p-2 rounded-xl text-blue-700"><CalendarDays size={24} /></div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg">Standard Irrigation Setup</h3>
                        <p className="text-xs text-slate-500">Define the target frequency and duration (Defaults).</p>
                    </div>
                </div>

                {/* 1. Select Context */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Crop</label>
                        <select
                            className="w-full mt-1 p-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:border-emerald-500"
                            value={selectedCropId}
                            onChange={(e) => { setSelectedCropId(e.target.value); setSelectedPlotId(''); }}
                        >
                            {crops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase">Plot</label>
                        <select
                            className="w-full mt-1 p-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:border-emerald-500 disabled:opacity-50"
                            value={selectedPlotId}
                            onChange={(e) => handlePlotSelect(e.target.value)}
                            disabled={!selectedCropId}
                        >
                            <option value="">Select Plot...</option>
                            {activeCrop?.plots.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* 2. Configure Plan */}
                {selectedPlotId && (
                    <div className="space-y-4 pt-4 border-t border-slate-100 animate-in fade-in">

                        {/* Infra Read-only View */}
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-500">
                            <span>Hardware: <strong>{activePlot?.infrastructure?.irrigationMethod || 'None'}</strong></span>
                            <span>Motor: <strong>{motors.find(m => m.id === activePlot?.infrastructure?.linkedMotorId)?.name || 'None'}</strong></span>
                        </div>

                        {/* Frequency */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Frequency</label>
                            <div className="flex flex-wrap gap-2 mt-1">
                                {['Daily', 'Alternate', 'Every 3 Days', 'Weekly'].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setEditPlan({ ...editPlan, frequency: f as IrrigationFrequency })}
                                        className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all ${editPlan.frequency === f ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Duration & Time */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Duration (Mins)</label>
                                <input
                                    type="number"
                                    className="w-full mt-1 p-2 rounded-lg border border-slate-200 text-sm font-bold outline-none focus:border-emerald-500"
                                    value={editPlan.durationMinutes || ''}
                                    onChange={e => setEditPlan({ ...editPlan, durationMinutes: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Preferred Time</label>
                                <select
                                    className="w-full mt-1 p-2 rounded-lg border border-slate-200 bg-white text-sm font-bold outline-none"
                                    value={editPlan.preferredTime || 'Morning'}
                                    onChange={e => setEditPlan({ ...editPlan, preferredTime: e.target.value as IrrigationTimeWindow })}
                                >
                                    <option value="Morning">Morning</option>
                                    <option value="Afternoon">Afternoon</option>
                                    <option value="Evening">Evening</option>
                                    <option value="Night">Night</option>
                                </select>
                            </div>
                        </div>

                        {/* Start Date */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Plan Start Date (For Alternate Calc)</label>
                            <input
                                type="date"
                                className="w-full mt-1 p-2 rounded-lg border border-slate-200 text-sm font-bold outline-none"
                                value={editPlan.planStartDate || ''}
                                onChange={e => setEditPlan({ ...editPlan, planStartDate: e.target.value })}
                            />
                        </div>

                        <Button onClick={savePlan} className="w-full py-3 text-sm shadow-md mt-2">
                            {t('profile.saveSetup')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- SUB-COMPONENT: MACHINERY MANAGER ---

const MachineryManager = ({ profile, onUpdate }: { profile: FarmerProfile, onUpdate: (p: FarmerProfile) => void }) => {
    const { t } = useLanguage();
    const [isAdding, setIsAdding] = useState(false);
    const [newMachine, setNewMachine] = useState<Partial<FarmMachinery>>({ type: 'Tractor', ownership: 'Owned' });

    const addMachine = () => {
        if (!newMachine.name) return;
        const machine: FarmMachinery = {
            id: `mach_${idGenerator.generate()}`,
            name: newMachine.name,
            type: newMachine.type || 'Tractor',
            ownership: newMachine.ownership || 'Owned',
            capacity: newMachine.capacity
        };
        const updatedMachines = [...(profile.machineries || []), machine];
        onUpdate({ ...profile, machineries: updatedMachines });
        setIsAdding(false);
        setNewMachine({ type: 'Tractor', ownership: 'Owned' });
    };

    const deleteMachine = (id: string) => {
        const updatedMachines = (profile.machineries || []).filter(m => m.id !== id);
        onUpdate({ ...profile, machineries: updatedMachines });
    };

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex justify-between items-center px-1">
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                    <Tractor size={24} className="text-orange-500" /> {t('profile.machinery')}
                </h3>
                <button onClick={() => setIsAdding(true)} className="text-emerald-600 font-bold text-xs flex items-center bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 hover:bg-emerald-100">
                    <Plus size={14} className="mr-1" /> {t('profile.addMachine')}
                </button>
            </div>

            <div className="grid gap-3">
                {(profile.machineries || []).map(m => (
                    <div key={m.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                                {m.type === 'Tractor' ? <Tractor size={20} /> : <Wrench size={20} />}
                            </div>
                            <div>
                                <p className="font-bold text-slate-800">{m.name}</p>
                                <p className="text-xs text-slate-500">
                                    {m.ownership} • {m.type}
                                    {m.capacity ? ` • ${m.capacity}L` : ''}
                                </p>
                            </div>
                        </div>
                        <button onClick={() => deleteMachine(m.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                ))}
                {(!profile.machineries || profile.machineries.length === 0) && (
                    <div className="p-6 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        {t('profile.noMachinery')}
                    </div>
                )}
            </div>

            {isAdding && (
                <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-lg animate-in fade-in ring-1 ring-emerald-50 space-y-3">
                    <div className="flex justify-between items-center">
                        <h4 className="text-xs font-bold text-emerald-600 uppercase">{t('profile.newMachine')}</h4>
                        <button onClick={() => setIsAdding(false)}><X size={16} className="text-slate-400" /></button>
                    </div>
                    <input
                        placeholder="Name (e.g. John Deere 5050)"
                        autoFocus
                        className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-emerald-500"
                        value={newMachine.name || ''}
                        onChange={e => setNewMachine({ ...newMachine, name: e.target.value })}
                    />
                    <div className="flex gap-2">
                        <select
                            className="flex-1 p-2.5 border border-slate-200 rounded-xl bg-white text-sm outline-none"
                            value={newMachine.type}
                            onChange={e => setNewMachine({ ...newMachine, type: e.target.value as any })}
                        >
                            <option value="Tractor">Tractor</option>
                            <option value="Sprayer">Sprayer</option>
                            <option value="Rotavator">Rotavator</option>
                            <option value="Harvester">Harvester</option>
                        </select>
                        <select
                            className="w-32 p-2.5 border border-slate-200 rounded-xl bg-white text-sm outline-none"
                            value={newMachine.ownership}
                            onChange={e => setNewMachine({ ...newMachine, ownership: e.target.value as any })}
                        >
                            <option value="Owned">{t('profile.owned')}</option>
                            <option value="Rented">{t('profile.rented')}</option>
                        </select>
                    </div>

                    {/* Capacity for Sprayers */}
                    {(newMachine.type === 'Sprayer' || newMachine.type === 'Tractor') && (
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">{t('profile.tankCapacity')}</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    placeholder={newMachine.type === 'Sprayer' ? 'e.g. 200' : 'e.g. 600'}
                                    className="w-full mt-1 p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-emerald-500 pl-9"
                                    value={newMachine.capacity || ''}
                                    onChange={e => setNewMachine({ ...newMachine, capacity: parseFloat(e.target.value) })}
                                />
                                <Cylinder size={16} className="absolute left-3 top-4 text-slate-400" />
                            </div>
                        </div>
                    )}

                    <Button onClick={addMachine} className="w-full py-3 text-xs">{t('profile.saveMachine')}</Button>
                </div>
            )}
        </div>
    );
};

// --- WATER SOURCE WIZARD (Integrated flow: Source + Motors) ---

interface WaterSourceWizardProps {
    profile: FarmerProfile;
    onSave: (source: WaterResource, motors: FarmMotor[]) => void;
    onCancel: () => void;
}

const WaterSourceWizard: React.FC<WaterSourceWizardProps> = ({ profile, onSave, onCancel }) => {
    const { t } = useLanguage();
    const [step, setStep] = useState(1); // 1 = source details, 2 = motors

    // Source state
    const [sourceName, setSourceName] = useState('');
    const [sourceType, setSourceType] = useState<'Well' | 'Borewell' | 'Canal' | 'Farm Pond' | 'Tanker'>('Well');
    const [sourceError, setSourceError] = useState('');

    // Motors state (array for multiple motors)
    const [motors, setMotors] = useState<Array<{
        name: string;
        hp: number;
        phase: '1' | '3';
        powerSourceType: 'MSEB' | 'Solar' | 'Generator';
        hasDrip: boolean;
        dripPipeSize: string;
        dripHasFilter: boolean;
        dripFlow: string;
    }>>([{ name: '', hp: 5, phase: '3', powerSourceType: 'MSEB', hasDrip: false, dripPipeSize: '16mm', dripHasFilter: true, dripFlow: '' }]);

    const addMotorSlot = () => {
        setMotors([...motors, { name: '', hp: 5, phase: '3', powerSourceType: 'MSEB', hasDrip: false, dripPipeSize: '16mm', dripHasFilter: true, dripFlow: '' }]);
    };

    const removeMotorSlot = (index: number) => {
        if (motors.length > 1) {
            setMotors(motors.filter((_, i) => i !== index));
        }
    };

    const updateMotor = (index: number, field: string, value: any) => {
        setMotors(motors.map((m, i) => i === index ? { ...m, [field]: value } : m));
    };

    const handleNext = () => {
        if (!sourceName.trim()) {
            setSourceError('Source name is required');
            return;
        }
        setSourceError('');
        setStep(2);
    };

    const handleSave = () => {
        const sourceId = `w_${idGenerator.generate()}`;
        const newSource: WaterResource = {
            id: sourceId,
            name: sourceName.trim(),
            type: sourceType,
            isAvailable: true
        };

        // Filter out motors without names, then create motor objects
        const validMotors = motors
            .filter(m => m.name.trim() && m.hp > 0)
            .map(m => ({
                id: `m_${idGenerator.generate()}`,
                name: m.name.trim(),
                hp: m.hp,
                phase: m.phase,
                powerSourceType: m.powerSourceType,
                linkedWaterSourceId: sourceId,
                dripDetails: m.hasDrip ? { pipeSize: m.dripPipeSize, hasFilter: m.dripHasFilter, flowRatePerHour: Number(m.dripFlow) || undefined } : undefined,
                linkedPlotIds: [],
                schedule: { windowStart: '22:00', windowEnd: '06:00', days: ['Daily'] as string[], rotationType: 'Weekly' as const }
            }));

        onSave(newSource, validMotors);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-blue-50 p-4 border-b border-blue-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onCancel} className="p-2 hover:bg-blue-100 rounded-full"><X size={20} className="text-slate-500" /></button>
                        <div>
                            <h3 className="font-bold text-slate-800">Add Water Source</h3>
                            <div className="flex gap-1 mt-1">
                                <div className={`h-1.5 w-12 rounded-full ${step >= 1 ? 'bg-blue-500' : 'bg-slate-200'}`} />
                                <div className={`h-1.5 w-12 rounded-full ${step >= 2 ? 'bg-blue-500' : 'bg-slate-200'}`} />
                            </div>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase">Step {step}/2</span>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {/* STEP 1: Source Details */}
                    {step === 1 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Source Name *</label>
                                <input
                                    autoFocus
                                    className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-blue-500 ${sourceError ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                                    placeholder="e.g. Main Borewell"
                                    value={sourceName}
                                    onChange={e => {
                                        setSourceName(e.target.value);
                                        if (sourceError) setSourceError('');
                                    }}
                                />
                                {sourceError && (
                                    <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                                        <AlertTriangle size={12} /> {sourceError}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Source Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['Well', 'Borewell', 'Canal', 'Farm Pond', 'Tanker'] as const).map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setSourceType(type)}
                                            className={`py-3 rounded-xl border font-bold text-sm transition-all ${sourceType === type ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Motors */}
                    {step === 2 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4">
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center gap-2">
                                <Droplets size={20} className="text-blue-600" />
                                <div>
                                    <p className="font-bold text-blue-800 text-sm">{sourceName}</p>
                                    <p className="text-xs text-blue-600">{sourceType}</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                                    Pump Motor(s) for this source
                                </label>
                                <p className="text-xs text-slate-500 mb-3">
                                    Add at least one motor. For Farm Pond, you can add multiple motors.
                                </p>

                                <div className="space-y-3">
                                    {motors.map((motor, index) => (
                                        <div key={index} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-slate-500">Motor {index + 1}</span>
                                                {motors.length > 1 && (
                                                    <button
                                                        onClick={() => removeMotorSlot(index)}
                                                        className="text-red-500 text-xs hover:bg-red-50 p-1 rounded"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                            <input
                                                placeholder="Motor name (e.g. 5HP Submersible)"
                                                className="w-full p-2.5 border border-slate-200 rounded-xl font-bold outline-none focus:border-blue-500"
                                                value={motor.name}
                                                onChange={e => updateMotor(index, 'name', e.target.value)}
                                            />
                                            <div className="grid grid-cols-3 gap-2">
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400">HP *</label>
                                                    <input
                                                        type="number"
                                                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm font-bold outline-none"
                                                        value={motor.hp}
                                                        onChange={e => updateMotor(index, 'hp', parseFloat(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400">Phase</label>
                                                    <select
                                                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                                        value={motor.phase}
                                                        onChange={e => updateMotor(index, 'phase', e.target.value)}
                                                    >
                                                        <option value="1">1 Phase</option>
                                                        <option value="3">3 Phase</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-slate-400">Power</label>
                                                    <select
                                                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                                        value={motor.powerSourceType}
                                                        onChange={e => updateMotor(index, 'powerSourceType', e.target.value)}
                                                    >
                                                        <option value="MSEB">Electric</option>
                                                        <option value="Solar">Solar</option>
                                                        <option value="Generator">Diesel</option>
                                                    </select>
                                                </div>
                                            </div>
                                            {/* Drip Configuration */}
                                            <div className="pt-2 border-t border-slate-200">
                                                <div className="flex items-center justify-between mb-2">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                                        <Droplets size={12} /> Drip Configuration
                                                    </label>
                                                    <div className="flex bg-slate-200 rounded-lg p-0.5">
                                                        <button onClick={() => updateMotor(index, 'hasDrip', true)} className={`px-2 py-1 text-[10px] font-bold rounded-md ${motor.hasDrip ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Yes</button>
                                                        <button onClick={() => updateMotor(index, 'hasDrip', false)} className={`px-2 py-1 text-[10px] font-bold rounded-md ${!motor.hasDrip ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'}`}>No</button>
                                                    </div>
                                                </div>
                                                
                                                {motor.hasDrip && (
                                                    <div className="grid grid-cols-2 gap-2 mt-2 bg-white p-2 border border-slate-100 rounded-xl">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400">Pipe Size</label>
                                                            <select
                                                                className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-xs bg-slate-50"
                                                                value={motor.dripPipeSize}
                                                                onChange={e => updateMotor(index, 'dripPipeSize', e.target.value)}
                                                            >
                                                                <option value="12mm">12mm</option>
                                                                <option value="16mm">16mm</option>
                                                                <option value="20mm">20mm</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400">Flow Rate L/hr</label>
                                                            <input
                                                                type="number"
                                                                placeholder="e.g. 8000"
                                                                className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-xs outline-none bg-slate-50"
                                                                value={motor.dripFlow}
                                                                onChange={e => updateMotor(index, 'dripFlow', e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                        </div>
                                    ))}

                                    {(sourceType === 'Farm Pond' || motors.length < 4) && (
                                        <button
                                            onClick={addMotorSlot}
                                            className="w-full py-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 text-sm font-bold hover:bg-slate-50 flex items-center justify-center gap-1"
                                        >
                                            <Plus size={14} /> Add Another Motor
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 flex gap-3">
                    {step > 1 && (
                        <button
                            onClick={() => setStep(1)}
                            className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
                        >
                            Back
                        </button>
                    )}
                    {step === 1 ? (
                        <Button onClick={handleNext} className="flex-1 py-3 text-sm">
                            Next: Add Motors <ArrowRight size={16} className="ml-2" />
                        </Button>
                    ) : (
                        <Button onClick={handleSave} className="flex-1 py-3 text-sm bg-blue-600 hover:bg-blue-700">
                            <Save size={16} className="mr-2" /> Save Water Source
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- UTILITIES MAP BUILDER COMPONENT (Refactored with integrated flow) ---

const UtilitiesManager = ({ profile, onUpdate }: { profile: FarmerProfile, onUpdate: (p: FarmerProfile) => void }) => {
    const [showWizard, setShowWizard] = useState(false);
    const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

    // Handle saving source + motors from wizard
    const handleSaveSourceWithMotors = (source: WaterResource, motors: FarmMotor[]) => {
        onUpdate({
            ...profile,
            waterResources: [...profile.waterResources, source],
            motors: [...profile.motors, ...motors]
        });
        setShowWizard(false);
    };

    const deleteSource = (id: string) => {
        const newMotors = profile.motors.filter(m => m.linkedWaterSourceId !== id);
        const newSources = profile.waterResources.filter(w => w.id !== id);
        onUpdate({ ...profile, waterResources: newSources, motors: newMotors });
    };

    const deleteMotor = (motorId: string) => {
        onUpdate({ ...profile, motors: profile.motors.filter(m => m.id !== motorId) });
    };

    // Get motors for a specific source
    const getMotorsForSource = (sourceId: string) => {
        return profile.motors.filter(m => m.linkedWaterSourceId === sourceId);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            {/* Wizard overlay */}
            {showWizard && (
                <WaterSourceWizard
                    profile={profile}
                    onSave={handleSaveSourceWithMotors}
                    onCancel={() => setShowWizard(false)}
                />
            )}

            {/* Header + Add button */}
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Droplets size={20} className="text-blue-500" />
                        Water & Power
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">Water sources with their pump motors</p>
                </div>
                <button
                    onClick={() => setShowWizard(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg active:scale-95 transition-all flex items-center gap-2"
                >
                    <Plus size={16} /> Add Water Source
                </button>
            </div>

            {/* Sources list with integrated motors */}
            <div className="space-y-3">
                {profile.waterResources.length === 0 ? (
                    <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Droplets size={32} className="text-slate-300" />
                        </div>
                        <h3 className="font-bold text-slate-600 mb-2">No water sources yet</h3>
                        <p className="text-sm text-slate-400">
                            Add a water source with its pump motor to get started.
                        </p>
                    </div>
                ) : (
                    profile.waterResources.map(source => {
                        const linkedMotors = getMotorsForSource(source.id);
                        const isExpanded = expandedSourceId === source.id;

                        return (
                            <div key={source.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                {/* Source header */}
                                <div
                                    className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50"
                                    onClick={() => setExpandedSourceId(isExpanded ? null : source.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                                            <Droplets size={20} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800">{source.name}</p>
                                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                                <span>{source.type}</span>
                                                <span>•</span>
                                                {linkedMotors.length === 0 ? (
                                                    <span className="text-orange-600 font-bold flex items-center gap-1">
                                                        <AlertTriangle size={12} /> No motors
                                                    </span>
                                                ) : (
                                                    <span className="text-emerald-600 font-bold flex items-center gap-1">
                                                        <CheckCircle2 size={12} /> {linkedMotors.length} motor(s)
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <ChevronRight size={18} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteSource(source.id); }}
                                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                
                                {/* Expanded motors list (Visual Link Tree) */}
                                {isExpanded && (
                                    <div className="bg-slate-50 p-4 border-t border-slate-100 flex pb-5">
                                        <div className="w-6 border-l-2 border-slate-300 border-b-2 rounded-bl-xl ml-2 mb-8 mr-4 self-stretch"></div>
                                        <div className="flex-1 space-y-3 mt-4">
                                            {linkedMotors.length === 0 ? (
                                                <p className="text-sm text-slate-400 py-2">No motors linked.</p>
                                            ) : (
                                                linkedMotors.map(motor => (
                                                    <div key={motor.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm relative group">
                                                        {/* Connector line for multiple items */}
                                                        <div className="absolute -left-5 top-6 w-5 border-b-2 border-slate-300"></div>
                                                        
                                                        <div className="flex justify-between items-start">
                                                            <div className="flex items-start gap-3">
                                                                <div className="p-2 bg-slate-800 text-white rounded-xl shadow-inner mt-1">
                                                                    <Settings2 size={18} />
                                                                </div>
                                                                <div>
                                                                    <p className="font-bold text-slate-800 text-sm">{motor.name}</p>
                                                                    <p className="text-xs text-slate-500 mb-1">
                                                                        {motor.hp}HP • {motor.phase} Phase • {motor.powerSourceType}
                                                                    </p>
                                                                    {motor.dripDetails && (
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 inline-flex mt-1">
                                                                            <Droplets size={10} />
                                                                            Drip: {motor.dripDetails.pipeSize} {motor.dripDetails.hasFilter ? '• Filtered' : ''}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col gap-2 items-end">
                                                                <button
                                                                    onClick={() => deleteMotor(motor.id)}
                                                                    className="p-1.5 text-slate-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); alert('Link to plot functionality coming soon'); }}
                                                                    className="px-2 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border hover:border-emerald-200 rounded-lg transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
                                                                >
                                                                    <MapPin size={10} /> Link to Plot
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                            </div>
                        );
                    })
                )}
            </div>

            <ElectricityTimingConfigurator profile={profile} onUpdate={onUpdate} />
        </div>
    );
};

// --- MAIN PAGE LAYOUT ---

const ProfilePage: React.FC<ProfilePageProps> = ({ profile, crops, onUpdateProfile, onUpdateCrops, onAddPerson, onDeletePerson, onOpenScheduleLibrary, onOpenFinanceManager, onOpenReferrals, onOpenQrDemo }) => {
    const { t } = useLanguage();
    const { logout, session: authSession } = useAuth();
    const [activeTab, setActiveTab] = useState<'identity' | 'structure' | 'utils' | 'plan' | 'machines' | 'health' | 'intelligence' | 'people'>('structure');

    // Crop & Plot State (Reused from previous, simplified)
    const [isAddingCrop, setIsAddingCrop] = useState(false);
    const [newCropData, setNewCropData] = useState<Partial<CropProfile>>({ iconName: 'Sprout' });
    const [cropNameError, setCropNameError] = useState<string>('');

    // New Plot Wizard State
    const [wizardCropId, setWizardCropId] = useState<string | null>(null);
    const [mappingPlotId, setMappingPlotId] = useState<{ cropId: string, plotId: string } | null>(null);
    const normalizeCropName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedNewCropName = normalizeCropName(newCropData.name || '');
    const isDuplicateCropName = normalizedNewCropName.length > 0 &&
        crops.some(c => normalizeCropName(c.name) === normalizedNewCropName);

    // Handlers (Simplified for brevity, logic identical to previous)
    const handleAddCrop = () => {
        // Validate crop name
        const trimmedName = newCropData.name?.trim() || '';
        if (trimmedName.length < 2) {
            setCropNameError('Crop name is required (at least 2 characters)');
            return;
        }
        if (crops.some(c => normalizeCropName(c.name) === normalizeCropName(trimmedName))) {
            setCropNameError('This crop already exists. One crop can be added only once.');
            return;
        }
        setCropNameError('');

        const autoColor = getNextUnusedColor(crops);
        const defaultScheduleId = getSchedulesForCrop(trimmedName)[0]?.id || null;
        const newCrop: CropProfile = {
            id: `c_${idGenerator.generate()}`,
            name: trimmedName,
            iconName: newCropData.iconName!,
            color: autoColor,
            plots: [],
            activeScheduleId: defaultScheduleId,
            supportedTasks: ['General'],
            workflow: [],
            createdAt: systemClock.nowISO()
        };
        onUpdateCrops([...crops, newCrop]);
        setIsAddingCrop(false);
        setNewCropData({ iconName: 'Sprout' });
    };

    const handleAddPlot = (plot: Plot) => {
        onUpdateCrops(crops.map(crop => {
            if (crop.id !== wizardCropId) return crop;

            const adoptedScheduleId = plot.schedule?.templateId || crop.activeScheduleId || null;
            const adoptedTemplate = getScheduleById(adoptedScheduleId || '');

            return {
                ...crop,
                activeScheduleId: adoptedScheduleId,
                plots: [...crop.plots, plot].map(existingPlot => {
                    if (!adoptedScheduleId || !adoptedTemplate) return existingPlot;
                    return {
                        ...existingPlot,
                        schedule: {
                            ...existingPlot.schedule,
                            templateId: adoptedScheduleId,
                            referenceType: adoptedTemplate.referenceType,
                            stageOverrides: [],
                            expectationOverrides: []
                        }
                    };
                })
            };
        }));
        setWizardCropId(null);
    };

    const handleSaveMap = (cropId: string, plotId: string, geoData: PlotGeoData) => {
        onUpdateCrops(crops.map(c => {
            if (c.id !== cropId) return c;
            return {
                ...c,
                plots: c.plots.map(p => {
                    if (p.id !== plotId) return p;
                    return {
                        ...p,
                        geoData,
                        baseline: {
                            ...p.baseline,
                            totalArea: parseFloat(geoData.calculatedAreaAcres.toFixed(2)), // Auto-update area
                            unit: 'Acre'
                        }
                    };
                })
            };
        }));
    };

    const deleteCrop = (id: string) => onUpdateCrops(crops.filter(c => c.id !== id));
    const deletePlot = (cId: string, pId: string) => onUpdateCrops(crops.map(c => c.id === cId ? { ...c, plots: c.plots.filter(p => p.id !== pId) } : c));

    // Sidebar collapse (web only). Persists across reloads so returning users
    // keep their preferred layout. On mobile (<lg) the sidebar stacks above
    // content and this flag is ignored so the Android/small-screen flow is
    // unchanged.
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('shramsafal_setup_sidebar_collapsed') === '1';
    });
    React.useEffect(() => {
        window.localStorage.setItem('shramsafal_setup_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
    }, [sidebarCollapsed]);

    const TabItem = ({ id, label, icon }: { id: typeof activeTab, label: string, icon: React.ReactNode }) => {
        const isActive = activeTab === id;
        return (
            <button
                onClick={() => setActiveTab(id)}
                title={sidebarCollapsed ? label : undefined}
                className={`flex items-center w-full rounded-xl text-left transition-all
                    ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}
                    ${isActive ? 'bg-emerald-50 text-emerald-800 border border-emerald-100 shadow-sm' : 'text-slate-500 hover:bg-white'}`}
            >
                <div className={`${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>{icon}</div>
                <span className={`text-sm font-bold ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{label}</span>
                {isActive && !sidebarCollapsed && <ChevronRight size={16} className="ml-auto text-emerald-400 hidden lg:block" />}
                {isActive && !sidebarCollapsed && <ChevronRight size={16} className="ml-auto text-emerald-400 lg:hidden" />}
            </button>
        );
    };

    const [showMemberWizard, setShowMemberWizard] = useState(false);
    const [showInviteQr, setShowInviteQr] = useState(false);
    const [myFarm, setMyFarm] = useState<{ farmId: string; name: string; role: string; subscription: SubscriptionSnapshotView | null } | null>(null);
    const [myMemberships, setMyMemberships] = useState<MyFarmDto[]>([]);
    const [farmLookupError, setFarmLookupError] = useState<string | null>(null);
    const [farmDetails, setFarmDetails] = useState<FarmDetailsDto | null>(null);
    const [showFarmBoundary, setShowFarmBoundary] = useState(false);
    const [savingBoundary, setSavingBoundary] = useState(false);
    const [boundaryError, setBoundaryError] = useState<string | null>(null);
    const [weatherConnected, setWeatherConnected] = useState<boolean>(false);
    const [connectingWeather, setConnectingWeather] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    // --- HANDLERS ---
    const handleAddMember = (member: any) => {
        if (onAddPerson) onAddPerson({ ...member, id: `p_${idGenerator.generate()}` });
        setShowMemberWizard(false);
    };

    // When the owner taps "Share farm QR" we need the real server farmId,
    // not the localStorage phone string. /shramsafal/farms/mine returns
    // that. Lazy-load on first open.
    const handleOpenInviteQr = React.useCallback(async () => {
        setFarmLookupError(null);
        if (myFarm) {
            setShowInviteQr(true);
            return;
        }
        try {
            const { getMyFarms } = await import('../features/onboarding/qr/inviteApi');
            const farms = await getMyFarms();
            if (farms.length === 0) {
                setFarmLookupError('You do not own a farm yet. Ask for help to set one up.');
                return;
            }
            const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
            setMyFarm({
                farmId: ownerFarm.farmId,
                name: ownerFarm.name,
                role: ownerFarm.role,
                subscription: ownerFarm.subscription ?? null,
            });
            setShowInviteQr(true);
        } catch (err) {
            setFarmLookupError(err instanceof Error ? err.message : 'Could not load your farm.');
        }
    }, [myFarm]);

    // Load the farm snapshot on mount so the entitlement banner shows
    // without waiting for the owner to tap "Share farm QR" first.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { getMyFarms } = await import('../features/onboarding/qr/inviteApi');
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyMemberships(farms);
                if (farms.length === 0) return;
                const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
                setMyFarm(prev => prev ?? {
                    farmId: ownerFarm.farmId,
                    name: ownerFarm.name,
                    role: ownerFarm.role,
                    subscription: ownerFarm.subscription ?? null,
                });
            } catch {
                /* silent — user may not be authenticated yet */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Pull the farm's canonical centre + mapped-area so the Identity card
    // can show whether the farm boundary has been drawn. Weather needs this
    // too — without a canonical centre the forecast endpoint returns 400.
    React.useEffect(() => {
        if (!myFarm?.farmId) { setFarmDetails(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const dto = await getFarmDetails(myFarm.farmId);
                if (!cancelled) setFarmDetails(dto);
            } catch {
                if (!cancelled) setFarmDetails(null);
            }
        })();
        return () => { cancelled = true; };
    }, [myFarm?.farmId]);

    const handleSaveFarmBoundary = React.useCallback(async (geoData: PlotGeoData) => {
        if (!myFarm?.farmId || savingBoundary) return;
        setSavingBoundary(true);
        setBoundaryError(null);
        try {
            const updated = await updateFarmBoundary(myFarm.farmId, {
                boundary: geoData.boundary.map(p => ({ lat: p.lat, lng: p.lng })),
                centre: { lat: geoData.center.lat, lng: geoData.center.lng },
                areaAcres: Number(geoData.calculatedAreaAcres.toFixed(4)),
            });
            setFarmDetails(updated);
        } catch (err) {
            const message = err instanceof Error ? err.message
                : (typeof err === 'object' && err && 'message' in err) ? String((err as { message: unknown }).message)
                : 'Could not save farm boundary.';
            setBoundaryError(message);
        } finally {
            setSavingBoundary(false);
        }
    }, [myFarm?.farmId, savingBoundary]);

    const handleFinishFarmBoundary = React.useCallback(() => {
        setShowFarmBoundary(false);
        setBoundaryError(null);
        // No reload here — we now want the user to see the intermediate
        // "Connect Farm to Weather" tile so they own the moment of consent.
        // The Connect handler reloads after the probe succeeds.
    }, []);

    // Hydrate the weather-connected flag once the farmId is known. The flag
    // is per-farm so switching contexts doesn't leak consent across farms.
    React.useEffect(() => {
        if (myFarm?.farmId) {
            setWeatherConnected(readWeatherConnected(myFarm.farmId));
        } else {
            setWeatherConnected(false);
        }
    }, [myFarm?.farmId]);

    const handleConnectWeather = React.useCallback(async () => {
        if (!myFarm?.farmId || connectingWeather) return;
        setConnectingWeather(true);
        setConnectError(null);
        try {
            await probeFarmWeather(myFarm.farmId);
            writeWeatherConnected(myFarm.farmId, true);
            setWeatherConnected(true);
            // Reload so useWeatherMonitor re-inits and the WeatherWidget
            // leaves its skeleton state on the daily-log page.
            window.setTimeout(() => window.location.reload(), 200);
        } catch (err) {
            const apiErr = err as { error?: string; message?: string };
            if (apiErr?.error === 'ShramSafal.WeatherProviderNotConfigured') {
                setConnectError(
                    'Weather provider not yet available — your boundary is saved. We\'ll auto-enable live weather as soon as the provider key is configured.',
                );
            } else if (apiErr?.error === 'ShramSafal.FarmCentreMissing') {
                setConnectError('Farm boundary missing. Please draw the boundary first.');
            } else {
                setConnectError(apiErr?.message ?? 'Could not connect weather. Please try again.');
            }
        } finally {
            setConnectingWeather(false);
        }
    }, [myFarm?.farmId, connectingWeather]);

    const handleExitMembership = React.useCallback(async (farmId: string, _farmName: string) => {
        const { exitMembership, getMyFarms, isInviteApiError } = await import('../features/onboarding/qr/inviteApi');
        try {
            await exitMembership(farmId);
            const refreshed = await getMyFarms();
            setMyMemberships(refreshed);
            if (myFarm?.farmId === farmId) {
                setMyFarm(null);
            }
        } catch (err) {
            const message = isInviteApiError(err) ? err.message : 'Exit failed.';
            throw new Error(message);
        }
    }, [myFarm?.farmId]);

    // Compute which memberships the caller can't exit — any PrimaryOwner
    // farm where they're the sole PrimaryOwner. Client-side heuristic; the
    // server is still the source of truth and will return 409 if we guess wrong.
    // CEI Phase 4 §4.8 — show own reliability score if user is a Worker or Mukadam on any farm
    const { currentFarmId: _profileFarmId } = useFarmContext();
    const isWorkerOnAnyFarm = myMemberships.some(m => m.role === 'Worker' || m.role === 'Mukadam');
    const { profile: workerProfile } = useWorkerProfile(
        isWorkerOnAnyFarm ? (authSession?.userId ?? null) : null,
        _profileFarmId,
    );

    const nonExitableFarmIds = React.useMemo(() => {
        const ids = new Set<string>();
        for (const m of myMemberships) {
            if (m.role === 'PrimaryOwner') {
                ids.add(m.farmId); // conservative: assume they are the last
            }
        }
        return ids;
    }, [myMemberships]);

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-32">

            {/* MEMBER WIZARD */}
            {showMemberWizard && (
                <AddMemberWizard
                    onSave={handleAddMember}
                    onCancel={() => setShowMemberWizard(false)}
                />
            )}

            {/* FARM INVITE QR SHEET */}
            {myFarm && (
                <FarmInviteQrSheet
                    isOpen={showInviteQr}
                    onClose={() => setShowInviteQr(false)}
                    farmId={myFarm.farmId}
                    farmName={myFarm.name}
                />
            )}
            {farmLookupError && showInviteQr === false && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 shadow-lg z-50">
                    {farmLookupError}
                </div>
            )}

            {/* Wizard Overlay */}
            {wizardCropId && (
                <PlotWizard
                    crop={crops.find(c => c.id === wizardCropId)!}
                    profile={profile}
                    onSave={handleAddPlot}
                    onCancel={() => setWizardCropId(null)}
                />
            )}

            {/* Map Overlay — full-bleed bottom sheet on mobile, centered dialog on lg+.
                z-[60] sits above BottomNavigation (z-50) so the nav is fully covered. */}
            {mappingPlotId && (() => {
                const activeCrop = crops.find(c => c.id === mappingPlotId.cropId);
                const activePlot = activeCrop?.plots.find(p => p.id === mappingPlotId.plotId);
                return (
                    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm animate-in fade-in lg:flex lg:items-center lg:justify-center lg:p-6">
                        <div className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:max-w-3xl lg:rounded-3xl lg:shadow-2xl">
                            {/* Compact sticky header */}
                            <div className="flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg flex-shrink-0">
                                        <MapPin size={16} />
                                    </div>
                                    <div className="leading-tight min-w-0">
                                        <p className="text-[11px] text-slate-500 truncate">
                                            {activeCrop?.name || 'Crop'} · <span className="font-semibold text-slate-700">{activePlot?.name || 'Plot'}</span>
                                        </p>
                                        <p className="text-sm font-bold text-slate-900">Draw plot boundary</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMappingPlotId(null)}
                                    className="p-2 rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0"
                                    aria-label="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            {/* Map fills the rest; PlotMap owns its own sticky action bar */}
                            <div className="flex-1 min-h-0">
                                <PlotMap
                                    existingGeoData={activePlot?.geoData}
                                    onPlotComplete={(geoData) => handleSaveMap(mappingPlotId.cropId, mappingPlotId.plotId, geoData)}
                                    onDone={() => setMappingPlotId(null)}
                                />
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Farm boundary modal — same full-bleed bottom-sheet / lg dialog
                pattern as the plot boundary overlay above. Without a saved
                canonical centre the weather endpoint 400s, so this is the
                pre-requisite entry point wired from the Identity card. */}
            {showFarmBoundary && myFarm && (
                <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm animate-in fade-in lg:flex lg:items-center lg:justify-center lg:p-6">
                    <div className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:max-w-3xl lg:rounded-3xl lg:shadow-2xl">
                        <div className="flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg flex-shrink-0">
                                    <MapPin size={16} />
                                </div>
                                <div className="leading-tight min-w-0">
                                    <p className="text-[11px] text-slate-500 truncate">
                                        Farm · <span className="font-semibold text-slate-700">{myFarm.name}</span>
                                    </p>
                                    <p className="text-sm font-bold text-slate-900">Draw farm boundary</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowFarmBoundary(false); setBoundaryError(null); }}
                                className="p-2 rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0"
                                aria-label="Close"
                                disabled={savingBoundary}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {boundaryError && (
                            <div className="flex-shrink-0 bg-red-50 border-b border-red-100 px-4 py-2 text-xs text-red-700 flex items-center gap-2">
                                <AlertTriangle size={14} /> {boundaryError}
                            </div>
                        )}
                        <div className="flex-1 min-h-0">
                            <PlotMap
                                onPlotComplete={(geoData) => { void handleSaveFarmBoundary(geoData); }}
                                onDone={handleFinishFarmBoundary}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6">

                {/* SIDEBAR NAVIGATION — full width on mobile/tablet (Android-like
                    flow), side-rail on lg+ desktops. A collapse toggle appears
                    only on lg+ so narrow viewports never lose content room. */}
                <div className={`w-full flex-shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'}`}>
                    <div className="bg-slate-50/50 p-2 rounded-2xl border border-slate-200 space-y-1">

                        {/* Header row: section title + collapse toggle (desktop only) */}
                        <div className="flex items-center justify-between">
                            <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                                {t('profile.setupHub')}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSidebarCollapsed(v => !v)}
                                title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                                aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                                className="hidden lg:inline-flex items-center justify-center ml-auto mr-1 h-8 w-8 rounded-lg text-slate-400 hover:bg-white hover:text-emerald-600 transition-colors"
                            >
                                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                            </button>
                        </div>

                        <TabItem id="identity" label={t('profile.farmerIdentity')} icon={<User size={20} />} />
                        <TabItem id="structure" label={t('profile.cropsAndPlots')} icon={<Sprout size={20} />} />
                        <TabItem id="utils" label={t('profile.waterAndPower')} icon={<Zap size={20} />} />
                        {/* <TabItem id="plan" label="Irrigation Plan" icon={<CalendarDays size={20} />} /> */}
                        <TabItem id="machines" label={t('profile.machinery')} icon={<Tractor size={20} />} />
                        <TabItem id="health" label="Soil & Crop Health" icon={<FlaskConical size={20} />} />
                        <TabItem id="intelligence" label={t('profile.intelligence')} icon={<BrainCircuit size={20} />} />

                        <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Finance</div>
                        <button
                            onClick={onOpenFinanceManager}
                            title={sidebarCollapsed ? 'Finance Manager' : undefined}
                            className={`flex items-center w-full rounded-xl text-left text-slate-500 hover:bg-white hover:text-emerald-700 transition-all group
                                ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}`}
                        >
                            <div className="text-slate-400 group-hover:text-emerald-600"><BarChart3 size={20} /></div>
                            <span className={`text-sm font-bold ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Finance Manager</span>
                            <ArrowRight size={16} className={`ml-auto text-slate-300 group-hover:text-emerald-400 ${sidebarCollapsed ? 'lg:hidden' : ''}`} />
                        </button>

                        {onOpenReferrals && (
                            <>
                                <div className={`px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>Growth</div>
                                <button
                                    onClick={onOpenReferrals}
                                    title={sidebarCollapsed ? 'Referrals & Benefits' : undefined}
                                    className={`flex items-center w-full rounded-xl text-left text-slate-500 hover:bg-white hover:text-emerald-700 transition-all group
                                        ${sidebarCollapsed ? 'lg:justify-center lg:p-2 gap-3 p-3' : 'gap-3 p-3'}`}
                                >
                                    <div className="text-slate-400 group-hover:text-emerald-600"><Medal size={20} /></div>
                                    <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                                        <span className="text-sm font-bold">रेफरल्स · Referrals</span>
                                        <span className="block text-[10px] text-slate-400">& Benefits</span>
                                    </div>
                                    <ArrowRight size={16} className={`ml-auto text-slate-300 group-hover:text-emerald-400 ${sidebarCollapsed ? 'lg:hidden' : ''}`} />
                                </button>
                            </>
                        )}

                    </div>
                </div>

                {/* CONTENT AREA */}
                <div className="flex-1 min-w-0">

                    {/* 1. IDENTITY */}
                    {activeTab === 'identity' && (
                        <div className="bg-transparent animate-in fade-in space-y-6">

                            {/* 1. FARMER IDENTITY CARD (HIERARCHY LAYER 1) - ENHANCED WITH STATUS */}
                            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">

                                {/* STATUS BANNER - Shows prominently based on verification status */}
                                {(() => {
                                    const identityStatus = getIdentityStatus(profile);
                                    if (identityStatus === 'PENDING') {
                                        return (
                                            <div className="bg-red-500 text-white px-6 py-3 flex items-center gap-3">
                                                <AlertTriangle size={20} />
                                                <div>
                                                    <p className="font-bold text-sm">⚠️ Farmer ID Pending</p>
                                                    <p className="text-xs opacity-90">Complete verification to unlock trusted records</p>
                                                </div>
                                            </div>
                                        );
                                    }
                                    if (identityStatus === 'NOT_STARTED') {
                                        return (
                                            <div className="bg-slate-600 text-white px-6 py-3 flex items-center gap-3">
                                                <FileText size={20} />
                                                <div>
                                                    <p className="font-bold text-sm">Verification Not Started</p>
                                                    <p className="text-xs opacity-90">Start verification to build trust</p>
                                                </div>
                                            </div>
                                        );
                                    }
                                    if (identityStatus === 'REJECTED') {
                                        return (
                                            <div className="bg-orange-500 text-white px-6 py-3 flex items-center gap-3">
                                                <AlertTriangle size={20} />
                                                <div>
                                                    <p className="font-bold text-sm">Verification Rejected</p>
                                                    <p className="text-xs opacity-90">Please fix issues and resubmit</p>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className="bg-emerald-500 text-white px-6 py-3 flex items-center gap-3">
                                            <ShieldCheck size={20} />
                                            <div>
                                                <p className="font-bold text-sm">✓ Verified Farmer</p>
                                                <p className="text-xs opacity-90">Government verified identity</p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="p-6">
                                    <div className="absolute top-16 right-0 p-4 opacity-10 pointer-events-none">
                                        <Medal size={120} className="text-emerald-900" />
                                    </div>

                                    <div className="flex items-start gap-5 relative z-10">
                                        <div className="relative">
                                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-3xl shadow-inner border-4 border-white">
                                                👨‍🌾
                                            </div>
                                            {getIdentityStatus(profile) === 'VERIFIED' && (
                                                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title={t('profile.verified')}>
                                                    <ShieldCheck size={16} />
                                                </div>
                                            )}
                                            {getIdentityStatus(profile) === 'PENDING' && (
                                                <div className="absolute -bottom-1 -right-1 bg-red-500 text-white p-1.5 rounded-full border-2 border-white shadow-sm" title="Pending">
                                                    <Clock size={16} />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                                                <h2 className="text-2xl font-black text-slate-800 break-words">{profile.name || '—'}</h2>
                                                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border border-emerald-200 whitespace-nowrap">
                                                    {t('profile.primaryOwner')}
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-3">
                                                <div className="flex items-center gap-1.5">
                                                    <MapPin size={16} className="text-slate-400" />
                                                    {profile.village || '—'}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Phone size={16} className="text-slate-400" />
                                                    {profile.phone || '—'}
                                                    {profile.phone && (
                                                        <span className="text-emerald-600 text-xs font-bold flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded">
                                                            <Check size={10} /> {t('profile.verified')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* DETAILED FIELDS - Always visible */}
                                    <div className="mt-6 pt-6 border-t border-slate-100">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Identity Details</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Full Name</p>
                                                <p className="text-sm font-bold text-slate-700">{profile.name || '—'}</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Mobile Number</p>
                                                <p className="text-sm font-bold text-slate-700">{profile.phone || '—'}</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Village / Taluka / District</p>
                                                <p className="text-sm font-bold text-slate-700">{profile.village || '—'}</p>
                                            </div>
                                            
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Land Record (7/12)</p>
                                                <p className="text-sm font-bold text-slate-500 italic">Not uploaded</p>
                                            </div>
                                            <div className="bg-slate-50 rounded-xl p-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Identity Document</p>
                                                <p className="text-sm font-bold text-red-600 flex items-center gap-1">
                                                    <AlertTriangle size={12} /> Pending Upload
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* CTA BUTTONS based on status */}
                                    <div className="mt-6">
                                        {(() => {
                                            const identityStatus = getIdentityStatus(profile);
                                            if (identityStatus === 'NOT_STARTED') {
                                                return (
                                                    <button className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg">
                                                        <Upload size={18} /> Start Verification
                                                    </button>
                                                );
                                            }
                                            if (identityStatus === 'PENDING') {
                                                return (
                                                    <button className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors shadow-lg">
                                                        <Eye size={18} /> View Submitted Details
                                                    </button>
                                                );
                                            }
                                            if (identityStatus === 'REJECTED') {
                                                return (
                                                    <button className="w-full py-3 bg-red-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-600 transition-colors shadow-lg">
                                                        <Upload size={18} /> Fix & Resubmit
                                                    </button>
                                                );
                                            }
                                            return (
                                                <button className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors">
                                                    <Eye size={18} /> View Verified Identity
                                                </button>
                                            );
                                        })()}
                                    </div>

                                    {/* FARM BOUNDARY + WEATHER LINK — three-state flow:
                                        A) no boundary → red "weather pending" + amber Draw CTA
                                        B) boundary drawn, weather not yet connected → emerald
                                           boundary tile + sky-blue "Connect Farm to Weather" CTA
                                        C) connected → single emerald confirmation row
                                        Lives directly under the Farmer ID CTA so owners treat it
                                        as the second "prove who/what you farm" step. */}
                                    {myFarm && (() => {
                                        const hasBoundary = !!(farmDetails?.canonicalCentreLat != null && farmDetails?.canonicalCentreLng != null);
                                        const acres = farmDetails?.totalMappedAreaAcres;

                                        // STATE C — boundary drawn AND weather connected
                                        if (hasBoundary && weatherConnected) {
                                            return (
                                                <div className="mt-4">
                                                    <div className="w-full rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white flex-shrink-0">
                                                            <CheckCircle2 size={18} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-bold text-emerald-800">
                                                                Farm boundary drawn · Weather connected
                                                            </p>
                                                            <p className="text-xs text-emerald-700/80">
                                                                {acres != null ? `${Number(acres).toFixed(2)} acres mapped · ` : ''}Live weather is on your daily log.
                                                            </p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowFarmBoundary(true)}
                                                            className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-900 flex-shrink-0"
                                                        >
                                                            Redraw
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // STATE B — boundary drawn, weather not yet connected
                                        if (hasBoundary) {
                                            return (
                                                <div className="mt-4 space-y-3">
                                                    <button
                                                        onClick={() => setShowFarmBoundary(true)}
                                                        className="w-full text-left rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 hover:border-emerald-300 transition-colors flex items-center gap-3"
                                                    >
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white flex-shrink-0">
                                                            <MapPin size={18} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-sm font-bold text-emerald-800">Farm boundary drawn</p>
                                                                <CheckCircle2 size={14} className="text-emerald-500" />
                                                            </div>
                                                            <p className="text-xs text-emerald-700/80">
                                                                {acres != null ? `${Number(acres).toFixed(2)} acres · ` : ''}Tap to redraw
                                                            </p>
                                                        </div>
                                                        <ChevronRight size={18} className="text-emerald-400 flex-shrink-0" />
                                                    </button>

                                                    <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => { void handleConnectWeather(); }}
                                                            disabled={connectingWeather}
                                                            className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-md"
                                                        >
                                                            <Cloud size={18} />
                                                            {connectingWeather ? 'Connecting…' : 'Connect Farm to Weather · हवामान जोडा'}
                                                        </button>
                                                        <p className="mt-2 text-[11px] text-sky-900/70 text-center px-2">
                                                            We'll use your farm's location to fetch live rainfall, temperature, and a 5-day forecast for your daily log.
                                                        </p>
                                                        {connectError && (
                                                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                                                                {connectError}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // STATE A — no boundary drawn yet
                                        return (
                                            <div className="mt-4 space-y-3">
                                                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 flex items-start gap-2.5">
                                                    <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-red-800">
                                                            Weather pending · हवामान बंद आहे
                                                        </p>
                                                        <p className="text-[11px] text-red-700/90 mt-0.5">
                                                            Without drawing your farm boundary, live weather can't show on your daily log.
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setShowFarmBoundary(true)}
                                                    className="w-full py-3 bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-amber-600 transition-colors shadow-lg"
                                                >
                                                    <MapPin size={18} /> Draw Farm Boundary
                                                </button>
                                                <p className="text-[11px] text-slate-500 text-center">
                                                    Unlocks live weather & activity anchoring for your farm.
                                                </p>
                                            </div>
                                        );
                                    })()}

                                    {/* LOGOUT ACTION */}
                                    <div className="mt-4 pt-4 border-t border-slate-100 flex justify-center">
                                        <button
                                            onClick={logout}
                                            className="text-red-500 font-bold text-sm flex items-center gap-2 px-6 py-3 rounded-xl hover:bg-red-50 transition-colors"
                                        >
                                            <LogOut size={16} /> Log Out
                                        </button>
                                    </div>
                                </div>
                            </div>

                            

                            {/* Phase 5 entitlement banner — only renders for owners with
                                subscription trouble or a trial. Workers never see this. */}
                            {myFarm && (
                                <EntitlementBanner
                                    subscription={myFarm.subscription}
                                    role={myFarm.role}
                                />
                            )}

                            {/* Phase 6: Your memberships list with exit flow.
                                Only renders if the user has farms — zero-farm users
                                already have the FirstFarmWizard open from AppContent. */}
                            {myMemberships.length > 0 && (
                                <MembershipsList
                                    farms={myMemberships}
                                    nonExitableFarmIds={nonExitableFarmIds}
                                    onExit={handleExitMembership}
                                />
                            )}

                            {/* CEI Phase 4 §4.8 — own reliability score (Worker/Mukadam only) */}
                            {isWorkerOnAnyFarm && workerProfile && (
                                <div>
                                    <p
                                        className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-2 px-1"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    >
                                        Your reliability
                                    </p>
                                    <ReliabilityScoreCard
                                        score={workerProfile.reliability}
                                    />
                                </div>
                            )}

                            {/* 2. FARM TEAM HIERARCHY (LAYERS 2 & 3) */}
                            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                            <Users size={20} className="text-emerald-600" />
                                            {t('profile.myFarmTeam')}
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-1">{t('profile.manageAccess')}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleOpenInviteQr}
                                            className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center gap-2"
                                        >
                                            <QrCode size={16} /> Share farm QR
                                        </button>
                                        <button
                                            onClick={() => setShowMemberWizard(true)}
                                            className="bg-white text-slate-900 border border-slate-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all flex items-center gap-2"
                                        >
                                            <Plus size={16} /> {t('profile.addMember')}
                                        </button>
                                    </div>
                                </div>

                                {/* Prominent invite banner — visible when the team is empty so a first-time farmer knows the QR exists. */}
                                {(!profile.operators || profile.operators.length === 0) && (
                                    <button
                                        onClick={handleOpenInviteQr}
                                        className="mb-4 w-full text-left rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-4 shadow-sm hover:border-emerald-300 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                                                <QrCode size={20} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-emerald-800">कामगारांना जोडा · Add your workers</div>
                                                <div className="text-xs text-emerald-700/80">Show them the farm QR. They scan, enter phone, done.</div>
                                            </div>
                                        </div>
                                    </button>
                                )}

                                <div className="space-y-3">
                                    {/* Existing People or Dummies if none */}
                                    {(profile.operators && profile.operators.length > 0) ? (
                                        profile.operators.map(person => {
                                            const canLog = person.capabilities?.includes(OperatorCapability.LOG_DATA);
                                            return (
                                                <div key={person.id} className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:border-emerald-100 transition-all group">

                                                    {/* Avatar */}
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-inner ${person.role === 'SECONDARY_OWNER' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                                        {person.name.charAt(0)}
                                                    </div>

                                                    {/* Info */}
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-bold text-slate-800 text-base truncate">{person.name}</h4>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide border ${person.role === 'SECONDARY_OWNER' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                                                                {person.role === 'SECONDARY_OWNER' ? t('profile.partner') : t('profile.worker')}
                                                            </span>
                                                            {person.phone && <span className="text-[10px] text-slate-400 font-medium">{person.phone}</span>}
                                                        </div>
                                                    </div>

                                                    {/* Toggle Actions */}
                                                    <div className="flex items-center gap-3">
                                                        {/* Allow Log Toggle */}
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newCaps = canLog
                                                                    ? (person.capabilities || []).filter(c => c !== OperatorCapability.LOG_DATA)
                                                                    : [...(person.capabilities || []), OperatorCapability.LOG_DATA];
                                                                const updatedPeople = profile.operators!.map(p => p.id === person.id ? { ...p, capabilities: newCaps } as any : p);
                                                                onUpdateProfile({ ...profile, people: updatedPeople });
                                                            }}
                                                            className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-xl border transition-all select-none ${canLog ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                                                        >
                                                            <span className={`text-[10px] font-bold uppercase ${canLog ? 'text-emerald-700' : 'text-slate-400'}`}>{t('profile.allowLog')}</span>
                                                            <div className={`w-8 h-4 rounded-full relative transition-colors ${canLog ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                                                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${canLog ? 'translate-x-4' : ''}`} />
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onDeletePerson && onDeletePerson(person.id); }}
                                                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                            <div className="w-12 h-12 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-3">
                                                <Users size={24} />
                                            </div>
                                            <p className="text-sm font-bold text-slate-500">{t('profile.noTeamMembers')}</p>
                                            <p className="text-xs text-slate-400">{t('profile.addFamilyOrWorkers')}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>
                    )}



                    {/* PEOPLE (Now integrated into Identity) - REMOVING STANDALONE BLOCK */}

                    {/* 2. CROPS & PLOTS */}
                    {
                        activeTab === 'structure' && (
                            <div className="space-y-4 animate-in fade-in">
                                {/* Add Crop Button */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                                    {!isAddingCrop ? (
                                        <button onClick={() => setIsAddingCrop(true)} className="w-full py-3 border-2 border-dashed border-emerald-300 bg-emerald-50/30 rounded-xl text-emerald-800 font-bold flex items-center justify-center gap-2 hover:bg-emerald-50 transition-all"><Plus size={18} /> {t('profile.addNewCrop')}</button>
                                    ) : (
                                        <div className="space-y-3">
                                            <div>
                                                <input
                                                    placeholder="Crop Name *"
                                                    className={`w-full p-2.5 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 ${cropNameError ? 'border-red-500 bg-red-50' : ''}`}
                                                    value={newCropData.name || ''}
                                                    onChange={e => {
                                                        const nextName = e.target.value;
                                                        setNewCropData({ ...newCropData, name: nextName });
                                                        const normalizedNext = normalizeCropName(nextName);

                                                        if (normalizedNext.length === 0) {
                                                            setCropNameError('');
                                                        } else if (crops.some(c => normalizeCropName(c.name) === normalizedNext)) {
                                                            setCropNameError('This crop already exists. One crop can be added only once.');
                                                        } else if (cropNameError) {
                                                            setCropNameError('');
                                                        }
                                                    }}
                                                />
                                                {cropNameError && (
                                                    <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                                                        <AlertTriangle size={12} /> {cropNameError}
                                                    </p>
                                                )}
                                            </div>
                                            {/* ... icon/color selectors ... */}
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => { setIsAddingCrop(false); setCropNameError(''); setNewCropData({ iconName: 'Sprout' }); }}
                                                    className="flex-1 py-2 text-sm bg-slate-100 text-slate-600 hover:bg-slate-200"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    onClick={handleAddCrop}
                                                    className="flex-1 py-2 text-sm"
                                                    disabled={normalizedNewCropName.length < 2 || isDuplicateCropName}
                                                >
                                                    {t('profile.saveCrop')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {/* Crops List OR Empty State */}
                                {crops && crops.length > 0 ? (
                                    crops.map(crop => (
                                        <div key={crop.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                            <div className="p-4 flex justify-between items-center border-b border-emerald-50 bg-emerald-50/20">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-xl text-white shadow-sm ${crop.color}`}><CropSymbol name={crop.iconName} size="md" /></div>
                                                    <div><h3 className="font-bold text-slate-800">{crop.name}</h3><p className="text-xs text-slate-500">{crop.plots.length} {t('profile.plots')}</p></div>
                                                </div>
                                                
                                            </div>
                                            <div className="p-2">
                                                {(() => {
                                                    const activeSchedule = crop.activeScheduleId ? getScheduleById(crop.activeScheduleId) : null;
                                                    const altCount = Math.max(0, getSchedulesForCrop(crop.name).length - 1);
                                                    return (
                                                        <div className="mx-1 mb-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded bg-white">Active Crop Schedule</p>
                                                                <button 
                                                                    onClick={() => onOpenScheduleLibrary && onOpenScheduleLibrary(crop.id)}
                                                                    className="text-[10px] font-bold text-emerald-600 underline"
                                                                >
                                                                    {activeSchedule ? 'Change Schedule' : 'Browse Library'}
                                                                </button>
                                                            </div>
                                                            {activeSchedule ? (
                                                                <div className="flex items-start gap-3 bg-white p-2.5 rounded-lg border border-emerald-100 shadow-sm cursor-pointer hover:border-emerald-300 transition-colors"
                                                                     onClick={() => onOpenScheduleLibrary && onOpenScheduleLibrary(crop.id)}
                                                                >
                                                                    <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-md mt-0.5">
                                                                        <CalendarDays size={16} />
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs font-bold text-slate-800 leading-tight">{activeSchedule.name}</p>
                                                                        <p className="text-[10px] text-slate-500 mt-1">{activeSchedule.totalDurationDays || '-'} Days {altCount > 0 ? `• ${altCount} Alternatives Available` : ''}</p>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center justify-between bg-orange-50 p-2.5 rounded-lg border border-orange-200" onClick={() => onOpenScheduleLibrary && onOpenScheduleLibrary(crop.id)}>
                                                                    <div className="flex items-center gap-2">
                                                                        <AlertTriangle size={14} className="text-orange-500" />
                                                                        <p className="text-xs font-bold text-orange-700 leading-tight">No schedule selected</p>
                                                                    </div>
                                                                    <button className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-[10px] font-bold shadow-sm transition-colors">
                                                                        Setup Now
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}

                                                {crop.plots.map(p => (
                                                    <div key={p.id} className="p-3 rounded-xl hover:bg-slate-50 group space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <div className="font-bold text-slate-700 flex items-center gap-2">
                                                                    {p.name}
                                                                </div>
                                                                <div className="text-xs text-slate-400 flex items-center gap-2">
                                                                    <span>{p.baseline.totalArea} {p.baseline.unit}</span>
                                                                    {p.infrastructure?.irrigationMethod && <span>• {p.infrastructure.irrigationMethod}</span>}
                                                                    {p.geoData && <span className="flex items-center gap-0.5 text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]"><MapPin size={10} /> {t('profile.mapped')}</span>}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                {p.geoData && (
                                                                    <button
                                                                        onClick={() => setMappingPlotId({ cropId: crop.id, plotId: p.id })}
                                                                        className="p-2 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                                        title="Draw plot boundary"
                                                                    >
                                                                        <MapPin size={16} />
                                                                    </button>
                                                                )}
                                                                <button onClick={() => deletePlot(crop.id, p.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete plot">
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {!p.geoData && (
                                                            <button
                                                                onClick={() => setMappingPlotId({ cropId: crop.id, plotId: p.id })}
                                                                className="w-full py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm"
                                                                title="Draw plot boundary"
                                                            >
                                                                <MapPin size={14} /> Draw plot boundary
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                {/* Add Plot Button - Now Triggers Wizard */}
                                                <div className="p-2 border-t border-slate-100">
                                                    <button
                                                        onClick={() => setWizardCropId(crop.id)}
                                                        className="w-full py-2 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1"
                                                    >
                                                        <Plus size={14} /> {t('profile.addPlot')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    /* Empty state when no crops */
                                    <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Sprout size={32} className="text-slate-300" />
                                        </div>
                                        <h3 className="font-bold text-slate-600 mb-2">No crops yet</h3>
                                        <p className="text-sm text-slate-400 mb-4">
                                            Add your first crop to start tracking your farm activities.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}


                    {/* 3. UTILITIES */}
                    {activeTab === 'utils' && <UtilitiesManager profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 5. MACHINERY */}
                    {activeTab === 'machines' && <MachineryManager profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 7. SOIL & CROP HEALTH */}
                    {activeTab === 'health' && <SoilHealthReportsManager profile={profile} onUpdate={onUpdateProfile} />}

                    {/* 6. INTELLIGENCE */}
                    {activeTab === 'intelligence' && <VocabManager />}

                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
