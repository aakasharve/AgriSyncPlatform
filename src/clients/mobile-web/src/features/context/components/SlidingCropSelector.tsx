
import React, { useRef, useEffect } from 'react';
import { CropProfile } from '../../../types';
import { getCropTheme } from '../../../shared/utils/colorTheme';
import { CropSymbol } from './CropSelector'; // Reuse symbol logic
import { Check, MapPin } from 'lucide-react';

interface SlidingCropSelectorProps {
    crops: CropProfile[];
    selectedCropId: string | null;
    onSelect?: (cropId: string) => void;
    // New Props for "Standardized" usage
    onCropSelect?: (cropId: string) => void;
    selectedPlotIds?: string[];
    onPlotSelect?: (plotId: string) => void;
    mode?: 'single' | 'multi';
}

const SlidingCropSelector: React.FC<SlidingCropSelectorProps> = ({
    crops,
    selectedCropId,
    onSelect,
    onCropSelect,
    selectedPlotIds,
    onPlotSelect,
    mode = 'single'
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    // Unify handler with Toggle support
    const handleCropClick = (id: string) => {
        // If clicking the already selected crop, deselect it
        if (selectedCropId === id) {
            if (onCropSelect) onCropSelect(''); // Or null? The types say string. Let's assume empty string clears.
            if (onSelect) onSelect('');
            return;
        }

        if (onCropSelect) onCropSelect(id);
        if (onSelect) onSelect(id);
    };

    // Auto-scroll to selected item on mount or change
    useEffect(() => {
        if (selectedCropId && itemRefs.current[selectedCropId] && scrollContainerRef.current) {
            itemRefs.current[selectedCropId]?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
        }
    }, [selectedCropId]);

    // Handle initial selection if none
    // REMOVED: Auto-selection on mount caused "sticky" behavior where you couldn't have an empty state.
    // The user wants clear deselection.
    /*
    useEffect(() => {
        if (!selectedCropId && crops.length > 0) {
            handleCropClick(crops[0].id);
        }
    }, []);
    */

    // Derived active crop for plots
    const activeCrop = crops.find(c => c.id === selectedCropId);

    return (
        <div className="w-full space-y-6">
            {/* Scroll Container */}
            <div
                ref={scrollContainerRef}
                className="flex overflow-x-auto snap-x snap-mandatory px-[calc(50%-5rem)] py-8 gap-6 no-scrollbar items-center pb-12" // Increased gap and padding
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {crops.map((crop) => {
                    const isSelected = selectedCropId === crop.id;
                    const theme = getCropTheme(crop.color);

                    return (
                        <button
                            key={crop.id}
                            ref={el => { itemRefs.current[crop.id] = el; }}
                            onClick={() => handleCropClick(crop.id)}
                            className={`
                                snap-center shrink-0 relative transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col items-center pt-4 pb-8
                                ${isSelected
                                    ? `w-44 h-56 bg-white shadow-2xl scale-110 border-[3px] ${theme.border} z-20`
                                    : 'w-36 h-48 bg-slate-50 border border-slate-200 scale-90 opacity-60 hover:opacity-100 hover:scale-95 hover:bg-white'
                                }
                                rounded-[2.5rem]
                            `}
                        >
                            {/* Image Container (Circular with unified CropSymbol) */}
                            <div className={`
                                relative w-24 h-24 rounded-full overflow-hidden shadow-sm flex items-center justify-center bg-white mb-3
                                transition-all duration-500
                                ${isSelected ? 'scale-110 shadow-lg ring-4 ring-white' : 'scale-100 grayscale brightness-95'}
                            `}>
                                {/* Use unified CropSymbol which handles Image mapping (.jpg/.png) and Fallbacks */}
                                <div className="scale-[1.25]"> {/* Increased scale slightly for better fill */}
                                    <CropSymbol name={crop.iconName || crop.name} size="xl" />
                                </div>
                            </div>

                            {/* Text Info */}
                            <div className={`text-center px-2 flex-1 flex flex-col justify-between w-full transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-70'}`}>
                                <h3 className={`font-black text-lg leading-tight text-slate-800 mb-1`}>
                                    {crop.name}
                                </h3>

                                {/* Selected Count Pill - Only visible if active? Or always? Keeping always for context but dim */}
                                <div className={`
                                    mx-auto text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-full transition-colors
                                    ${isSelected ? `${theme.iconBg} ${theme.iconText}` : 'bg-slate-100/50 text-slate-300'}
                                `}>
                                    {crop.plots.length} Selected
                                </div>
                            </div>

                            {/* Active Indicator (Bottom Check Circle) - Only when selected */}
                            {isSelected && (
                                <div className={`
                                    absolute -bottom-5 left-1/2 -translate-x-1/2 
                                    w-12 h-12 rounded-full flex items-center justify-center 
                                    shadow-xl border-4 border-white ${theme.indicator} text-white
                                    animate-in zoom-in spin-in-45 duration-300
                                `}>
                                    <Check size={20} strokeWidth={4} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Pagination Dots */}
            <div className="flex justify-center gap-2">
                {crops.map(c => (
                    <div
                        key={c.id}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${selectedCropId === c.id ? 'bg-emerald-400' : 'bg-stone-200'}`}
                    />
                ))}
            </div>

            {/* Optional: Plot List (Standardized) */}
            {activeCrop && activeCrop.plots.length > 0 && selectedPlotIds && onPlotSelect && (
                <div className="mb-4 px-4 pt-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-wrap justify-center gap-3">
                        {activeCrop.plots.map((plot) => {
                            const isSelected = selectedPlotIds.includes(plot.id);
                            return (
                                <button
                                    key={plot.id}
                                    onClick={() => onPlotSelect(plot.id)}
                                    className={`
                                        flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all
                                        ${isSelected
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm scale-105 ring-2 ring-emerald-100'
                                            : 'bg-white border border-stone-200 text-stone-500 hover:bg-stone-50'
                                        }
                                    `}
                                >
                                    <MapPin size={14} className={isSelected ? 'text-emerald-500' : 'text-stone-300'} />
                                    {plot.name}
                                    {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SlidingCropSelector;
