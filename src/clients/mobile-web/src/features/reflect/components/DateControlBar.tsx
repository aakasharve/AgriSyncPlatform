/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { isSameDate } from '../helpers';

interface DateControlBarProps {
    selectedDate: Date;
    onDateChange: (date: Date) => void;
    disabled?: boolean;
}

const DateControlBar: React.FC<DateControlBarProps> = ({
    selectedDate,
    onDateChange,
    disabled
}) => {
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const dayBefore = new Date(); dayBefore.setDate(today.getDate() - 2);
    const inputRef = useRef<HTMLInputElement>(null);
    const presets = [today, yesterday, dayBefore];
    const activeIndex = presets.findIndex(p => isSameDate(p, selectedDate));
    const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.value) onDateChange(new Date(e.target.value));
    };
    const triggerPicker = () => {
        if (inputRef.current) {
            const input = inputRef.current as HTMLInputElement & { showPicker?: () => void };
            try {
                if (typeof input.showPicker === 'function') {
                    input.showPicker();
                } else {
                    input.click();
                }
            } catch {
                input.click();
            }
        }
    };

    return (
        <div className="space-y-3 mb-6">
            <div className="relative group w-full">
                <input
                    ref={inputRef}
                    type="date"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    onChange={handleCustomDateChange}
                    max={getDateKey(today)}
                    value={getDateKey(selectedDate)}
                    disabled={disabled}
                />
                <div
                    onClick={triggerPicker}
                    className={`
                        flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer shadow-sm
                        ${disabled ? 'bg-slate-100 opacity-60' : 'bg-white hover:border-emerald-300 hover:shadow-md border-slate-200'}
                    `}
                >
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl transition-colors ${activeIndex === -1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            <Calendar size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Viewing Activity For</p>
                            <p className="text-lg font-bold text-slate-800 leading-none mt-0.5">
                                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </p>
                        </div>
                    </div>
                    <ChevronDown size={20} className="text-slate-400 group-hover:text-slate-600" />
                </div>
            </div>

            <div className="bg-slate-100 p-1.5 rounded-2xl flex relative shadow-inner overflow-hidden h-14">
                <div
                    className={`absolute top-1.5 bottom-1.5 w-[calc(33.33%-4px)] bg-white rounded-xl shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] z-0`}
                    style={{
                        left: activeIndex === 0 ? '4px' : activeIndex === 1 ? 'calc(33.33% + 2px)' : activeIndex === 2 ? 'calc(66.66%)' : '4px',
                        opacity: activeIndex === -1 ? 0 : 1,
                        transform: activeIndex === -1 ? 'scale(0.95)' : 'scale(1)'
                    }}
                />
                {presets.map((date, idx) => {
                    const isActive = activeIndex === idx;
                    const label = idx === 0 ? "Today" : idx === 1 ? "Yesterday" : date.toLocaleDateString('en-US', { weekday: 'short' });
                    return (
                        <button
                            key={idx}
                            onClick={() => onDateChange(date)}
                            disabled={disabled}
                            className={`flex-1 flex flex-col items-center justify-center relative z-10 transition-colors duration-200 ${isActive ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'
                                }`}
                        >
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-80 leading-none">{label}</span>
                            <span className="text-xs font-bold leading-tight mt-0.5">{date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default DateControlBar;
