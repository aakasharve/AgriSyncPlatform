import React from 'react';
import { CropProfile } from '../../../../../types';
import SlidingCropSelector from '../../../../context/components/SlidingCropSelector';
import { Calendar, MapPin } from 'lucide-react';
import { getCropTheme } from '../../../../../shared/utils/colorTheme';

interface Step1Props {
    crops: CropProfile[];
    selectedCropId: string;
    selectedPlotId: string;
    plantationDate: string;
    onUpdate: (field: string, value: unknown) => void;
}

const Step1_CropSelection: React.FC<Step1Props> = ({ crops, selectedCropId, selectedPlotId, plantationDate, onUpdate }) => {

    const activeCrop = crops.find(c => c.id === selectedCropId);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            {/* 1. Crop Selection */}
            <div>
                <h3 className="text-lg font-bold text-stone-700 mb-4 px-2">Select Crop Profile</h3>
                <SlidingCropSelector
                    crops={crops}
                    selectedCropId={selectedCropId}
                    onSelect={(id) => {
                        onUpdate('cropId', id);
                        // Reset plot on crop change
                        onUpdate('plotId', '');
                    }}
                />
            </div>

            {/* 2. Plot Selection */}
            {activeCrop && activeCrop.plots.length > 0 && (
                <div className="animate-in fade-in">
                    <h3 className="text-lg font-bold text-stone-700 mb-4 px-2">Select Plot Target</h3>
                    <div className={
                        activeCrop.plots.length > 6
                            ? "grid grid-cols-4 gap-3 px-2 w-full"
                            : activeCrop.plots.length > 4
                                ? "grid grid-cols-2 gap-4 px-2 w-full"
                                : "flex flex-wrap gap-4 px-2 w-full"
                    }>
                        {activeCrop.plots.map((plot) => {
                            const isSelected = selectedPlotId === plot.id;
                            const isCompact = activeCrop.plots.length > 6;

                            const theme = getCropTheme(activeCrop.color);

                            return (
                                <button
                                    key={plot.id}
                                    onClick={() => onUpdate('plotId', plot.id)}
                                    className={`
                                        ${isCompact
                                            ? 'flex flex-col items-center justify-center p-3 aspect-square text-center gap-2'
                                            : 'flex items-center gap-3 px-6 py-4 text-left'
                                        }
                                        rounded-2xl border-2 transition-all w-full
                                        ${isSelected
                                            ? `${theme.border} ${theme.bg} ${theme.text} shadow-lg ${theme.shadow}`
                                            : 'border-stone-100 bg-white text-stone-500 hover:border-stone-200'
                                        }
                                    `}
                                >
                                    <div className={`
                                        rounded-full 
                                        ${isCompact ? 'p-1.5' : 'p-2'}
                                        ${isSelected ? `${theme.iconBg} ${theme.iconText}` : 'bg-stone-100 text-stone-400'}
                                    `}>
                                        <MapPin size={isCompact ? 16 : 20} />
                                    </div>
                                    <div className={isCompact ? 'w-full overflow-hidden' : ''}>
                                        <div className={`font-bold ${isCompact ? 'text-xs truncate' : 'text-sm'}`}>
                                            {plot.name}
                                        </div>
                                        {!isCompact && (
                                            <div className="text-[10px] uppercase font-bold text-stone-400">
                                                {plot.baseline?.totalArea ? `${plot.baseline.totalArea} ${plot.baseline?.unit || 'Acres'}` : 'No Area Defined'}
                                            </div>
                                        )}
                                    </div>
                                    {!isCompact && isSelected && <div className={`ml-2 w-3 h-3 rounded-full ${theme.indicator}`} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 3. Plantation Date */}
            {selectedPlotId && (
                <div className="animate-in fade-in slide-in-from-bottom-4 px-2">
                    <h3 className="text-lg font-bold text-stone-700 mb-4">Confirm Plantation Date (Day 1)</h3>
                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 inline-flex items-center gap-4">
                        <div className="p-3 bg-white rounded-xl shadow-sm text-stone-400">
                            <Calendar size={24} />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase font-bold text-stone-400 block mb-1">Day 1 Starts On</label>
                            <input
                                type="date"
                                value={plantationDate}
                                onChange={(e) => onUpdate('plantationDate', e.target.value)}
                                className="bg-transparent font-bold text-stone-800 text-lg outline-none cursor-pointer"
                            />
                        </div>
                    </div>
                    <p className="mt-3 text-xs text-stone-400 max-w-md">
                        This date marks the official start of the crop cycle (Day 1). Land preparation days will be counted backwards from here (Day -1, -2, etc.).
                    </p>
                </div>
            )}
        </div>
    );
};

export default Step1_CropSelection;
