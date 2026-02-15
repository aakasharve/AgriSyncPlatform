/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
    CropProfile,
    HarvestPattern,
    HarvestUnit,
    HarvestConfig
} from '../../../../types';
import {
    X,
    Check,
    ChevronRight,
    Scale,
    Package,
    Hash, // For count
    Calendar,
    ArrowRight
} from 'lucide-react';
import { getSuggestedUnitsForCrop, saveHarvestConfig } from '../../../../services/harvestService';
import Button from '../../../../shared/components/ui/Button';

interface HarvestConfigSheetProps {
    plotId: string;
    crop: CropProfile;
    onClose: () => void;
    onConfigSaved: (config: HarvestConfig) => void;
}

const HarvestConfigSheet: React.FC<HarvestConfigSheetProps> = ({
    plotId,
    crop,
    onClose,
    onConfigSaved
}) => {
    // Steps: 1 = Pattern, 2 = Units, 3 = Confirmation
    const [step, setStep] = useState<number>(1);

    // Form State
    const [pattern, setPattern] = useState<HarvestPattern | null>(null);
    const [primaryUnit, setPrimaryUnit] = useState<HarvestUnit | null>(null);
    const [secondaryUnit, setSecondaryUnit] = useState<HarvestUnit | null>(null);

    // Suggested Data
    const suggestedUnits = getSuggestedUnitsForCrop(crop.name);

    const handleSave = () => {
        if (!pattern || !primaryUnit) return;

        const config: HarvestConfig = {
            plotId,
            pattern,
            configuredAt: new Date().toISOString(),
            primaryUnit,
            secondaryUnit: secondaryUnit || undefined
        };

        saveHarvestConfig(config);
        onConfigSaved(config);
    };

    const renderPatternSelection = () => (
        <div className="space-y-6 animate-in slide-in-from-right fade-in duration-300">
            <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-slate-800">How is {crop.name} harvested?</h3>
                <p className="text-slate-500 text-sm">Select the harvest pattern for this plot's lifecycle.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
                <button
                    onClick={() => setPattern('SINGLE')}
                    className={`
                        relative p-6 rounded-2xl border-2 text-left transition-all
                        ${pattern === 'SINGLE'
                            ? `border-${crop.color?.includes('-') ? crop.color.split('-')[1] : 'emerald'}-500 bg-${crop.color?.includes('-') ? crop.color.split('-')[1] : 'emerald'}-50`
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }
                    `}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <span className="text-2xl mb-2 block">🎯</span>
                            <h4 className="font-bold text-slate-800 mb-1">Single Harvest</h4>
                            <p className="text-sm text-slate-500 leading-relaxed">
                                Entire crop is harvested at once. <br />
                                (e.g. Wheat, Onion, Sugarcane)
                            </p>
                        </div>
                        {pattern === 'SINGLE' && (
                            <div className="bg-emerald-500 text-white p-1 rounded-full">
                                <Check size={16} strokeWidth={3} />
                            </div>
                        )}
                    </div>
                </button>

                <button
                    onClick={() => setPattern('MULTIPLE')}
                    className={`
                        relative p-6 rounded-2xl border-2 text-left transition-all
                        ${pattern === 'MULTIPLE'
                            ? `border-${crop.color?.includes('-') ? crop.color.split('-')[1] : 'emerald'}-500 bg-${crop.color?.includes('-') ? crop.color.split('-')[1] : 'emerald'}-50`
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }
                    `}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <span className="text-2xl mb-2 block">🔄</span>
                            <h4 className="font-bold text-slate-800 mb-1">Multiple Harvests</h4>
                            <p className="text-sm text-slate-500 leading-relaxed">
                                Harvested in multiple pickings over time. <br />
                                (e.g. Tomato, Grapes, Chili)
                            </p>
                        </div>
                        {pattern === 'MULTIPLE' && (
                            <div className="bg-emerald-500 text-white p-1 rounded-full">
                                <Check size={16} strokeWidth={3} />
                            </div>
                        )}
                    </div>
                </button>
            </div>

            <div className="pt-4">
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => setStep(2)}
                    disabled={!pattern}
                    icon={<ArrowRight size={20} />}
                >
                    Continue
                </Button>
            </div>
        </div>
    );

    const renderUnitSelection = () => (
        <div className="space-y-6 animate-in slide-in-from-right fade-in duration-300">
            <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-slate-800">How is it measured?</h3>
                <p className="text-slate-500 text-sm">Select the primary unit for selling.</p>
            </div>

            <div className="space-y-3">
                {suggestedUnits.map((u, idx) => {
                    const isSelected = JSON.stringify(primaryUnit) === JSON.stringify(u);
                    return (
                        <button
                            key={idx}
                            onClick={() => setPrimaryUnit(u)}
                            className={`
                                w-full p-4 rounded-xl border-2 flex items-center justify-between transition-all
                                ${isSelected
                                    ? 'border-emerald-500 bg-emerald-50'
                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                }
                            `}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isSelected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                    {u.type === 'WEIGHT' && <Scale size={20} />}
                                    {u.type === 'CONTAINER' && <Package size={20} />}
                                    {u.type === 'COUNT' && <Hash size={20} />}
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-slate-800">
                                        {u.type === 'WEIGHT' && u.weightUnit}
                                        {u.type === 'CONTAINER' && `${u.containerName} (${u.containerSizeKg}kg)`}
                                        {u.type === 'COUNT' && u.countUnit}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {u.type === 'WEIGHT' && 'Measured by scale at mandi'}
                                        {u.type === 'CONTAINER' && 'Fixed size packaging'}
                                    </div>
                                </div>
                            </div>
                            {isSelected && <Check size={20} className="text-emerald-600" />}
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-3 pt-4">
                <Button variant="secondary" onClick={() => setStep(1)} className="flex-1">
                    Back
                </Button>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={!primaryUnit}
                    className="flex-[2]"
                >
                    Save Configuration
                </Button>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                {/* Header */}
                <div className="sticky top-0 bg-white z-10 p-4 border-b border-slate-100 flex items-center justify-between rounded-t-3xl">
                    <h2 className="font-bold text-lg text-slate-800">Harvest Setup</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="h-1 bg-slate-100 w-full flex">
                    <div className={`h-full bg-emerald-500 transition-all duration-300 ${step === 1 ? 'w-1/2' : 'w-full'}`} />
                </div>

                {/* Content */}
                <div className="p-6">
                    {step === 1 && renderPatternSelection()}
                    {step === 2 && renderUnitSelection()}
                </div>
            </div>
        </div>
    );
};

export default HarvestConfigSheet;
