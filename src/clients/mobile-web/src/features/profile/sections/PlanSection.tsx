/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Irrigation Plan tab section.
 *
 * Extracted verbatim from `pages/ProfilePage.tsx`'s IrrigationPlanner. The
 * 'plan' tab is currently commented out in the orchestrator's sidebar (the
 * tab item is hidden); this file is kept so future re-enablement is a
 * one-line wiring change instead of a re-extraction.
 */

import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
    CropProfile, FarmMotor, IrrigationPlan, IrrigationFrequency, IrrigationTimeWindow
} from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { useLanguage } from '../../../i18n/LanguageContext';

interface PlanSectionProps {
    crops: CropProfile[];
    motors: FarmMotor[];
    onUpdateCrops: (c: CropProfile[]) => void;
}

const PlanSection: React.FC<PlanSectionProps> = ({ crops, motors, onUpdateCrops }) => {
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

export default PlanSection;
