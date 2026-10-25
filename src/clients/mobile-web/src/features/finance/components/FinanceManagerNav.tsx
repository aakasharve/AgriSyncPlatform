/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the six पैसे व हिशोब pages as big Marathi chips
 * (they were English: "Home · Ledger · Price Book · Review Inbox · Reports · Finance Settings"). The home
 * itself opens the pages through its own rows; a page shows this row only while it has no "मागे" to go
 * home by (see `MoneyPage`), so no page is ever a dead end.
 */
import React from 'react';
import { AppRoute } from '../../../types';
import { Tap } from '../../../shared/components/ui/placeUi';
import { FINANCE_TITLE, type FinanceRoute } from '../moneyLabels';

interface FinanceManagerNavProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const LINKS = Object.keys(FINANCE_TITLE) as FinanceRoute[];

export const FinanceManagerNav: React.FC<FinanceManagerNavProps> = ({ currentRoute, onNavigate }) => {
    return (
        <nav aria-label={FINANCE_TITLE['finance-manager']} className="-mx-1 mb-3 overflow-x-auto px-1 pb-1" data-testid="finance-nav">
            <div className="flex gap-1.5">
                {LINKS.map(route => (
                    <Tap
                        key={route}
                        onClick={() => onNavigate(route)}
                        aria-current={currentRoute === route ? 'page' : undefined}
                        data-testid={`finance-nav-${route}`}
                        className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-3.5 text-[14.5px] font-extrabold ${
                            currentRoute === route ? 'bg-emerald-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'
                        }`}
                    >
                        {FINANCE_TITLE[route]}
                    </Tap>
                ))}
            </div>
        </nav>
    );
};
