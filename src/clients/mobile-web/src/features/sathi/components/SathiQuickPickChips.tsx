import React from 'react';
import { Check } from 'lucide-react';

export interface QuickPickOption {
    id: string;
    label: string;
    icon?: React.ReactNode;
}

interface SathiQuickPickChipsProps {
    options: QuickPickOption[];
    selectedIds: string[];
    onToggle: (id: string) => void;
    multiSelect?: boolean;
    layout?: 'grid' | 'flex';
}

const SathiQuickPickChips: React.FC<SathiQuickPickChipsProps> = ({
    options,
    selectedIds,
    onToggle,
    layout = 'flex'
}) => {
    return (
        <div className={layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'flex flex-wrap gap-3'}>
            {options.map((option) => {
                const isSelected = selectedIds.includes(option.id);

                return (
                    <button
                        key={option.id}
                        onClick={() => onToggle(option.id)}
                        className={`
                            relative flex items-center gap-3 px-5 py-3 rounded-2xl border-2 transition-all duration-200 active:scale-95
                            ${isSelected
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-md shadow-emerald-100'
                                : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'
                            }
                            ${layout === 'flex' ? 'flex-1 min-w-[140px]' : 'w-full'}
                        `}
                    >
                        {isSelected && (
                            <div className="absolute top-0 right-0 p-1 bg-emerald-500 rounded-bl-xl text-white">
                                <Check size={12} strokeWidth={4} />
                            </div>
                        )}

                        {option.icon && (
                            <div className={`p-2 rounded-full ${isSelected ? 'bg-white/50 text-emerald-600' : 'bg-stone-100 text-stone-500'}`}>
                                {option.icon}
                            </div>
                        )}

                        <span className={`font-bold text-lg text-left leading-tight ${isSelected ? 'text-emerald-900' : 'text-stone-600'}`}>
                            {option.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default SathiQuickPickChips;
