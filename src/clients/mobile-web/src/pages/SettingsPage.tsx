import React, { useState } from 'react';
import { useAppNavigationState } from '../app/context/AppFeatureContexts';
import { Settings, Droplets, Users, Tractor, BookOpen, FlaskConical, Bot, Plus, Trash2, Coins, Leaf, Check, Pencil, ChevronDown, ChevronUp, Globe, Shield, MapPin, Mic, Camera } from 'lucide-react';
import { LedgerDefaults, LabourShift, DailyLog, CropProfile, HarvestConfig } from '../types';
import { getHarvestConfig } from '../services/harvestService';
import NotificationTestComponent from '../shared/components/NotificationTestComponent';
import HarvestConfigSheet from '../features/logs/components/harvest/HarvestConfigSheet';
import { CropSymbol } from '../features/context/components/CropSelector';
import { useLanguage } from '../i18n/LanguageContext';
import { Language } from '../i18n/translations';
import { idGenerator } from '../core/domain/services/IdGenerator';

interface SettingsPageProps {
    defaults: LedgerDefaults;
    onUpdateDefaults: (defaults: LedgerDefaults) => void;
    crops: CropProfile[];
}

const SettingsPage: React.FC<SettingsPageProps> = ({
    defaults,
    onUpdateDefaults,
    crops
}) => {
    const { setCurrentRoute } = useAppNavigationState();
    const { t, language, setLanguage } = useLanguage();

    // Harvest Configuration state
    const [harvestConfigExpanded, setHarvestConfigExpanded] = useState(false);
    const [editingPlotId, setEditingPlotId] = useState<string | null>(null);
    const [editingCrop, setEditingCrop] = useState<CropProfile | null>(null);
    const [configRefreshKey, setConfigRefreshKey] = useState(0);

    const handleDefaultChange = (category: keyof LedgerDefaults, field: string, value: any) => {
        onUpdateDefaults({
            ...defaults,
            [category]: {
                ...defaults[category],
                [field]: value
            }
        });
    };

    const addShift = () => {
        const newShift: LabourShift = {
            id: `shift_${idGenerator.generate()}`,
            name: 'New Shift',
            defaultRateMale: 300,
            defaultRateFemale: 200
        };
        const newShifts = [...(defaults.labour.shifts || []), newShift];
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    const updateShift = (id: string, field: keyof LabourShift, value: any) => {
        const newShifts = defaults.labour.shifts.map(s => s.id === id ? { ...s, [field]: value } : s);
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    const deleteShift = (id: string) => {
        const newShifts = defaults.labour.shifts.filter(s => s.id !== id);
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    const getConfigLabel = (config: HarvestConfig): string => {
        const pattern = config.pattern;
        const unit = config.primaryUnit;
        let unitLabel = '';
        if (unit.type === 'WEIGHT') {
            unitLabel = unit.weightUnit || 'KG';
        } else if (unit.type === 'CONTAINER') {
            unitLabel = `${unit.containerName || 'Container'}${unit.containerSizeKg ? ` (${unit.containerSizeKg}kg)` : ''}`;
        } else if (unit.type === 'COUNT') {
            unitLabel = unit.countUnit || 'Count';
        }
        return `${pattern} / ${unitLabel}`;
    };

    const languages: { code: Language; label: string; native: string }[] = [
        { code: 'en', label: 'English', native: 'English' },
        { code: 'mr', label: 'Marathi', native: 'मराठी' },
    ];

    return (
        <div className="space-y-6 pb-24">

            <h3 className="text-xl font-display font-black text-stone-800 px-1">{t('settings.general')}</h3>

            {/* 0. Language Selector */}
            <div className="glass-panel p-5">
                <div className="flex items-center gap-4 mb-5">
                    <div className="p-3 rounded-2xl bg-sky-100 text-sky-600 shadow-sm">
                        <Globe size={24} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h3 className="font-bold text-stone-800 text-lg">{t('settings.language')}</h3>
                        <p className="text-xs text-stone-500 font-medium mt-0.5">{t('settings.selectLanguage')}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    {languages.map((lang) => (
                        <button
                            key={lang.code}
                            onClick={() => setLanguage(lang.code)}
                            className={`flex-1 py-3 px-4 rounded-xl border-2 font-bold transition-all duration-200 active:scale-95 ${language === lang.code
                                ? 'bg-primary-container border-primary text-emerald-800 shadow-sm'
                                : 'bg-surface-100 border-transparent text-stone-500 hover:bg-white hover:border-stone-200'
                                }`}
                        >
                            <div className="text-lg mb-1">{lang.native}</div>
                            <div className="text-xs opacity-70 font-medium uppercase tracking-wide">{lang.label}</div>
                        </button>
                    ))}
                </div>
            </div>



            
            {/* App Permissions */}
            <div className="pt-4">
                <h3 className="text-xl font-display font-black text-stone-800 px-1">App Configuration</h3>
            </div>
            
            <div className="glass-panel p-5 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4 text-stone-700">
                        <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-700 shadow-sm"><Shield size={22} strokeWidth={2.5} /></div>
                        <div>
                            <h4 className="font-bold text-lg">App Permissions</h4>
                            <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                                Manage Camera, Mic, and Location access.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-stone-50 rounded-xl p-4 border border-stone-100 flex items-center justify-between">
                    <div className="flex gap-4">
                        <div className="flex flex-col items-center gap-1">
                            <MapPin size={16} className="text-emerald-600" />
                            <span className="text-[10px] font-bold text-stone-400">GPS</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <Mic size={16} className="text-emerald-600" />
                            <span className="text-[10px] font-bold text-stone-400">MIC</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <Camera size={16} className="text-emerald-600" />
                            <span className="text-[10px] font-bold text-stone-400">CAM</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => alert('Please manage site permissions in your browser settings (usually near the URL bar).')}
                        className="text-xs font-bold text-emerald-700 bg-emerald-100 px-4 py-2 rounded-lg hover:bg-emerald-200 transition-colors"
                    >
                        Browser Settings
                    </button>
                </div>
            </div>

<div className="pt-4">
                <h3 className="text-xl font-display font-black text-stone-800 px-1">{t('settings.ledgerConfig')}</h3>
            </div>

            <div className="glass-panel p-5">
                <div className="flex items-center gap-4 text-stone-700">
                    <div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm"><Coins size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h4 className="font-bold text-lg">Pricing moved to Finance Manager</h4>
                        <p className="text-xs text-stone-500 mt-1 leading-relaxed max-w-[280px]">
                            Configure wages, rates, and item prices from <span className="font-bold text-stone-700">Profile → Finance Manager → Price Book</span>.
                        </p>
                    </div>
                </div>
            </div>

            {/* 4. Harvest Configuration */}
            <div className="glass-panel p-0 overflow-hidden">
                <button
                    onClick={() => setHarvestConfigExpanded(!harvestConfigExpanded)}
                    className="w-full p-5 flex items-center justify-between text-left hover:bg-stone-50/50 transition-colors"
                >
                    <div className="flex items-center gap-4 text-stone-700">
                        <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-700 shadow-sm"><Leaf size={22} strokeWidth={2.5} /></div>
                        <div>
                            <h4 className="font-bold text-lg">{t('settings.harvestConfig')}</h4>
                            <p className="text-xs text-stone-400 font-medium mt-0.5">{t('settings.harvestDescription')}</p>
                        </div>
                    </div>
                    <div className={`transition-transform duration-300 ${harvestConfigExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDown size={20} className="text-stone-400" />
                    </div>
                </button>

                {harvestConfigExpanded && (
                    <div className="px-5 pb-5 space-y-5 animate-slide-up">
                        {crops.length === 0 ? (
                            <p className="text-sm text-stone-400 text-center py-4">{t('settings.noCrops')}</p>
                        ) : (
                            crops.map(crop => (
                                <div key={crop.id}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <CropSymbol name={crop.iconName} size="sm" />
                                        <span className="text-sm font-bold text-stone-700">{crop.name}</span>
                                    </div>

                                    {crop.plots.length === 0 ? (
                                        <p className="text-xs text-stone-400 ml-5">{t('profile.noPlots')}</p>
                                    ) : (
                                        <div className="border border-stone-100 rounded-xl overflow-hidden ml-5 bg-surface-100/50">
                                            {crop.plots.map((plot, idx) => {
                                                const plotConfig = getHarvestConfig(plot.id);
                                                return (
                                                    <div
                                                        key={plot.id}
                                                        className={`flex items-center justify-between p-3.5 ${idx > 0 ? 'border-t border-stone-100' : ''}`}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <span className="text-sm font-medium text-stone-700 truncate">{plot.name}</span>
                                                            {plotConfig ? (
                                                                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200/50 whitespace-nowrap">
                                                                    <Check size={10} strokeWidth={3} />
                                                                    {getConfigLabel(plotConfig)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-bold text-stone-400 bg-stone-100 px-2 py-1 rounded-md border border-stone-200 whitespace-nowrap">
                                                                    {t('settings.notConfigured')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                setEditingPlotId(plot.id);
                                                                setEditingCrop(crop);
                                                            }}
                                                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 flex items-center gap-1.5 shrink-0 ml-2 ${plotConfig
                                                                ? 'text-stone-500 bg-white shadow-sm border border-stone-200 hover:text-stone-800'
                                                                : 'text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-200'
                                                                }`}
                                                        >
                                                            {plotConfig ? <><Pencil size={12} /> {t('confirmation.edit')}</> : t('settings.setup')}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* HarvestConfigSheet modal for settings editing */}
            {editingPlotId && editingCrop && (
                <HarvestConfigSheet
                    plotId={editingPlotId}
                    crop={editingCrop}
                    onClose={() => {
                        setEditingPlotId(null);
                        setEditingCrop(null);
                    }}
                    onConfigSaved={() => {
                        setConfigRefreshKey(prev => prev + 1);
                        setEditingPlotId(null);
                        setEditingCrop(null);
                    }}
                />
            )}

            {/* Notification Tester */}
            <NotificationTestComponent />

            
            {/* Manage Crops Data */}
            <div className="pt-4">
                <h3 className="text-xl font-display font-black text-stone-800 px-1">Manage Farm Data</h3>
            </div>
            <div className="glass-panel p-5 mb-6">
                <h4 className="font-bold text-lg text-stone-800 mb-2">Delete Crop Data</h4>
                <p className="text-xs text-stone-500 mb-4">Warning: This action is irreversible. All plots and logs related to the crop will be lost.</p>
                <div className="space-y-2">
                    {crops.map(crop => (
                        <div key={crop.id} className="flex items-center justify-between border border-stone-100 rounded-xl p-3 bg-stone-50">
                            <span className="font-bold text-sm text-stone-700">{crop.name}</span>
                            <button className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
                                <Trash2 size={14} /> Delete
                            </button>
                        </div>
                    ))}
                    {crops.length === 0 && <p className="text-xs text-stone-400 italic">No crops available</p>}
                </div>
            </div>

            {/* Developer Tools */}
            <div className="glass-panel p-5 mt-6">
                <h3 className="font-bold text-stone-800 text-lg mb-4">Developer Tools</h3>
                <div className="space-y-2">
                    <button
                        onClick={() => setCurrentRoute('test-e2e')}
                        className="w-full py-3 px-4 bg-stone-100 text-stone-700 font-bold rounded-xl hover:bg-stone-200 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                    >
                        <FlaskConical size={20} />
                        Open End-to-End Test Page
                    </button>
                    <button
                        onClick={() => setCurrentRoute('ai-admin')}
                        className="w-full py-3 px-4 bg-emerald-100 text-emerald-800 font-bold rounded-xl hover:bg-emerald-200 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                    >
                        <Bot size={20} />
                        Open AI Operations (Admin)
                    </button>
                </div>
            </div>

        </div>
    );
};

export default SettingsPage;
