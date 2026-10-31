/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "हा खर्च कशासाठी?" in the receipt sheet, in
 * Marathi and in the same words the bill list uses for where a bill goes (`billView.SCOPE_LABEL`). Same
 * three choices and the same `onChange` as before.
 */
import React from 'react';
import { ExpenseScope } from '../../../types';
import { Sprout, MapPin, Warehouse } from 'lucide-react';
import { SCOPE_LABEL } from './billView';
import { cropNameIn } from '../../../shared/names/namesIn';

interface Props {
    value: ExpenseScope;
    onChange: (scope: ExpenseScope) => void;
    plotName?: string;
    cropName?: string;
}

export const ScopeSelectorRadio: React.FC<Props> = ({ value, onChange, plotName, cropName }) => {
    return (
        <div className="space-y-3">
            <div className="text-[14px] font-extrabold text-stone-700">हा खर्च कशासाठी?</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {/* PLOT SCOPE */}
                <button
                    type="button"
                    onClick={() => onChange('PLOT')}
                    aria-pressed={value === 'PLOT'}
                    className={`
                        relative flex min-h-[64px] flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'PLOT'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                            : 'border-gray-200 bg-white text-stone-600 hover:bg-gray-50'}
                    `}
                >
                    <MapPin size={24} className="mb-2" aria-hidden="true" />
                    <span className="font-extrabold text-[15px]">{SCOPE_LABEL.PLOT}</span>
                    {plotName && <span className="text-[13px] font-semibold opacity-80 mt-1">{plotName}</span>}
                    {value === 'PLOT' && <div className="absolute top-2 right-2 w-3 h-3 bg-emerald-500 rounded-full" />}
                </button>

                {/* CROP SCOPE */}
                <button
                    type="button"
                    onClick={() => onChange('CROP')}
                    aria-pressed={value === 'CROP'}
                    className={`
                        relative flex min-h-[64px] flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'CROP'
                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                            : 'border-gray-200 bg-white text-stone-600 hover:bg-gray-50'}
                    `}
                >
                    <Sprout size={24} className="mb-2" aria-hidden="true" />
                    <span className="font-extrabold text-[15px]">{SCOPE_LABEL.CROP}</span>
                    {cropName && <span className="text-[13px] font-semibold opacity-80 mt-1">सर्व {cropNameIn(cropName, 'mr')}</span>}
                    {value === 'CROP' && <div className="absolute top-2 right-2 w-3 h-3 bg-blue-500 rounded-full" />}
                </button>

                {/* FARM SCOPE */}
                <button
                    type="button"
                    onClick={() => onChange('FARM')}
                    aria-pressed={value === 'FARM'}
                    className={`
                        relative flex min-h-[64px] flex-col items-center p-4 rounded-xl border-2 transition-all
                        ${value === 'FARM'
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-gray-200 bg-white text-stone-600 hover:bg-gray-50'}
                    `}
                >
                    <Warehouse size={24} className="mb-2" aria-hidden="true" />
                    <span className="font-extrabold text-[15px]">{SCOPE_LABEL.FARM}</span>
                    <span className="text-[13px] font-semibold opacity-80 mt-1">सामान्य खर्च</span>
                    {value === 'FARM' && <div className="absolute top-2 right-2 w-3 h-3 bg-amber-500 rounded-full" />}
                </button>
            </div>
        </div>
    );
};
