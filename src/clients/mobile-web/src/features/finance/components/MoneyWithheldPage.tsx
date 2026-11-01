/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a; founder D-22 "work access ≠ money access", doctrine P4) — what a पैसे व हिशोब
 * page shows to a seat the SERVER does not send the farm's money to: one honest line and a way back. Never
 * an empty book that reads as ₹0. One language at a time; both lines are PROPOSED.
 */
import React from 'react';
import { GlassCard, PageBar } from '../../../shared/components/ui/placeUi';

const COPY = {
    mr: {
        title: 'पैसे व हिशोब',
        line: 'या शेताचा पैशांचा हिशोब तुम्हाला दाखवला जात नाही.', // PROPOSED (Marathi)
        back: 'मागे',
    },
    en: {
        title: 'Money and accounts', // PROPOSED (English)
        line: "This farm's money is not shown to you.", // PROPOSED (English)
        back: 'Back', // PROPOSED (English)
    },
} as const;

export const MoneyWithheldPage: React.FC<{ onBack: () => void; language?: string | null }> = ({ onBack, language }) => {
    const copy = language === 'en' ? COPY.en : COPY.mr;
    return (
        <div className="px-4 pb-24" data-testid="money-withheld-page">
            <PageBar title={copy.title} onBack={onBack} backLabel={copy.back} />
            <GlassCard testId="money-withheld">
                <p className="m-0 text-[16px] font-bold text-stone-700">{copy.line}</p>
            </GlassCard>
        </div>
    );
};
