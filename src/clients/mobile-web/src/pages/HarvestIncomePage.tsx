/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
    FarmContext,
    CropProfile
} from '../types';
import { OtherIncomeEntry } from '../features/logs/harvest.types';
import { getOtherIncomeEntries } from '../services/harvestService';
import HarvestComingSoon from '../features/logs/components/harvest/HarvestComingSoon';
import { useLanguage } from '../i18n/LanguageContext';
import OtherIncomeSheet from '../features/logs/components/harvest/OtherIncomeSheet';

interface HarvestIncomePageProps {
    context: FarmContext | null;
    crops: CropProfile[];
    onBack: () => void;
}

/**
 * Route: 'income'. Reached from BottomNavigation's "Income" tab and from
 * ReflectPage's "In Hand Income" tile.
 *
 * Task 6 (spec D4): the harvest sale/session/config tracking that used to
 * live on this page had no backend at all, and its save handler wrote to
 * React state only — a recorded sale vanished the moment the farmer
 * navigated away. That whole flow (config, "Log New Harvest", patti upload,
 * grade-wise sale entry, pending-sale/payment banner, session history) is
 * replaced below with `HarvestComingSoon`, an honest "not built yet"
 * message. See that component's doc comment for the full trace.
 *
 * "Other Income" (scrap, subsidies, rent…) is untouched — `addOtherIncomeEntry`
 * genuinely persists and enqueues a real finance mutation, and D4 lists
 * "Income" as fixed-and-shipping, separate from "Harvest".
 */
const HarvestIncomePage: React.FC<HarvestIncomePageProps> = ({ crops }) => {
    // The harvest notice is the one thing on this page a farmer must be
    // able to READ — it is what tells him a sale recorded here is not
    // saved. The app defaults to Marathi (`i18n/LanguageContext.tsx`), so
    // the notice has to be handed the same preference every other surface
    // reads. The rest of this page is still English-only copy; that is a
    // separate, wider gap and is not silently claimed as fixed here.
    const { language } = useLanguage();
    const [showOtherIncomeSheet, setShowOtherIncomeSheet] = useState(false);
    const [reloadOtherIncomeCounter, setReloadOtherIncomeCounter] = useState(0);
    const [otherIncome, setOtherIncome] = useState<OtherIncomeEntry[]>([]);

    useEffect(() => {
        setOtherIncome(getOtherIncomeEntries());
    }, [reloadOtherIncomeCounter]);

    return (
        <div className="min-h-screen bg-slate-50 pb-24">
            <div className="p-4 space-y-6 pt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Hero Title */}
                <div className="flex flex-col gap-1 px-1">
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">Income</h1>
                    <p className="text-slate-500 font-medium">Track what your farm earns</p>
                </div>

                {/* HARVEST — coming soon (spec D4, Task 6) */}
                <div className="glass-panel rounded-3xl border border-slate-100 overflow-hidden">
                    <div className="px-5 pt-5">
                        <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs">Harvest</h3>
                    </div>
                    <HarvestComingSoon language={language} />
                </div>

                {/* OTHER INCOME SECTION — unaffected by Task 6; keeps working */}
                <div className="pt-2 border-t border-slate-200/60">
                    <div className="flex items-center justify-between mb-4 px-1 pt-6">
                        <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs">Other Income</h3>
                        <button
                            onClick={() => setShowOtherIncomeSheet(true)}
                            className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 active:scale-95 transition-all"
                        >
                            + Add Custom
                        </button>
                    </div>

                    {otherIncome.length === 0 ? (
                        <div className="text-center p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                            <p className="text-xs font-bold text-slate-400">Scrap, Subsidies, Rent...</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {otherIncome.map(inc => (
                                <div key={inc.id} className="bg-white/60 p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center font-bold text-sm shadow-sm">
                                            {inc.source[0]}
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-700">{inc.description}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{new Date(inc.date).toLocaleDateString()} • {inc.source}</p>
                                        </div>
                                    </div>
                                    <span className="font-black text-emerald-600">+₹{inc.amount.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {showOtherIncomeSheet && (
                <OtherIncomeSheet
                    crops={crops}
                    onClose={() => setShowOtherIncomeSheet(false)}
                    onSave={() => {
                        setReloadOtherIncomeCounter(prev => prev + 1);
                        setShowOtherIncomeSheet(false);
                    }}
                />
            )}
        </div>
    );
};

export default HarvestIncomePage;
