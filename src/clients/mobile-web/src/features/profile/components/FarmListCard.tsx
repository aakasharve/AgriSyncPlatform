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
import { tenureLabel, farmCodeLabel, type Tenure } from './farmLabels';

export interface FarmListCardProps {
    farm: MyFarmDto;
    tenure?: Tenure;
    onOpen: (farmId: string) => void;
    language: 'mr' | 'en';
}

const FarmListCard: React.FC<FarmListCardProps> = ({ farm, tenure = 'owned', onOpen, language }) => {
    const t = tenureLabel(tenure);
    const code = farmCodeLabel(farm.farmCode, language);
    const isOwned = tenure === 'owned';
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
                {/* Tenure chip + farm code wrap onto a meta line so the farm
                    name keeps the whole first row on a narrow phone. */}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`rounded-lg px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-tight ${isOwned ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-700'}`}>
                        {language === 'mr' ? t.mr : t.en}
                    </span>
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
