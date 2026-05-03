import React, { useState } from 'react';
import { AppRoute } from '../../types';
import { financeService } from './financeService';
import { FinanceManagerNav } from './components/FinanceManagerNav';

interface FinanceSettingsPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const FinanceSettingsPage: React.FC<FinanceSettingsPageProps> = ({ currentRoute, onNavigate }) => {
    const current = financeService.getSettings();
    const [threshold, setThreshold] = useState(String(current.highAmountThreshold));
    const [windowMinutes, setWindowMinutes] = useState(String(current.duplicateWindowMinutes));
    const [gstEnabled, setGstEnabled] = useState(current.gstEnabled);

    const save = () => {
        financeService.saveSettings({
            highAmountThreshold: Number(threshold) || current.highAmountThreshold,
            duplicateWindowMinutes: Number(windowMinutes) || current.duplicateWindowMinutes,
            gstEnabled
        });
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
            <h1 className="text-2xl font-black font-display text-stone-800">Finance Settings</h1>
            <p className="text-sm text-stone-500 mb-6">Switches only. Prices live in Price Book.</p>
            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            <div className="glass-panel p-6">
                <label className="block text-xs font-bold uppercase tracking-wide text-stone-400 mb-1.5">High amount review threshold</label>
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 font-bold">₹</span>
                    <input
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        type="number"
                        className="w-full rounded-xl border-transparent bg-surface-100 pl-7 pr-3 py-3 text-sm font-bold text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                    />
                </div>

                <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-stone-400 mb-1.5">Duplicate time window (minutes)</label>
                <input
                    value={windowMinutes}
                    onChange={(e) => setWindowMinutes(e.target.value)}
                    type="number"
                    className="w-full rounded-xl border-transparent bg-surface-100 px-3 py-3 text-sm font-bold text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                />

                <label className="mt-6 flex items-center gap-3 p-3 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer select-none">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${gstEnabled ? 'bg-emerald-500 border-emerald-500' : 'border-stone-300 bg-white'}`}>
                        {gstEnabled && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <input type="checkbox" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} className="hidden" />
                    <span className="text-sm font-semibold text-stone-700">Enable GST (later)</span>
                </label>

                <button
                    onClick={save}
                    className="mt-6 w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-stone-900/20 active:scale-[0.98] transition-all hover:bg-stone-800"
                >
                    Save Finance Settings
                </button>
            </div>
        </div>
    );
};

export default FinanceSettingsPage;
