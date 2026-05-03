import React, { useMemo, useState } from 'react';
import { AppRoute } from '../../types';
import { financeSelectors } from '../finance/financeSelectors';
import { financeService } from '../finance/financeService';
import { financeCommandService } from '../finance/financeCommandService';
import { FinanceManagerNav } from '../finance/components/FinanceManagerNav';
import { MoneyChip } from '../finance/components/MoneyChip';
import { MoneyLensDrawer } from '../finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../finance/finance.types';
import { AlertTriangle, CheckCircle } from 'lucide-react';

interface ReviewInboxPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const ReviewInboxPage: React.FC<ReviewInboxPageProps> = ({ currentRoute, onNavigate }) => {
    const [refresh, setRefresh] = useState(0);
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    const entries = useMemo(() => financeSelectors.getReviewInbox(), [currentRoute, refresh]);

    const approveAllLowRisk = () => {
        const ids = entries.filter(item => !(item.reviewReasons || []).includes('HIGH_AMOUNT')).map(item => item.id);
        financeCommandService.approveEvents(ids, 'owner');
        setRefresh(v => v + 1);
    };

    const approveHighImpact = () => {
        const ids = entries
            .filter(item => item.effectiveAmount >= financeService.getSettings().highAmountThreshold)
            .map(item => item.id);
        financeCommandService.approveEvents(ids, 'owner');
        setRefresh(v => v + 1);
    };

    const approveToday = () => {
        const today = new Date().toISOString().split('T')[0];
        const ids = entries.filter(item => item.dateTime.startsWith(today)).map(item => item.id);
        financeCommandService.approveEvents(ids, 'owner');
        setRefresh(v => v + 1);
    };

    const handleApproveSingle = (id: string) => {
        financeCommandService.approveEvents([id], 'owner');
        setRefresh(v => v + 1);
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Review Inbox</h1>
                <p className="text-slate-500 font-medium">Approve and fix suspicious money events</p>
            </div>

            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            {entries.length > 0 && (
                <div className="mb-6 flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-4 duration-500">
                    <button onClick={approveAllLowRisk} className="rounded-full bg-emerald-100 border border-emerald-200 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-200 transition-colors">
                        Approve Low Risk
                    </button>
                    <button onClick={approveHighImpact} className="rounded-full bg-blue-100 border border-blue-200 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-200 transition-colors">
                        Approve High Impact
                    </button>
                    <button onClick={approveToday} className="rounded-full bg-slate-200 border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-300 transition-colors">
                        Approve Today
                    </button>
                </div>
            )}

            <div className="space-y-3">
                {entries.map((item, index) => (
                    <div
                        key={item.id}
                        className="glass-panel p-4 rounded-2xl flex items-center justify-between group hover:border-emerald-200 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                        style={{ animationDelay: `${index * 50}ms` }}
                    >
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center border border-amber-100 shrink-0">
                                <AlertTriangle size={20} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-slate-800">{item.category}</h3>
                                    <span className="text-xs font-medium text-slate-400">• {new Date(item.dateTime).toLocaleDateString()}</span>
                                </div>
                                <p className="text-sm text-slate-500">{item.notes || item.vendorName || `${item.sourceType} Entry`}</p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {(item.reviewReasons || []).map(reason => (
                                        <span key={reason} className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100">
                                            {reason}
                                        </span>
                                    ))}
                                    {(!item.reviewReasons || item.reviewReasons.length === 0) && (
                                        <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 text-[10px] font-bold border border-amber-100">
                                            Needs Review
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <MoneyChip
                                amount={item.effectiveAmount}
                                onClick={() => setDrawerFilter({ sourceType: item.sourceType, sourceId: item.sourceId })}
                                className="bg-amber-50 text-amber-700 border-amber-200 group-hover:bg-amber-100 transition-colors"
                            />
                            <button
                                onClick={() => handleApproveSingle(item.id)}
                                className="p-2 rounded-lg bg-slate-100 text-slate-400 hover:bg-emerald-100 hover:text-emerald-600 transition-colors"
                                title="Approve"
                            >
                                <CheckCircle size={18} />
                            </button>
                        </div>
                    </div>
                ))}

                {entries.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center bg-white/50">
                        <div className="w-16 h-16 bg-emerald-50 text-emerald-300 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle size={32} />
                        </div>
                        <h3 className="font-bold text-slate-400 text-lg">All caught up!</h3>
                        <p className="text-sm text-slate-300 mt-1">No suspicious money events found.</p>
                    </div>
                )}
            </div>

            <MoneyLensDrawer
                isOpen={!!drawerFilter}
                onClose={() => setDrawerFilter(null)}
                filters={drawerFilter || {}}
                canAdjust={true}
            />
        </div>
    );
};

export default ReviewInboxPage;
