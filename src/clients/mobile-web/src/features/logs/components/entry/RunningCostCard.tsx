/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the running-cost card of the old log
 * screen (commit c95afa1c: "खर्च: <what it covers>" with आज / काल / आतापर्यंत), RE-HOMED on the work
 * home and drawn in the app's light glass look instead of the dark legacy card. Same numbers, same
 * scope label, from the same `costSnapshot` the router derives — nothing is computed here.
 *
 * Doctrine P4: a total of 0 is "nothing recorded" on this card, so it shows "—", never "₹ 0".
 */
import React from 'react';
import { IndianRupee } from 'lucide-react';
import { GlassCard, IconDot, SANS } from '../../../../shared/components/ui/placeUi';
import { formatCurrencyINR } from '../../../../shared/utils/dayState';
import { COST_WORDS } from './entryWords';

export interface RunningCost {
    today: number;
    yesterday: number;
    soFar: number;
    /** What the three figures cover: a plot's name, a crop's name, or "संपूर्ण शेत". */
    scopeLabel?: string;
}

const money = (value: number): string => (Number.isFinite(value) && value !== 0 ? `₹ ${formatCurrencyINR(value)}` : COST_WORDS.none);

export const RunningCostCard: React.FC<{ cost: RunningCost }> = ({ cost }) => (
    <GlassCard testId="running-cost-card" className="space-y-2">
        <div className="flex items-center gap-2.5" style={{ fontFamily: SANS }}>
            <IconDot tone="amber" size={36}><IndianRupee size={18} aria-hidden="true" /></IconDot>
            <p data-testid="running-cost-scope" className="m-0 min-w-0 flex-1 truncate text-[16px] font-extrabold text-stone-800">
                {COST_WORDS.scope} {cost.scopeLabel ?? ''}
            </p>
        </div>
        <div className="grid grid-cols-3 gap-2" style={{ fontFamily: SANS }}>
            {([
                ['today', COST_WORDS.today, cost.today],
                ['yesterday', COST_WORDS.yesterday, cost.yesterday],
                ['so-far', COST_WORDS.soFar, cost.soFar],
            ] as const).map(([key, label, value]) => (
                <div key={key} className="rounded-2xl bg-white/80 px-2 py-1.5 ring-1 ring-stone-200">
                    <p className="m-0 text-[13px] font-bold text-stone-600">{label}</p>
                    <p className="m-0 text-[17px] font-black text-stone-900" data-testid={`running-cost-${key}`}>{money(value)}</p>
                </div>
            ))}
        </div>
    </GlassCard>
);

export default RunningCostCard;
