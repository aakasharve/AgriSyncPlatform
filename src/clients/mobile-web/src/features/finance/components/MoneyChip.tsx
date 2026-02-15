import React from 'react';

interface MoneyChipProps {
    amount: number;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    className?: string;
}

export const MoneyChip: React.FC<MoneyChipProps> = ({ amount, onClick, className = '' }) => {
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 ${className}`}
        >
            Rs {Math.round(amount).toLocaleString('en-IN')}
        </button>
    );
};
