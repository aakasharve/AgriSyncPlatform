/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the frame every पैसे व हिशोब page shares, as in
 * the founder-approved preview (PLR-D9 `FinancePages.tsx`): ONE title bar with ONE "मागे", then the page.
 * The router passes `onBack`; until it does (or on a page opened some other way) the Marathi chip row of
 * the six pages stands in, so a page is never a dead end. Built from the shared look kit — not a new kit.
 */
import React from 'react';
import { AppRoute } from '../../../types';
import { PageBar, SANS } from '../../../shared/components/ui/placeUi';
import { FinanceManagerNav } from './FinanceManagerNav';

interface MoneyPageProps {
    title: string;
    testId: string;
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
    /** The home opens the pages through its own rows, so it never needs the chip row. */
    withNav?: boolean;
    /** lane RATE-1 fix round 1 (F6) — a page that speaks English in English mode names its back button in English too. */
    backLabel?: string;
    children: React.ReactNode;
}

export const MoneyPage: React.FC<MoneyPageProps> = ({ title, testId, currentRoute, onNavigate, onBack, withNav = true, backLabel, children }) => (
    <div className="mx-auto max-w-4xl px-4 pb-24 sm:px-6" style={{ fontFamily: SANS }} data-testid={testId}>
        <PageBar title={title} onBack={onBack} {...(backLabel ? { backLabel } : {})} />
        {withNav && !onBack && <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />}
        <div className="space-y-3">{children}</div>
    </div>
);
