import React, { useEffect, useMemo, useState } from 'react';
import { AppRoute } from '../types';
import { financeSelectors } from '../features/finance/financeSelectors';
import { FinanceManagerNav } from '../features/finance/components/FinanceManagerNav';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import { Search, Layers, Edit3, CornerDownRight } from 'lucide-react';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';
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
    const [expandedAttachments, _setExpandedAttachments] = useState<Record<string, boolean>>({});
    const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
    const [filterType, setFilterType] = useState<'All' | 'Income' | 'Expense' | 'LabourPayouts'>('All');
    const [isDetailView, setIsDetailView] = useState(false);
    const { retryUpload: _retryUpload } = useAttachmentRetry();

    const events = useMemo(() => financeSelectors.getEffectiveMoneyEvents(), [currentRoute, drawerFilter, refreshKey]);

    const totalIncome = events.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.effectiveAmount, 0);
    const totalExpense = events.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.effectiveAmount, 0);

    const filteredEvents = useMemo(() => {
        if (filterType === 'All') return events;
        if (filterType === 'LabourPayouts') return events.filter(e => Boolean((e as typeof e & { jobCardId?: string }).jobCardId));
        return events.filter(e => e.type === filterType);
    }, [events, filterType]);

    const groupedEvents = useMemo(() => {
        const groups: Record<string, typeof events> = {};
        filteredEvents.forEach(e => {
            const date = e.dateTime.split('T')[0];
            if (!groups[date]) groups[date] = [];
            groups[date].push(e);
        });
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [filteredEvents]);

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

            <div className="flex flex-col gap-3 mb-6">
                <div className="flex items-center justify-between">
                    <div className="flex bg-slate-200 p-1 rounded-xl overflow-x-auto no-scrollbar">
                        {(['All', 'Income', 'Expense', 'LabourPayouts'] as const).map(ft => (
                            <button
                                key={ft}
                                onClick={() => setFilterType(ft)}
                                className={`flex-shrink-0 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${filterType === ft ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {ft === 'LabourPayouts' ? 'Labour payouts' : ft}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setIsDetailView(!isDetailView)} className={`p-2 rounded-lg text-xs font-bold flex items-center gap-1 border transition-colors ${isDetailView ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                            <Layers size={14} /> <span className="hidden sm:inline">{isDetailView ? 'Compact' : 'Detailed'}</span>
                        </button>
                        <ExportButton
                            reportType="monthly-cost"
                            options={{ farmId: events[0]?.farmId || 'default', year: new Date().getFullYear(), month: new Date().getMonth() + 1, fileName: `monthly-cost-${new Date().getFullYear()}-${new Date().getMonth() + 1}.pdf` }}
                            label=""
                            className="p-2"
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                {groupedEvents.map(([date, dayEvents], groupIdx) => (
                    <div key={date} className="space-y-3 animate-in fade-in slide-in-from-bottom-4" style={{ animationDelay: `${groupIdx * 50}ms` }}>
                        <div className="sticky top-0 bg-slate-50/90 backdrop-blur pb-2 pt-1 z-10 flex items-center gap-3">
                            <h4 className="font-black text-slate-700 text-sm">{new Date(date).toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
                            <div className="h-px bg-slate-200 flex-1"></div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{dayEvents.length} items</span>
                        </div>
                        
                        <div className="space-y-2">
                            {dayEvents.map(item => {
                                const isAdjusted = item.trustStatus === 'Adjusted';
                                const hasCorrection = isAdjusted;
                                const jobCardId = (item as typeof item & { jobCardId?: string }).jobCardId;
                                const _attachmentCount = attachmentCounts[item.id] ?? 0;
                                const _isAttachmentOpen = !!expandedAttachments[item.id];

                                return (
                                    <div
                                        key={item.id}
                                        className={`glass-panel rounded-xl group hover:border-slate-300 transition-all duration-300 bg-white ${isDetailView ? 'p-4' : 'p-3'}`}
                                    >
                                        <div className={`flex ${isDetailView ? 'items-start' : 'items-center'} justify-between`}>
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className={`${isDetailView ? 'w-10 h-10 text-base' : 'w-8 h-8 text-sm'} rounded-xl flex items-center justify-center font-bold border shadow-sm shrink-0 transition-all ${item.type === 'Income' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                                                    {isDetailView ? (item.category[0] + item.category[1]?.toLowerCase()) : item.category[0]}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`font-bold text-slate-800 truncate ${isDetailView ? 'text-base mb-0.5' : 'text-sm'}`}>{item.category}</p>
                                                    
                                                    {isDetailView && (
                                                        <p className="text-xs text-slate-500 mb-2">{item.sourceType} • {item.notes || 'No details'}</p>
                                                    )}

                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        {(!isDetailView) && (
                                                            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider hidden sm:inline-block">
                                                                {item.sourceType}
                                                            </span>
                                                        )}
                                                        
                                                        {(!item.plotId && item.type === 'Expense') && (
                                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-600 border-blue-100">
                                                                <Layers size={8} /> Unallocated
                                                            </span>
                                                        )}
                                                        
                                                        {hasCorrection && (
                                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-600 border-amber-100">
                                                                <CornerDownRight size={8} /> Corrected
                                                            </span>
                                                        )}

                                                        {jobCardId && (
                                                            <button
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    onNavigate('jobs' as AppRoute);
                                                                }}
                                                                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors"
                                                            >
                                                                View job
                                                            </button>
                                                        )}

                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                                                <div className="flex items-center gap-1.5">
                                                    {item.type === 'Expense' && isDetailView && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setCorrectionTarget({ id: item.id, amount: item.effectiveAmount, category: item.category });
                                                            }}
                                                            className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-amber-500 hover:border-amber-200 hover:bg-amber-50 transition-all"
                                                            title="Correct this entry"
                                                        >
                                                            <Edit3 size={12} />
                                                        </button>
                                                    )}
                                                    <MoneyChip
                                                        amount={item.effectiveAmount}
                                                        onClick={() => setDrawerFilter({ sourceType: item.sourceType, sourceId: item.sourceId })}
                                                        className={`${isDetailView ? 'text-base px-3 py-1.5' : 'text-sm'} ${item.type === 'Income' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}
                                                    />
                                                </div>
                                                
                                                {item.trustStatus !== 'Verified' && isDetailView && (
                                                    <span className="text-[9px] font-bold text-amber-500 mt-1">
                                                        {isAdjusted ? 'Adjusted value shown' : 'Pending Verification'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
                
                {filteredEvents.length === 0 && (
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
