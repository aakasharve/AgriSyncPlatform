import React, { useState } from 'react';
import { FarmerProfile, CropProfile } from '../../../../types';
import SathiCard from '../../../sathi/components/SathiCard';
import SathiQuickPickChips from '../../../sathi/components/SathiQuickPickChips';

interface Step1Props {
    profile: FarmerProfile;
    crops: CropProfile[];
    onNext: (data: { operatorId: string; plotId: string; cropId: string }) => void;
}

const Step1_ContextLock: React.FC<Step1Props> = ({ profile, crops, onNext }) => {
    // Default to active operator or first operator
    const [selectedOperatorId, setSelectedOperatorId] = useState<string>(
        profile.activeOperatorId || (profile.operators[0]?.id || '')
    );

    // Flatten plots for selection
    const allPlots = crops.flatMap(c => c.plots.map(p => ({
        id: p.id,
        label: `${p.name} (${c.name})`,
        cropId: c.id
    })));

    const [selectedPlotId, setSelectedPlotId] = useState<string>('');

    const handlePlotSelect = (plotId: string) => {
        setSelectedPlotId(plotId);
        const plot = allPlots.find(p => p.id === plotId);
        if (plot && selectedOperatorId) {
            // Auto-advance if both selected? Or wait for explicit "Next"?
            // UX Rule: "Context Lock" -> "I am here doing this".
            // Let's allow quick tap to advance.
            setTimeout(() => {
                onNext({
                    operatorId: selectedOperatorId,
                    plotId: plotId,
                    cropId: plot.cropId
                });
            }, 500); // Slight delay for visual feedback
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
            {/* Greeting */}
            <SathiCard
                message="Namaste! Let's log your work."
                subMessage="Who is working, and where?"
                variant="neutral"
            />

            {/* Operator Selection */}
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

            {/* Plot Selection */}
            <div className="space-y-2">
                <h3 className="text-sm font-bold text-stone-500 uppercase tracking-wider px-1">Which Plot?</h3>
                <SathiQuickPickChips
                    options={allPlots.map(p => ({
                        id: p.id,
                        label: p.label
                    }))}
                    selectedIds={[selectedPlotId]}
                    onToggle={handlePlotSelect}
                    layout="grid" // Grid for plots
                />
            </div>
        </div>
    );
};

export default Step1_ContextLock;
