import React, { useMemo, useState } from 'react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { FinanceManagerNav } from '../features/finance/components/FinanceManagerNav';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import { AlertTriangle, CheckCircle } from 'lucide-react';

interface ReviewInboxPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const ReviewInboxPage: React.FC<ReviewInboxPageProps> = ({ currentRoute, onNavigate }) => {
    const [refresh, setRefresh] = useState(0);
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5). "Approve" used to mark
    // entries verified on this phone and send a LOG verification carrying a money entry's
    // id — the server found no such log, recorded nothing, and the mark vanished on the
    // next reload. There is no server path for approving a money entry yet (PENDING D-12),
    // so the buttons are gone and the page says so (doctrine P5), the same way the review
    // sheet already does. `refresh` stays for the money drawer's adjustments.
    // `currentRoute` and `refresh` are re-read triggers: the selector reads a mutable store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const entries = useMemo(() => financeSelectors.getReviewInbox(), [currentRoute, refresh]);

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Review Inbox</h1>
                <p className="text-slate-500 font-medium">Approve and fix suspicious money events</p>
            </div>

            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            {entries.length > 0 && (
                <p data-testid="review-approve-unavailable" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    मंजुरी अजून उपलब्ध नाही — खर्च दुरुस्त करायचा असेल तर रकमेवर दाबा. · Approving is not available yet; tap an amount to correct it.
                </p>
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
                onClose={() => { setDrawerFilter(null); setRefresh(v => v + 1); }}
                filters={drawerFilter || {}}
                canAdjust={true}
            />
        </div>
    );
};

export default ReviewInboxPage;
