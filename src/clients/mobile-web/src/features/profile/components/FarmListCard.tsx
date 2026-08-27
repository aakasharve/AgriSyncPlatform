/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One farm as a soft rounded card in the Profile's "Your Farms" list.
 * A farm is ONE holding; the code shown on it is the join code the farm
 * issues, NOT the 7/12 land record (see farmLabels.farmCodeLabel).
 * Presentational only — receives its farm + a tenure hint and reports taps
 * upward. Matches the approved mockup.
 */
import React from 'react';
import { Sprout, Hash, ChevronRight } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { farmCodeLabel, type Tenure } from './farmLabels';

export interface FarmListCardProps {
    farm: MyFarmDto;
    tenure?: Tenure;
    onOpen: (farmId: string) => void;
    language: 'mr' | 'en';
}

const FarmListCard: React.FC<FarmListCardProps> = ({ farm, onOpen, language }) => {
    const code = farmCodeLabel(farm.farmCode, language);
    return (
        <button
            type="button"
            onClick={() => onOpen(farm.farmId)}
            className="group flex w-full items-center gap-3 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-all active:scale-[0.985] hover:border-emerald-200/70 hover:shadow-[0_8px_18px_-10px_rgba(20,40,30,0.18)]"
        >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-emerald-50 text-emerald-600">
                <Sprout size={20} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-bold text-slate-800">{farm.name}</span>
                {/* The tenure chip is GONE (truth audit T1.12b, finding 5).
                    It rendered "मालकीची" / "Owned" on every card from a
                    hardcoded `tenure = 'owned'` default — nothing in the app
                    ever asked the farmer, and `farmLabels.ts:5-6` states
                    tenure is "UI-only (no persistence)". A claim about who
                    owns a man's land, with no data behind it, is the same
                    defect as the "७/१२" label this release already removed —
                    it sat one line below it on this very card. `P4`/`P5`.
                    `tenureLabel` is kept in farmLabels.ts for when tenure is
                    actually captured; the `tenure` prop stays on the type so
                    re-wiring is a one-line change. */}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {code && (
                        <span className="flex items-center gap-1 text-[10.5px] text-slate-400">
                            <Hash size={12} /> {code}
                        </span>
                    )}
                </span>
            </span>
            <ChevronRight size={18} className="flex-shrink-0 self-center text-slate-300 transition-transform group-active:translate-x-0.5" />
        </button>
    );
};

export default FarmListCard;
