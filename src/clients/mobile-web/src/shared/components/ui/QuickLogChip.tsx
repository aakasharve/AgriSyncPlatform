import React from 'react';

interface QuickLogChipProps {
    label: string;
    icon?: React.ReactNode;
    category: 'activity' | 'input' | 'labour' | 'irrigation';
    onClick: () => void;
    selected?: boolean;
}

export const QuickLogChip: React.FC<QuickLogChipProps> = ({
    label,
    icon,
    category,
    onClick,
    selected = false
}) => {
    // Category-specific styles (subtle tinting)
    const categoryStyles = {
        activity: { border: 'border-emerald-200', active: 'bg-emerald-100 text-emerald-900', ring: 'ring-emerald-500' },
        input: { border: 'border-amber-200', active: 'bg-amber-100 text-amber-900', ring: 'ring-amber-500' },
        labour: { border: 'border-blue-200', active: 'bg-blue-100 text-blue-900', ring: 'ring-blue-500' },
        irrigation: { border: 'border-cyan-200', active: 'bg-cyan-100 text-cyan-900', ring: 'ring-cyan-500' }
    }[category];

    return (
        <button
            onClick={onClick}
            className={`
        relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-all active:scale-95
        ${selected
                    ? `${categoryStyles.active} ${categoryStyles.border} ring-1 ${categoryStyles.ring}`
                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }
      `}
        >
            {icon && <span className="text-lg opacity-80">{icon}</span>}
            <span className="text-sm font-medium whitespace-nowrap">{label}</span>

            {/* Selection indicator check */}
            {selected && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full shadow-sm flex items-center justify-center border border-gray-100">
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={categoryStyles.active.split(' ')[1]} />
                    </svg>
                </div>
            )}
        </button>
    );
};
