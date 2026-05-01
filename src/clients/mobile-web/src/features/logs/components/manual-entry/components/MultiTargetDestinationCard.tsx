/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check } from 'lucide-react';
import { CropSymbol } from '../../../../context/components/CropSelector';
import { getCropTheme } from '../../../../../shared/utils/colorTheme';
import type { TargetSelectionGroup } from '../types';

const MultiTargetDestinationCard: React.FC<{ groups: TargetSelectionGroup[] }> = ({ groups }) => {
    return (
        <div className="mx-4 mb-4 rounded-[2rem] border border-emerald-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Review Save Target</p>
                    <p className="mt-1 text-sm font-semibold text-stone-700">
                        This log will be stored in each crop below with its selected plots.
                    </p>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                    {groups.reduce((sum, group) => sum + group.plotNames.length, 0)} plots
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {groups.map((group) => {
                    const theme = getCropTheme(group.color);

                    return (
                        <div
                            key={`${group.cropId}-${group.plotNames.join('|')}`}
                            className={`rounded-[1.6rem] border p-1 shadow-lg ${theme.border} ${theme.shadow}`}
                        >
                            <div className={`rounded-[1.4rem] p-4 ${theme.slideBgSelected}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-white/70">
                                            {group.iconName ? <CropSymbol name={group.iconName} size="md" /> : <div className={`h-3 w-3 rounded-full ${group.color}`} />}
                                        </div>
                                        <div>
                                            <p className={`text-base font-black ${theme.text}`}>{group.cropName}</p>
                                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                                                {group.plotNames.length === 1 ? '1 plot selected' : `${group.plotNames.length} plots selected`}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {group.plotNames.map((plotName) => (
                                        <span
                                            key={`${group.cropId}-${plotName}`}
                                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm"
                                        >
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">
                                                <Check size={12} strokeWidth={3} />
                                            </span>
                                            {plotName}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MultiTargetDestinationCard;
