/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — a tappable amount, now `₹ 1,250` the Indian way
 * (it read "Rs 1,250"). Same props and the same tap; only the text changed.
 */
import React from 'react';
import { rupees } from '../moneyLabels';

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
            {rupees(amount)}
        </button>
    );
};
