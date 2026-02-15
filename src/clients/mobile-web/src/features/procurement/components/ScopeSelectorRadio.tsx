
import React from 'react';
import { ExpenseScope } from '../../../types';
import { Sprout, MapPin, Warehouse, HelpCircle } from 'lucide-react';

interface Props {
    value: ExpenseScope;
    onChange: (scope: ExpenseScope) => void;
    plotName?: string;
    cropName?: string;
}

export const ScopeSelectorRadio: React.FC<Props> = ({ value, onChange, plotName, cropName }) => {
    return (
        <div className="space-y-3">
            <div className="text-sm font-bold text-gray-500 uppercase tracking-wider">Expense Applies To:</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {/* PLOT SCOPE */}
                <button
                    onClick={() => onChange('PLOT')}
                    className={`
                        relative flex flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'PLOT'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                            : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}
                    `}
                >
                    <MapPin size={24} className="mb-2" />
                    <span className="font-bold text-sm">Specific Plot</span>
                    {plotName && <span className="text-xs opacity-75 mt-1">{plotName}</span>}
                    {value === 'PLOT' && <div className="absolute top-2 right-2 w-3 h-3 bg-emerald-500 rounded-full" />}
                </button>

                {/* CROP SCOPE */}
                <button
                    onClick={() => onChange('CROP')}
                    className={`
                        relative flex flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'CROP'
                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                            : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}
                    `}
                >
                    <Sprout size={24} className="mb-2" />
                    <span className="font-bold text-sm">Entire Crop</span>
                    {cropName && <span className="text-xs opacity-75 mt-1">All {cropName}</span>}
                    {value === 'CROP' && <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full" />}
                </button>

                {/* FARM SCOPE */}
                <button
                    onClick={() => onChange('FARM')}
                    className={`
                        relative flex flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'FARM'
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}
                    `}
                >
                    <Warehouse size={24} className="mb-2" />
                    <span className="font-bold text-sm">General Farm</span>
                    <span className="text-xs opacity-75 mt-1">Overhead</span>
                    {value === 'FARM' && <div className="absolute top-2 right-2 w-3 h-3 bg-amber-500 rounded-full" />}
                </button>
            </div>
        </div>
    );
};
