
import React from 'react';
import { ExpenseSummaryByScope } from '../../../types';
import { TrendingUp, Sprout, Warehouse } from 'lucide-react';

interface Props {
    summary: ExpenseSummaryByScope;
}

export const ExpenseSummaryCards: React.FC<Props> = ({ summary }) => {
    const totalFarm = summary.farmExpenses.total;
    const totalCrop = summary.cropExpenses.reduce((sum, c) => sum + c.total, 0);
    const totalPlot = summary.plotExpenses.reduce((sum, p) => sum + p.total, 0);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Plot Expenses</span>
                    <div className="p-1.5 bg-emerald-50 rounded-lg text-emerald-600">
                        <TrendingUp size={16} />
                    </div>
                </div>
                <div className="text-2xl font-black text-gray-900">₹{totalPlot.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">{summary.plotExpenses.length} plots tracked</div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Crop Common</span>
                    <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                        <Sprout size={16} />
                    </div>
                </div>
                <div className="text-2xl font-black text-gray-900">₹{totalCrop.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">Shared crop inputs</div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Farm General</span>
                    <div className="p-1.5 bg-amber-50 rounded-lg text-amber-600">
                        <Warehouse size={16} />
                    </div>
                </div>
                <div className="text-2xl font-black text-gray-900">₹{totalFarm.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">Overhead & Misc</div>
            </div>
        </div>
    );
};
