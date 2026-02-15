import React, { useMemo } from 'react';
import { DailyLog } from '../../../types';
import { DEMO_SEED_VERSION } from '../../demo/DemoDataService';
import { ScrollText, Calendar, CloudLightning, Layers, TrendingUp, AlertCircle } from 'lucide-react';

interface DemoLedgerProps {
    mockHistory: DailyLog[];
}

const DemoLedger: React.FC<DemoLedgerProps> = ({ mockHistory }) => {
    const stats = useMemo(() => {
        if (!mockHistory.length) return null;

        const totalLogs = mockHistory.length;
        const start = mockHistory[mockHistory.length - 1].date;
        const end = mockHistory[0].date;

        const disturbances = mockHistory.filter(l => l.disturbance).length;
        const multiPlotLogs = mockHistory.filter(l => l.context.selection[0].selectedPlotIds.length > 1).length;
        const heavyWorkDays = mockHistory.filter(l => l.cropActivities && l.cropActivities.length > 2).length;
        const totalExpenses = mockHistory.reduce((s, l) => s + (l.financialSummary?.grandTotal || 0), 0);
        const uniqueCrops = new Set(mockHistory.map(l => l.context.selection[0].cropId)).size;

        return {
            totalLogs,
            start,
            end,
            disturbances,
            multiPlotLogs,
            heavyWorkDays,
            totalExpenses,
            uniqueCrops
        };
    }, [mockHistory]);

    if (!stats) return null;

    return (
        <div className="bg-slate-50 rounded-xl border border-slate-200 mt-4 overflow-hidden">
            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2 text-slate-700">
                    <ScrollText size={16} />
                    <span className="font-bold text-xs uppercase tracking-wider">Demo Data Ledger</span>
                </div>
                <span className="text-[10px] font-mono bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                    {DEMO_SEED_VERSION}
                </span>
            </div>

            <div className="p-4 grid grid-cols-2 gap-4">
                <div className="col-span-2 flex items-center gap-3 text-slate-600 mb-2">
                    <Calendar size={16} className="text-emerald-500" />
                    <span className="text-sm font-medium">
                        {new Date(stats.start).toLocaleDateString()} — {new Date(stats.end).toLocaleDateString()}
                    </span>
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">30 Days</span>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                    <div className="text-xs text-slate-400 font-bold uppercase mb-1">Total Volume</div>
                    <div className="text-xl font-bold text-slate-800">{stats.totalLogs} <span className="text-sm font-normal text-slate-400">logs</span></div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                    <div className="text-xs text-slate-400 font-bold uppercase mb-1">Financial Flow</div>
                    <div className="text-xl font-bold text-slate-800">₹{(stats.totalExpenses / 1000).toFixed(1)}k</div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm col-span-2">
                    <div className="text-xs text-slate-400 font-bold uppercase mb-2">Scenario Coverage</div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                            <CloudLightning size={14} className="text-amber-500" />
                            <span>{stats.disturbances} Disturbance Events</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Layers size={14} className="text-blue-500" />
                            <span>{stats.multiPlotLogs} Multi-Plot Logs</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                            <TrendingUp size={14} className="text-purple-500" />
                            <span>{stats.heavyWorkDays} Heavy Workload Days</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                            <AlertCircle size={14} className="text-rose-500" />
                            <span>{stats.uniqueCrops} Active Crops</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 text-[10px] text-slate-500 text-center">
                Data generated deterministically using seed based on date.
            </div>
        </div>
    );
};

export default DemoLedger;
