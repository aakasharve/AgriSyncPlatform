import React, { useMemo, useState } from 'react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { FinanceManagerNav } from '../features/finance/components/FinanceManagerNav';
import { FinanceFilters } from '../features/finance/finance.types';
import { TrendingUp, TrendingDown, Calendar, Filter, PieChart, Info } from 'lucide-react';
import OfflineEmptyState from '../shared/components/ui/OfflineEmptyState';
import { useFarmContext } from '../core/session/FarmContext';

interface ReportsPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

type TimeRange = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'ALL_TIME';

const ReportsPage: React.FC<ReportsPageProps> = ({ currentRoute, onNavigate }) => {
    const [timeRange, setTimeRange] = useState<TimeRange>('THIS_MONTH');
    const { currentFarm } = useFarmContext();
    const canSeeServiceProof = currentFarm?.role === 'Agronomist' ||
        currentFarm?.role === 'Consultant' ||
        currentFarm?.role === 'PrimaryOwner';

    // Filter Logic
    const filters = useMemo((): FinanceFilters => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
        const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

        switch (timeRange) {
            case 'THIS_MONTH': return { fromDate: startOfMonth };
            case 'LAST_MONTH': return { fromDate: startOfLastMonth, toDate: endOfLastMonth };
            case 'THIS_YEAR': return { fromDate: startOfYear };
            default: return {};
        }
    }, [timeRange]);

    const events = useMemo(() => {
        return financeSelectors.getEffectiveMoneyEvents(filters);
    }, [filters]);

    // Financials
    const income = events.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const expense = events.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const profit = income - expense;
    const margin = income > 0 ? (profit / income) * 100 : 0;

    // Category Breakdown
    const expenseByCategory = useMemo(() => {
        const map = new Map<string, number>();
        events.filter(e => e.type === 'Expense').forEach(e => {
            map.set(e.category, (map.get(e.category) || 0) + e.effectiveAmount);
        });
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    }, [events]);

    const maxCategoryAmount = expenseByCategory.length > 0 ? expenseByCategory[0][1] : 1;

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Reports</h1>
                <p className="text-slate-500 font-medium">Financial health & profitability</p>
            </div>

            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            {/* Filters */}
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none">
                {(['THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'ALL_TIME'] as TimeRange[]).map(r => (
                    <button
                        key={r}
                        onClick={() => setTimeRange(r)}
                        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${timeRange === r
                            ? 'bg-slate-800 text-white'
                            : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                            }`}
                    >
                        {r.replace('_', ' ')}
                    </button>
                ))}
            </div>

            {/* P&L Cards */}
            <div className="grid grid-cols-2 gap-4 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="glass-panel text-white p-5 rounded-3xl relative overflow-hidden group bg-slate-900 border-none shadow-xl shadow-slate-300">
                    <div className="absolute right-0 top-0 opacity-10 p-4">
                        <TrendingUp size={80} />
                    </div>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider relative z-10">Net Profit</p>
                    <h2 className={`text-3xl font-black mt-1 relative z-10 ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {profit >= 0 ? '+' : '-'}Rs {Math.abs(Math.round(profit)).toLocaleString('en-IN')}
                    </h2>
                    <p className={`text-xs font-bold mt-2 relative z-10 ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {margin.toFixed(1)}% Margin
                    </p>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="glass-panel p-4 rounded-2xl bg-emerald-50 border-emerald-100 flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-emerald-700 uppercase">Income</span>
                            <TrendingUp size={16} className="text-emerald-400" />
                        </div>
                        <p className="text-xl font-black text-emerald-900">Rs {Math.round(income).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="glass-panel p-4 rounded-2xl bg-rose-50 border-rose-100 flex-1">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-rose-700 uppercase">Expense</span>
                            <TrendingDown size={16} className="text-rose-400" />
                        </div>
                        <p className="text-xl font-black text-rose-900">Rs {Math.round(expense).toLocaleString('en-IN')}</p>
                    </div>
                </div>
            </div>

            {/* Expense Breakdown */}
            <div className="glass-panel bg-white p-6 rounded-3xl mb-6 shadow-sm border border-slate-100 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <PieChart size={18} className="text-slate-400" />
                        Expense Breakdown
                    </h3>
                    <button className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">View Details</button>
                </div>

                <div className="space-y-4">
                    {expenseByCategory.map(([cat, amount], idx) => (
                        <div key={cat} className="group">
                            <div className="flex items-center justify-between text-sm mb-1.5">
                                <span className="font-bold text-slate-700">{cat}</span>
                                <span className="font-bold text-slate-900">Rs {Math.round(amount).toLocaleString('en-IN')}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500'][idx % 4]} transition-all duration-1000 ease-out`}
                                    style={{ width: `${(amount / (income + expense || 1)) * 100}%` }} // Relative to turnover for visual scale, or just max?
                                ></div>
                                {/* Better visual: relative to TOTAL EXPENSE */}
                                <div
                                    className={`h-full rounded-full ${['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500'][idx % 4]} transition-all duration-1000 ease-out`}
                                    style={{ width: `${(amount / maxCategoryAmount) * 100}%`, display: 'none' }} // Hidden logic fix
                                ></div>
                            </div>
                            {/* Re-rendering the bar with correct logic for display */}
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden mt-[-8px]">
                                <div
                                    className={`h-full rounded-full ${['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500'][idx % 4]} transition-all duration-1000 ease-out`}
                                    style={{ width: `${(amount / expense) * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    ))}
                    {expenseByCategory.length === 0 && (
                        <OfflineEmptyState
                            icon={<PieChart size={32} className="text-slate-300" />}
                            title="Reports Need Data"
                            message="Add expenses or income records to see financial breakdown here."
                        />
                    )}
                </div>
            </div>

            {/* Service Proof — CEI Phase 3 §23.2 */}
            {canSeeServiceProof && (
                <button
                    onClick={() => onNavigate('service-proof')}
                    className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left flex items-center gap-3"
                >
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <PieChart size={20} className="text-emerald-700" />
                    </div>
                    <div>
                        <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-sm font-bold text-emerald-900">
                            सेवेचा पुरावा
                        </p>
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs text-emerald-700">
                            Service Proof — advisory delivery export
                        </p>
                    </div>
                    <svg className="ml-auto text-emerald-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
            )}

            {/* Insight Tip */}
            {profit < 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3 items-start animate-in zoom-in duration-300">
                    <Info size={20} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-amber-800">Review Expenses</p>
                        <p className="text-xs text-amber-700 mt-1">
                            Your expenses exceed income for this period. Check the "Machinery" & "Labour" categories for cost saving opportunities.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReportsPage;
