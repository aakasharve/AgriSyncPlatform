/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Structure (Crops & Plots) tab section.
 *
 * Extracted verbatim from `pages/ProfilePage.tsx`'s `activeTab === 'structure'`
 * branch. The 9569047 smoke snapshot test renders this tab — the rendered HTML
 * MUST match byte-for-byte.
 *
 * State (isAddingCrop, newCropData, cropNameError) remains owned by the
 * orchestrator and is passed in as props.
 */

import React from 'react';
import {
    Plus, Trash2, MapPin, Sprout,
    CalendarDays, AlertTriangle
} from 'lucide-react';
import { CropProfile } from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { CropSymbol } from '../../context/components/CropSelector';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../../../infrastructure/reference/TemplateCatalog';
import { useLanguage } from '../../../i18n/LanguageContext';

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

const StructureSection: React.FC<StructureSectionProps> = ({
    crops,
    isAddingCrop,
    setIsAddingCrop,
    newCropData,
    setNewCropData,
    cropNameError,
    setCropNameError,
    normalizeCropName,
    normalizedNewCropName,
    isDuplicateCropName,
    handleAddCrop,
    setMappingPlotId,
    deletePlot,
    setWizardCropId,
    onOpenScheduleLibrary,
}) => {
    const { t } = useLanguage();
    return (
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
    );
};

export default StructureSection;
