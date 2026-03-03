import React, { useEffect, useMemo, useState } from 'react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { FinanceManagerNav } from '../features/finance/components/FinanceManagerNav';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import { FileText, Filter, Search, Layers, Edit3, CornerDownRight, Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';
import { AttachmentList } from '../features/attachments';
import { useAttachmentRetry } from '../features/attachments/hooks/useAttachmentRetry';
import CostCorrectionSheet from '../features/finance/components/CostCorrectionSheet';
import { ExportButton } from '../features/export';

interface LedgerPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
}

const LedgerPage: React.FC<LedgerPageProps> = ({ currentRoute, onNavigate }) => {
    const [drawerFilter, setDrawerFilter] = useState<FinanceFilters | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [correctionTarget, setCorrectionTarget] = useState<{ id: string; amount: number; category: string } | null>(null);
    const [expandedAttachments, setExpandedAttachments] = useState<Record<string, boolean>>({});
    const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
    const { retryUpload } = useAttachmentRetry();

    const events = useMemo(() => financeSelectors.getEffectiveMoneyEvents(), [currentRoute, drawerFilter, refreshKey]);

    const totalIncome = events.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const totalExpense = events.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.effectiveAmount, 0);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleFinanceCacheUpdated = () => {
            setRefreshKey(previous => previous + 1);
        };

        window.addEventListener('agrisync:finance-cache-updated', handleFinanceCacheUpdated);
        return () => {
            window.removeEventListener('agrisync:finance-cache-updated', handleFinanceCacheUpdated);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadAttachmentCounts = async () => {
            const entityIds = events.map(event => event.id).filter(Boolean);
            if (entityIds.length === 0) {
                setAttachmentCounts({});
                return;
            }

            try {
                const db = getDatabase();
                const records = await db.attachments
                    .where('linkedEntityId')
                    .anyOf(entityIds)
                    .toArray();

                if (cancelled) {
                    return;
                }

                const counts = records.reduce<Record<string, number>>((accumulator, record) => {
                    if (!record.linkedEntityId) {
                        return accumulator;
                    }

                    accumulator[record.linkedEntityId] = (accumulator[record.linkedEntityId] ?? 0) + 1;
                    return accumulator;
                }, {});

                setAttachmentCounts(counts);
            } catch {
                if (!cancelled) {
                    setAttachmentCounts({});
                }
            }
        };

        void loadAttachmentCounts();
        return () => {
            cancelled = true;
        };
    }, [events]);

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24 min-h-screen bg-slate-50">
            <div className="mb-6">
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Ledger</h1>
                <p className="text-slate-500 font-medium">Source of truth for every number</p>
            </div>

            <FinanceManagerNav currentRoute={currentRoute} onNavigate={onNavigate} />

            {/* Stats Summary */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="rounded-2xl bg-emerald-100 border border-emerald-200 p-4">
                    <p className="text-xs font-bold uppercase text-emerald-700">Total Income</p>
                    <p className="text-xl font-black text-emerald-900">Rs {Math.round(totalIncome).toLocaleString('en-IN')}</p>
                </div>
                <div className="rounded-2xl bg-rose-100 border border-rose-200 p-4">
                    <p className="text-xs font-bold uppercase text-rose-700">Total Expense</p>
                    <p className="text-xl font-black text-rose-900">Rs {Math.round(totalExpense).toLocaleString('en-IN')}</p>
                </div>
            </div>

            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-400 uppercase tracking-widest text-xs flex items-center gap-2">
                    <FileText size={14} />
                    All Transactions
                </h3>
                <div className="flex items-center gap-2">
                    <ExportButton
                        reportType="daily-summary"
                        options={{ farmId: events[0]?.farmId || 'default', date: new Date().toISOString().split('T')[0], fileName: `daily-summary-${new Date().toISOString().split('T')[0]}.pdf` }}
                        label="Daily"
                    />
                    <ExportButton
                        reportType="monthly-cost"
                        options={{ farmId: events[0]?.farmId || 'default', year: new Date().getFullYear(), month: new Date().getMonth() + 1, fileName: `monthly-cost-${new Date().getFullYear()}-${new Date().getMonth() + 1}.pdf` }}
                        label="Monthly"
                    />
                    <button className="p-2 rounded-lg bg-white border border-slate-200 text-slate-400">
                        <Filter size={16} />
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {events.map((item, index) => {
                    const isAdjusted = item.trustStatus === 'Adjusted';
                    const hasCorrection = isAdjusted;
                    const attachmentCount = attachmentCounts[item.id] ?? 0;
                    const isAttachmentOpen = !!expandedAttachments[item.id];

                    return (
                        <div
                            key={item.id}
                            className="glass-panel p-4 rounded-xl group hover:border-slate-300 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 bg-white"
                            style={{ animationDelay: `${index * 20}ms` }}
                        >
                            <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm border shadow-sm ${item.type === 'Income' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                                    }`}>
                                    {item.category[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-800 truncate">{item.category}</p>
                                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                                        {item.dateTime.split('T')[0]} • {item.sourceType}
                                    </p>
                                    {/* Phase 3: Allocation & Correction badges */}
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        {/* Allocation badge */}
                                        {!item.plotId && item.type === 'Expense' && (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-600 border-blue-100">
                                                <Layers size={8} /> Unallocated
                                            </span>
                                        )}
                                        {/* Correction badge */}
                                        {hasCorrection && (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-600 border-amber-100">
                                                <CornerDownRight size={8} /> Corrected
                                            </span>
                                        )}
                                        {attachmentCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setExpandedAttachments(previous => ({
                                                        ...previous,
                                                        [item.id]: !previous[item.id],
                                                    }));
                                                }}
                                                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                                            >
                                                <Paperclip size={8} />
                                                {attachmentCount}
                                                {isAttachmentOpen ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-1.5">
                                    <MoneyChip
                                        amount={item.effectiveAmount}
                                        onClick={() => setDrawerFilter({ sourceType: item.sourceType, sourceId: item.sourceId })}
                                        className={item.type === 'Income' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}
                                    />
                                    {/* Correct button */}
                                    {item.type === 'Expense' && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setCorrectionTarget({ id: item.id, amount: item.effectiveAmount, category: item.category });
                                            }}
                                            className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-amber-500 hover:border-amber-200 hover:bg-amber-50 transition-all opacity-0 group-hover:opacity-100"
                                            title="Correct this entry"
                                        >
                                            <Edit3 size={12} />
                                        </button>
                                    )}
                                </div>
                                {item.trustStatus !== 'Verified' && (
                                    <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                        {isAdjusted ? 'Adjusted' : 'Unverified'}
                                    </span>
                                )}
                            </div>
                            </div>

                            {isAttachmentOpen && attachmentCount > 0 && (
                                <div className="mt-3 border-t border-slate-100 pt-2">
                                    <AttachmentList
                                        linkedEntityId={item.id}
                                        compact
                                        onRetry={retryUpload}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}

                {events.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center bg-white/50">
                        <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Search size={32} />
                        </div>
                        <h3 className="font-bold text-slate-400 text-lg">Empty Ledger</h3>
                        <p className="text-sm text-slate-300 mt-1">Record expenses or income to see them here.</p>
                    </div>
                )}
            </div>

            <MoneyLensDrawer
                isOpen={!!drawerFilter}
                onClose={() => setDrawerFilter(null)}
                filters={drawerFilter || {}}
                canAdjust={true}
            />

            {/* Cost Correction Sheet */}
            {correctionTarget && (
                <CostCorrectionSheet
                    costEntryId={correctionTarget.id}
                    originalAmount={correctionTarget.amount}
                    category={correctionTarget.category}
                    onClose={() => setCorrectionTarget(null)}
                    onCorrected={() => setRefreshKey(k => k + 1)}
                />
            )}
        </div>
    );
};

export default LedgerPage;
