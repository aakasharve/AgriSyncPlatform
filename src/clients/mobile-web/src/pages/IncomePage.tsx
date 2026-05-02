
import React, { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Plus } from 'lucide-react';
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import { CropProfile } from '../types';
import OfflineEmptyState from '../shared/components/ui/OfflineEmptyState';

interface Props {
    crops: CropProfile[];
}

const IncomePage: React.FC<Props> = ({ crops = [] }) => {
    const [selectedCropId, setSelectedCropId] = useState<string>(crops[0]?.id || '');
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);

    useEffect(() => {
        const crop = crops.find(c => c.id === selectedCropId);
        if (crop && crop.plots.length > 0) {
            setSelectedPlotIds([crop.plots[0].id]);
        } else {
            setSelectedPlotIds([]);
        }
    }, [selectedCropId, crops]);

    const activePlotId = selectedPlotIds[0];
    const activeCrop = crops.find(c => c.id === selectedCropId);

    if (!crops || crops.length === 0) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
                <OfflineEmptyState
                    icon={<TrendingUp size={40} className="text-slate-300" />}
                    title="No Income Recorded"
                    message="Add crops and record harvest sales to track your farm income."
                />
            </div>
        );
    }

    // --- REPLICATING SCHEDULER PAGE LAYOUT (Standard Flow) ---
    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6 py-6 font-sans">
            {/* STATIC HEADER */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-stone-800 tracking-tight">Income</h1>
                    <p className="text-sm text-stone-500 font-medium">Track sales & harvest revenue</p>
                </div>
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shadow-md border border-emerald-200">
                    <TrendingUp size={24} />
                </div>
            </div>

            {/* SELECTOR */}
            <div className="mb-8">
                <SlidingCropSelector
                    crops={crops}
                    selectedCropId={selectedCropId}
                    selectedPlotIds={selectedPlotIds}
                    onCropSelect={setSelectedCropId}
                    onPlotSelect={(id) => setSelectedPlotIds([id])}
                    mode="single"
                />
            </div>

            {/* CONTENT */}
            <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-500 text-white p-5 rounded-2xl shadow-lg shadow-emerald-200">
                        <div className="opacity-80 text-xs font-bold uppercase tracking-wider mb-2">Total Revenue</div>
                        <div className="text-3xl font-black tracking-tight">₹0</div>
                        {activePlotId && <div className="text-[10px] opacity-70 mt-2 font-medium">for selected plot</div>}
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
                        <div className="text-stone-400 text-xs font-bold uppercase tracking-wider mb-2">Expected</div>
                        <div className="text-3xl font-black text-stone-300 tracking-tight">--</div>
                    </div>
                </div>

                {/* Empty State */}
                <div className="bg-white border-2 border-dashed border-stone-200 rounded-3xl p-10 flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
                        <DollarSign size={40} className="text-stone-300" />
                    </div>
                    <h3 className="text-xl font-bold text-stone-400 mb-2">No Income Records</h3>
                    <p className="text-sm text-stone-400 max-w-[240px] mb-8 leading-relaxed">
                        {activePlotId
                            ? `Record harvest sales for ${activeCrop?.plots.find(p => p.id === activePlotId)?.name}`
                            : 'Select a plot to view records'}
                    </p>

                    <button className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold text-sm shadow-xl shadow-emerald-200 flex items-center gap-2 active:scale-95 transition-all hover:bg-emerald-700">
                        <Plus size={18} /> Add Income Record
                    </button>
                </div>
            </div>
        </div>
    );
};

export default IncomePage;
