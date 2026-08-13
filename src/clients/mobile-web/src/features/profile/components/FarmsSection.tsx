/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Your Farms" block on the Profile menu. Farms are one-per-7/12 holdings,
 * visually separated, sorted by name, and grouped under a light family
 * header (grouping is UI-only — no data merge). Presentational.
 */
import React from 'react';
import { Layers, Plus } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import FarmListCard from './FarmListCard';

export interface FarmsSectionProps {
    farms: MyFarmDto[];
    familyName?: string;
    onOpenFarm: (farmId: string) => void;
    onAddFarm?: () => void;
    language: 'mr' | 'en';
}

const FarmsSection: React.FC<FarmsSectionProps> = ({ farms, familyName, onOpenFarm, onAddFarm, language }) => {
    const sorted = [...farms].sort((a, b) => a.name.localeCompare(b.name, 'mr'));
    return (
        <div className="mt-4">
            {familyName && (
                <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Layers size={15} /></span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-700">{familyName}</span>
                    <span className="shrink-0 text-[10.5px] text-slate-400">{sorted.length} {language === 'mr' ? 'शेती' : 'farms'}</span>
                </div>
            )}
            <div className={`flex flex-col gap-2.5 ${familyName ? 'ml-3.5 border-l-2 border-dashed border-violet-100 pl-2.5' : ''}`}>
                {sorted.map(farm => (
                    <FarmListCard key={farm.farmId} farm={farm} onOpen={onOpenFarm} language={language} />
                ))}
                {onAddFarm && (
                    <button
                        type="button"
                        onClick={onAddFarm}
                        className="flex items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3.5 text-left transition-all active:scale-[0.985]"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white"><Plus size={18} /></span>
                        <span className="text-[13.5px] font-bold text-emerald-800">{language === 'mr' ? 'शेत जोडा · Add a farm' : 'Add a farm'}</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default FarmsSection;
