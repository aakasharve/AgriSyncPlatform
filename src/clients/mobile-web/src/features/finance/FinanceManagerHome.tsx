import React, { useMemo } from 'react';
import { AppRoute } from '../../types';
import { financeSelectors } from './financeSelectors';
import { FinanceManagerNav } from './components/FinanceManagerNav';
import { ChevronRight, TrendingUp, AlertCircle, CheckCircle, RefreshCcw } from 'lucide-react';
import { ExportButton } from '../export';

interface FinanceManagerHomeProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const FinanceManagerHome: React.FC<FinanceManagerHomeProps> = ({ currentRoute, onNavigate }) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: `currentRoute` is the recompute trigger (financeSelectors reads from a module-level store); we want this memo to re-derive on route navigation back into Finance, not on the (zero) deps of the pure selector call.
    const buckets = useMemo(() => financeSelectors.getPipelineBuckets(), [currentRoute]);
    const currentFarmId = useMemo(() => financeSelectors.getEffectiveMoneyEvents()[0]?.farmId || 'default', []);

    const getIcon = (key: string) => {
        switch (key) {
            case 'Captured': return <RefreshCcw size={20} className="text-blue-500" />;
            case 'NeedsReview': return <AlertCircle size={20} className="text-amber-500" />;
            case 'Approved': return <CheckCircle size={20} className="text-emerald-500" />;
            case 'Adjusted': return <TrendingUp size={20} className="text-purple-500" />;
            default: return <div />;
        }
    };

    const getColor = (key: string) => {
        switch (key) {
            case 'Captured': return 'bg-blue-50 border-blue-100 hover:border-blue-300';
            case 'NeedsReview': return 'bg-amber-50 border-amber-100 hover:border-amber-300';
            case 'Approved': return 'bg-emerald-50 border-emerald-100 hover:border-emerald-300';
            case 'Adjusted': return 'bg-purple-50 border-purple-100 hover:border-purple-300';
            default: return 'bg-white border-slate-200';
        }
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Finance Manager</h1>
                <p className="text-slate-500 font-medium">Daily money control room</p>
            </div>

            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {buckets.map((bucket, index) => (
                    <button
                        key={bucket.key}
                        onClick={() => {
                            if (bucket.key === 'NeedsReview') onNavigate('finance-review-inbox');
                            else onNavigate('finance-ledger');
                        }}
                        className={`rounded-2xl border p-5 text-left transition-all duration-300 group hover:shadow-md active:scale-[0.98] ${getColor(bucket.key)}`}
                        style={{ animationDelay: `${index * 100}ms` }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2 rounded-xl bg-white shadow-sm border border-slate-100">
                                {getIcon(bucket.key)}
                            </div>
                            <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </div>

                        <p className="text-xs font-black uppercase text-slate-400 tracking-wider mb-0.5">{bucket.key}</p>
                        <p className="text-2xl font-black text-slate-800 tracking-tight">{bucket.count}</p>
                        <p className="text-sm font-bold text-slate-600 mt-1">Rs {Math.round(bucket.total).toLocaleString('en-IN')}</p>

                        {bucket.key === 'NeedsReview' && bucket.count > 0 && (
                            <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-100 text-red-700 text-[10px] font-bold">
                                <AlertCircle size={10} />
                                {bucket.count} items pending
                            </div>
                        )}
                    </button>
                ))}
            </div>

            <div className="mt-8 rounded-3xl bg-slate-800 p-6 text-white relative overflow-hidden group">
                <div className="absolute -right-10 -top-10 text-white/5 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                    <TrendingUp size={150} />
                </div>
                <div className="flex items-center justify-between relative z-10">
                    <h3 className="text-lg font-black">Quick Stats</h3>
                    <ExportButton
                        reportType="monthly-cost"
                        options={{ farmId: currentFarmId, year: new Date().getFullYear(), month: new Date().getMonth() + 1, fileName: `monthly-cost-${new Date().getFullYear()}-${new Date().getMonth() + 1}.pdf` }}
                        variant="secondary"
                        label="Report"
                        className="bg-white/10 text-white hover:bg-white hover:text-slate-900 border-0"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4 relative z-10">
                    <div>
                        <p className="text-slate-400 text-xs font-bold uppercase">Total Input</p>
                        <p className="text-xl font-bold">Rs {Math.round(buckets.find(b => b.key === 'Approved')?.total || 0).toLocaleString('en-IN')}</p>
                    </div>
                    <div>
                        <p className="text-slate-400 text-xs font-bold uppercase">Pending Review</p>
                        <p className="text-xl font-bold text-amber-400">Rs {Math.round(buckets.find(b => b.key === 'NeedsReview')?.total || 0).toLocaleString('en-IN')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FinanceManagerHome;
