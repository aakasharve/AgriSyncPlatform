/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — the running-cost card of the old log
 * screen (commit c95afa1c: "खर्च: <what it covers>" with आज / काल / आतापर्यंत), RE-HOMED on the work
 * home. Same numbers, same scope label, from the same `costSnapshot` the router derives — nothing is computed here.
 *
 * Lane UI-6 (founder D-150, note 1.2: the money "seems non noticeable"; the approved picture H1): drawn as a FULL-WIDTH DARK
 * card - stone-900, a 44 px amber circle with the rupee at left, the small label "खर्च — <what it covers> · आजपर्यंत", the
 * running total big in amber-300, and one small line "आज … · काल …" with the real figures. Who sees it is unchanged (the caller
 * hands in `cost` only to a person who may see the farm's money). It has no tap: the old card had none, so no chevron is drawn
 * (a chevron would promise a place to open that nobody has wired).
 *
 * Doctrine P4: a total of 0 is "nothing recorded" on this card, so it shows "—", never "₹ 0".
 */
import React from 'react';
import { IndianRupee } from 'lucide-react';
import { SANS } from '../../../../shared/components/ui/placeUi';
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

/** "खर्च — संपूर्ण शेत · आजपर्यंत"; a card with no scope name says "खर्च · आजपर्यंत". */
const labelOf = (scopeLabel: string | undefined): string => {
    const scope = (scopeLabel ?? '').trim();
    return `${COST_WORDS.title}${scope ? ` — ${scope}` : ''} · ${COST_WORDS.untilToday}`;
};

export const RunningCostCard: React.FC<{ cost: RunningCost }> = ({ cost }) => (
    <section data-testid="running-cost-card" style={{ fontFamily: SANS }}
        className="flex w-full items-center gap-3 rounded-[18px] bg-stone-900 px-3.5 py-3 text-white shadow-[0_6px_16px_rgba(28,25,23,0.3)]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-500 text-stone-900"><IndianRupee size={22} strokeWidth={2.4} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
            <p data-testid="running-cost-scope" className="m-0 text-[11.5px] font-semibold leading-snug text-stone-200">{labelOf(cost.scopeLabel)}</p>
            <p data-testid="running-cost-so-far" className="m-0 text-[26px] font-extrabold leading-[1.1] text-amber-300">{money(cost.soFar)}</p>
            <p className="m-0 text-[11.5px] font-semibold leading-snug text-stone-200" data-testid="running-cost-recent">
                {COST_WORDS.today} <span data-testid="running-cost-today">{money(cost.today)}</span>
                {' · '}
                {COST_WORDS.yesterday} <span data-testid="running-cost-yesterday">{money(cost.yesterday)}</span>
            </p>
        </div>
    </section>
);

export default RunningCostCard;
