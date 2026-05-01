/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Utilities (Water & Power) tab section.
 *
 * Extracted verbatim from `pages/ProfilePage.tsx`'s UtilitiesManager. The
 * WaterSourceWizard component lives at `../components/WaterSourceWizard.tsx`.
 */

import React, { useState } from 'react';
import {
    Plus, Trash2, MapPin, Settings2, Droplets,
    ChevronRight, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { FarmerProfile, WaterResource, FarmMotor } from '../../../types';
import ElectricityTimingConfigurator from '../components/ElectricityTimingConfigurator';
import WaterSourceWizard from '../components/WaterSourceWizard';

interface UtilitiesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

const UtilitiesSection: React.FC<UtilitiesSectionProps> = ({ profile, onUpdate }) => {
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

export default UtilitiesSection;
