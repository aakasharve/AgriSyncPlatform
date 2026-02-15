import React from 'react';
import { AppRoute } from '../../../types';

interface FinanceManagerNavProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const LINKS: Array<{ route: AppRoute; label: string }> = [
    { route: 'finance-manager', label: 'Home' },
    { route: 'finance-ledger', label: 'Ledger' },
    { route: 'finance-price-book', label: 'Price Book' },
    { route: 'finance-review-inbox', label: 'Review Inbox' },
    { route: 'finance-reports', label: 'Reports' },
    { route: 'finance-settings', label: 'Finance Settings' }
];

export const FinanceManagerNav: React.FC<FinanceManagerNavProps> = ({ currentRoute, onNavigate }) => {
    return (
        <div className="mb-4 overflow-x-auto">
            <div className="flex gap-2">
                {LINKS.map(link => (
                    <button
                        key={link.route}
                        onClick={() => onNavigate(link.route)}
                        className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${
                            currentRoute === link.route
                                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-white text-slate-600'
                        }`}
                    >
                        {link.label}
                    </button>
                ))}
            </div>
        </div>
    );
};
