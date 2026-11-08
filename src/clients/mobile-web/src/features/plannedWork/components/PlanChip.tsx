/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2) - the preview's tap chip (`postVoiceResult/PlanWork.tsx`), shared by the
 * form's questions. 44 px high, a tick when chosen.
 */
import React from 'react';
import { Check } from 'lucide-react';

export const PlanChip: React.FC<{
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
    testId?: string;
    tone?: 'blue' | 'amber';
}> = ({ on, onClick, children, testId, tone = 'blue' }) => (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId}
        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-3.5 text-[15px] font-extrabold active:scale-95 ${on
            ? tone === 'amber' ? 'border-amber-600 bg-amber-500 text-white' : 'border-[#1448E6] bg-[#1448E6] text-white'
            : 'border-stone-300 bg-white text-stone-800'}`}>
        {on && <Check size={16} strokeWidth={4} aria-hidden="true" />}{children}
    </button>
);

export const PlanQuestion: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
    <div className="mb-1.5">
        <h4 className="m-0 text-[17px] font-extrabold text-stone-900">{children}</h4>
        {hint && <p className="m-0 text-[12px] font-semibold text-stone-600">{hint}</p>}
    </div>
);
