import React from 'react';
import { getVarietiesForCrop } from '../data/varietyCatalog';

interface VarietySelectorProps {
    cropName: string;
    value: string;
    onChange: (variety: string) => void;
    error?: string;
}

export const VarietySelector: React.FC<VarietySelectorProps> = ({ cropName, value, onChange, error }) => {
    const varieties = getVarietiesForCrop(cropName);
    const isCustom = !varieties.includes(value) && value !== '';

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {varieties.map(v => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onChange(v === 'Other' ? '' : v)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                            value === v || (v === 'Other' && isCustom)
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                        }`}
                    >
                        {v}
                    </button>
                ))}
            </div>
            
            {(value === 'Other' || isCustom) && (
                <input
                    type="text"
                    placeholder="Enter variety name"
                    value={value === 'Other' ? '' : value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`w-full p-3 border rounded-xl font-bold outline-none focus:border-emerald-500 mt-2 ${
                        error ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                />
            )}
            
            {error && (
                <p className="text-red-500 text-xs mt-1">{error}</p>
            )}
        </div>
    );
};
