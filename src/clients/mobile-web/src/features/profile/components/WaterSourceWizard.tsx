/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted verbatim from `pages/ProfilePage.tsx`.
 * 2-step wizard for adding a water source + its motors. Used only by
 * UtilitiesSection.
 */

import React, { useState } from 'react';
import {
    Plus, Trash2, X, ArrowRight, Save, Droplets, AlertTriangle
} from 'lucide-react';
import {
    FarmerProfile, WaterResource, FarmMotor
} from '../../../types';
import Button from '../../../shared/components/ui/Button';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

interface WaterSourceWizardProps {
    profile: FarmerProfile;
    onSave: (source: WaterResource, motors: FarmMotor[]) => void;
    onCancel: () => void;
}

const WaterSourceWizard: React.FC<WaterSourceWizardProps> = ({ profile, onSave, onCancel }) => {
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

export default WaterSourceWizard;
