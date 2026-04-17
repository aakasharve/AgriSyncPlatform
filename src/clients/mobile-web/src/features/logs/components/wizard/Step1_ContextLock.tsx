import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { CropProfile, FarmerProfile } from '../../../../types';
import Button from '../../../../shared/components/ui/Button';
import SathiCard from '../../../sathi/components/SathiCard';
import SathiQuickPickChips from '../../../sathi/components/SathiQuickPickChips';
import type { WizardLogContext, WizardLogSelection } from '../../services/logSubmissionService';

interface Step1Props {
    profile: FarmerProfile;
    crops: CropProfile[];
    onNext: (data: WizardLogContext) => void;
}

const Step1_ContextLock: React.FC<Step1Props> = ({ profile, crops, onNext }) => {
    const [selectedOperatorId, setSelectedOperatorId] = useState<string>(
        profile.activeOperatorId || (profile.operators[0]?.id || '')
    );
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
    const [expandedCropIds, setExpandedCropIds] = useState<string[]>(() => crops.map(crop => crop.id));

    const selections = useMemo<WizardLogSelection[]>(() => {
        return crops.flatMap(crop =>
            crop.plots
                .filter(plot => selectedPlotIds.includes(plot.id))
                .map(plot => ({
                    cropId: crop.id,
                    cropName: crop.name,
                    plotId: plot.id,
                    plotName: plot.name,
                    cropCycleId: crop.id,
                }))
        );
    }, [crops, selectedPlotIds]);

    const selectedSummary = useMemo(() => {
        if (selections.length === 0) return 'Choose at least one plot';
        if (selections.length === 1) return `${selections[0].plotName} ready`;
        return `${selections.length} plots selected`;
    }, [selections]);

    const toggleCropSection = (cropId: string) => {
        setExpandedCropIds(prev =>
            prev.includes(cropId)
                ? prev.filter(id => id !== cropId)
                : [...prev, cropId]
        );
    };

    const togglePlotSelection = (plotId: string) => {
        setSelectedPlotIds(prev =>
            prev.includes(plotId)
                ? prev.filter(id => id !== plotId)
                : [...prev, plotId]
        );
    };

    const toggleSelectAllForCrop = (crop: CropProfile) => {
        const cropPlotIds = crop.plots.map(plot => plot.id);
        const allSelected = cropPlotIds.every(plotId => selectedPlotIds.includes(plotId));

        setSelectedPlotIds(prev => {
            if (allSelected) {
                return prev.filter(plotId => !cropPlotIds.includes(plotId));
            }

            return Array.from(new Set([...prev, ...cropPlotIds]));
        });
    };

    const handleContinue = () => {
        if (!selectedOperatorId || selections.length === 0) {
            return;
        }

        onNext({
            operatorId: selectedOperatorId,
            selections,
        });
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <SathiCard
                message="Choose the worker and every plot you are logging now."
                subMessage="Select all plots that received the same work. Log once, save to all."
                variant="neutral"
            />

            <div className="space-y-2">
                <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider px-1">Who is logging?</h3>
                <SathiQuickPickChips
                    options={profile.operators.map(op => ({
                        id: op.id,
                        label: op.name,
                        icon: <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-xs font-bold">{op.name[0]}</div>
                    }))}
                    selectedIds={[selectedOperatorId]}
                    onToggle={(id) => setSelectedOperatorId(id)}
                    layout="flex"
                />
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-4">
                    <div>
                        <p className="text-sm font-black uppercase tracking-[0.18em] text-stone-500">Where did this happen?</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-700">{selectedSummary}</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                        {selections.length} selected
                    </div>
                </div>

                {selections.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-b border-stone-100 px-4 py-3">
                        {selections.map(selection => (
                            <span
                                key={selection.plotId}
                                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"
                            >
                                <CheckCircle2 size={14} />
                                {selection.cropName} • {selection.plotName}
                            </span>
                        ))}
                    </div>
                )}

                <div className="space-y-4 p-4">
                    {crops.map(crop => {
                        const cropPlotIds = crop.plots.map(plot => plot.id);
                        const selectedCount = cropPlotIds.filter(plotId => selectedPlotIds.includes(plotId)).length;
                        const isExpanded = expandedCropIds.includes(crop.id);

                        return (
                            <div key={crop.id} className="rounded-2xl border border-stone-200 bg-stone-50/70">
                                <div className="flex items-center justify-between gap-3 px-4 py-3">
                                    <button
                                        type="button"
                                        onClick={() => toggleCropSection(crop.id)}
                                        className="flex flex-1 items-center gap-3 text-left"
                                    >
                                        <span className={`h-4 w-4 rounded-full ${crop.color}`} />
                                        <div className="flex-1">
                                            <p className="text-base font-bold text-stone-900">{crop.name}</p>
                                            <p className="text-xs font-semibold text-stone-500">
                                                {selectedCount} of {crop.plots.length} plots selected
                                            </p>
                                        </div>
                                        {isExpanded ? <ChevronDown size={18} className="text-stone-500" /> : <ChevronRight size={18} className="text-stone-500" />}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => toggleSelectAllForCrop(crop)}
                                        className={`rounded-full px-3 py-2 text-xs font-bold transition-colors ${
                                            selectedCount === crop.plots.length && crop.plots.length > 0
                                                ? 'bg-emerald-600 text-white'
                                                : 'border border-stone-200 bg-white text-stone-700'
                                        }`}
                                    >
                                        {selectedCount === crop.plots.length && crop.plots.length > 0 ? 'Clear all' : 'Select all'}
                                    </button>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-stone-200 p-4">
                                        <SathiQuickPickChips
                                            options={crop.plots.map(plot => ({
                                                id: plot.id,
                                                label: plot.name,
                                            }))}
                                            selectedIds={selectedPlotIds}
                                            onToggle={togglePlotSelection}
                                            layout="grid"
                                            multiSelect
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="pt-2">
                <Button
                    variant="secondary"
                    onClick={handleContinue}
                    disabled={!selectedOperatorId || selections.length === 0}
                    className="w-full py-4"
                >
                    Continue with {selections.length === 0 ? 'selected plots' : selections.length === 1 ? '1 plot' : `${selections.length} plots`}
                </Button>
            </div>
        </div>
    );
};

export default Step1_ContextLock;
