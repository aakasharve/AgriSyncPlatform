import React, { useState } from 'react';
import { FinanceFilters, EffectiveMoneyEvent } from '../finance.types';
import { financeSelectors } from '../financeSelectors';
import { financeCommandService } from '../financeCommandService';

interface MoneyLensDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    filters?: FinanceFilters;
    canAdjust?: boolean;
    currentUserId?: string;
}

const TRUST_TONE: Record<string, string> = {
    Unverified: 'bg-amber-50 text-amber-700 border-amber-200',
    Verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Adjusted: 'bg-blue-50 text-blue-700 border-blue-200'
};

export const MoneyLensDrawer: React.FC<MoneyLensDrawerProps> = ({
    isOpen,
    onClose,
    filters,
    canAdjust = true,
    currentUserId = 'owner'
}) => {
    const [selected, setSelected] = useState<EffectiveMoneyEvent | null>(null);
    const [amount, setAmount] = useState<string>('');
    const [note, setNote] = useState('');

    const breakdown = financeSelectors.getBreakdown(filters);

    if (!isOpen) return null;

    const openFix = (line: EffectiveMoneyEvent) => {
        setSelected(line);
        setAmount(String(Math.round(line.effectiveAmount)));
        setNote(line.notes || '');
    };

    const handleApplyFix = () => {
        if (!selected) return;
        const nextAmount = Number(amount);
        if (Number.isNaN(nextAmount)) return;
        financeCommandService.applyAdjustment({
            adjustsMoneyEventId: selected.id,
            deltaAmount: nextAmount - selected.effectiveAmount,
            correctedFields: { amount: nextAmount, notes: note },
            reason: 'Owner correction',
            correctedByUserId: currentUserId
        });
        setSelected(null);
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50">
            <div className="w-full max-w-2xl rounded-t-3xl bg-white p-4 max-h-[85vh] overflow-y-auto">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">Money Breakdown</h3>
                        <p className="text-xs text-slate-500">Every number is traced to ledger lines.</p>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
                        Close
                    </button>
                </div>

                <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">Expense</p>
                        <p className="text-sm font-black text-slate-800">Rs {Math.round(breakdown.totals.totalExpense).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">Income</p>
                        <p className="text-sm font-black text-slate-800">Rs {Math.round(breakdown.totals.totalIncome).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">Unverified</p>
                        <p className="text-sm font-black text-slate-800">Rs {Math.round(breakdown.totals.unverifiedTotal).toLocaleString('en-IN')}</p>
                    </div>
                </div>

                <div className="space-y-2">
                    {breakdown.lines.map(line => (
                        <div key={line.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-800">{line.category}</p>
                                    <p className="text-xs text-slate-500">{line.sourceType} • {line.vendorName || 'No vendor'} • {line.dateTime.split('T')[0]}</p>
                                </div>
                                <p className="text-sm font-black text-slate-900">Rs {Math.round(line.effectiveAmount).toLocaleString('en-IN')}</p>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${TRUST_TONE[line.trustStatus] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                    {line.trustStatus}
                                </span>
                                {canAdjust && (
                                    <button
                                        onClick={() => openFix(line)}
                                        className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold text-white"
                                    >
                                        Fix
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {breakdown.lines.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                            No ledger lines found for this number.
                        </div>
                    )}
                </div>

                {selected && canAdjust && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <p className="text-sm font-bold text-blue-900">Fix Line: {selected.category}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                                type="number"
                                placeholder="Correct amount"
                            />
                            <input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                                placeholder="Reason / note"
                            />
                        </div>
                        <div className="mt-2 flex gap-2">
                            <button onClick={handleApplyFix} className="rounded-lg bg-blue-700 px-3 py-1 text-xs font-bold text-white">
                                Save Adjustment
                            </button>
                            <button
                                onClick={() => financeCommandService.markAsDuplicate(selected.id, currentUserId)}
                                className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white"
                            >
                                Mark Duplicate
                            </button>
                            <button onClick={() => setSelected(null)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
