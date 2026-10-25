import React, { useState } from 'react';
import { FinanceFilters, EffectiveMoneyEvent } from '../finance.types';
import { financeSelectors } from '../financeSelectors';
import { financeCommandService } from '../financeCommandService';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { SANS } from '../../../shared/components/ui/placeUi';
import { BUCKET_LABEL, SOURCE_LABEL, categoryLabel, entryState, formatMoneyDate, rupees } from '../moneyLabels';

// spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the money drawer behind a tapped amount, in
// Marathi with the पैसे व हिशोब words (`moneyLabels.ts`). Same reads and the same two writes as before.

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
    // One tap used to write a ₹ 0 correction to the server under a bare noun ("दुहेरी नोंद"); now it asks first.
    const [confirmDuplicate, setConfirmDuplicate] = useState(false);

    const breakdown = financeSelectors.getBreakdown(filters);

    useBackDismiss(isOpen, onClose);
    if (!isOpen) return null;

    const openFix = (line: EffectiveMoneyEvent) => {
        setSelected(line);
        setAmount(String(Math.round(line.effectiveAmount)));
        setNote(line.notes || '');
        setConfirmDuplicate(false);
    };

    const handleApplyFix = () => {
        if (!selected) return;
        // A cleared box is not ₹ 0: `Number('')` is 0, and saving it would erase the amount (P4).
        if (amount.trim() === '') return;
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
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50" style={{ fontFamily: SANS }}>
            <div className="w-full max-w-2xl rounded-t-3xl bg-white p-4 max-h-[85vh] overflow-y-auto">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">पैशांचा तपशील</h3>
                        <p className="text-xs text-slate-500">हा आकडा वहीतल्या या नोंदींचा आहे.</p>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
                        बंद करा
                    </button>
                </div>

                <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">खर्च</p>
                        <p className="text-sm font-black text-slate-800">{rupees(breakdown.totals.totalExpense)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">जमा</p>
                        <p className="text-sm font-black text-slate-800">{rupees(breakdown.totals.totalIncome)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">न तपासलेले</p>
                        <p className="text-sm font-black text-slate-800">{rupees(breakdown.totals.unverifiedTotal)}</p>
                    </div>
                </div>

                <div className="space-y-2">
                    {breakdown.lines.map(line => (
                        <div key={line.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-800">{categoryLabel(line.category)}</p>
                                    <p className="text-xs text-slate-500">
                                        {[SOURCE_LABEL[line.sourceType], line.vendorName, formatMoneyDate(line.dateTime)].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <p className="text-sm font-black text-slate-900">{rupees(line.effectiveAmount)}</p>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${TRUST_TONE[line.trustStatus] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                    {BUCKET_LABEL[entryState(line)]}
                                </span>
                                {canAdjust && (
                                    <button
                                        onClick={() => openFix(line)}
                                        className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold text-white"
                                    >
                                        दुरुस्त करा
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {breakdown.lines.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                            या आकड्यामागे वहीत एकही नोंद नाही.
                        </div>
                    )}
                </div>

                {selected && canAdjust && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <p className="text-sm font-bold text-blue-900">दुरुस्ती: {categoryLabel(selected.category)}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                                type="number"
                                placeholder="बरोबर रक्कम"
                            />
                            <input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm"
                                placeholder="कारण / टीप"
                            />
                        </div>
                        <div className="mt-2 flex gap-2">
                            <button onClick={handleApplyFix} disabled={amount.trim() === ''} className="rounded-lg bg-blue-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">
                                दुरुस्ती जतन करा
                            </button>
                            <button
                                onClick={() => setConfirmDuplicate(true)}
                                className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white"
                            >
                                दुहेरी नोंद म्हणून काढा
                            </button>
                            <button onClick={() => setSelected(null)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                                रद्द करा
                            </button>
                        </div>
                        {confirmDuplicate && (
                            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2" data-testid="duplicate-confirm">
                                <p className="text-xs font-bold text-amber-900">ही नोंद ₹ 0 होईल (दुहेरी म्हणून). नक्की?</p>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        onClick={() => {
                                            financeCommandService.markAsDuplicate(selected.id, currentUserId);
                                            setConfirmDuplicate(false);
                                            setSelected(null);
                                        }}
                                        className="rounded-lg bg-amber-700 px-3 py-1 text-xs font-bold text-white"
                                    >
                                        हो, काढा
                                    </button>
                                    <button onClick={() => setConfirmDuplicate(false)} className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                                        नको
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
