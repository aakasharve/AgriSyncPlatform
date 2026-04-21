/**
 * PayoutConfirmationSheet — settle a job card.
 * CEI Phase 4 §4.8
 *
 * Sections:
 *   - Worker name + job card summary (read-only)
 *   - Linked daily log verification status (must be Verified; sheet disables submit if not)
 *   - Estimated vs actual amount (actual is editable, defaults to estimated)
 *   - Settlement note textarea (optional)
 *   - Anti-ego line: "Settling marks this job as paid in your ledger. It does not send money."
 *   - Settle button (rose) with double-confirm dialog
 *
 * On success → calls onSettled and shows a toast via onViewLedger.
 */

import React, { useState } from 'react';
import type { JobCard } from '../../../domain/work/JobCard';
import type { SettleJobCardRequest } from '../data/jobCardsClient';

interface PayoutConfirmationSheetProps {
    card: JobCard;
    onClose: () => void;
    onSettled: (req: SettleJobCardRequest) => Promise<void>;
    onViewLedger: () => void;
}

const PayoutConfirmationSheet: React.FC<PayoutConfirmationSheetProps> = ({
    card,
    onClose,
    onSettled,
    onViewLedger,
}) => {
    const [actualAmount, setActualAmount] = useState<number>(card.estimatedTotalAmount);
    const [settlementNote, setSettlementNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [settled, setSettled] = useState(false);

    // The linked log must be verified for payout — we check via status
    const canSettle = card.status === 'VerifiedForPayout';

    const handleSettle = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await onSettled({
                actualPayoutAmount: actualAmount,
                actualPayoutCurrencyCode: card.estimatedTotalCurrency || 'INR',
                ...(settlementNote.trim() ? { settlementNote: settlementNote.trim() } : {}),
            });
            setSettled(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Settlement failed');
        } finally {
            setIsSaving(false);
            setShowConfirmDialog(false);
        }
    };

    if (settled) {
        return (
            <div
                className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm"
                onClick={onClose}
            >
                <div
                    className="w-full max-w-lg rounded-t-[2rem] bg-white px-5 pb-8 pt-6 shadow-2xl"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-stone-200" />
                    <div className="flex flex-col items-center text-center gap-3 py-4">
                        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <p style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-lg font-black text-stone-900">
                            सेटल झाले
                        </p>
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm text-stone-500">
                            Job card settled for INR {Math.round(actualAmount).toLocaleString('en-IN')}
                        </p>
                        <div className="flex gap-2 w-full mt-2">
                            <button
                                onClick={onViewLedger}
                                className="flex-1 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                View in Ledger
                            </button>
                            <button
                                onClick={onClose}
                                className="flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm"
                onClick={!showConfirmDialog ? onClose : undefined}
            >
                <div
                    className="w-full max-w-lg rounded-t-[2rem] bg-white px-5 pb-8 pt-6 shadow-2xl max-h-[90vh] overflow-y-auto"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-stone-200" />

                    <h2
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        className="text-lg font-black text-stone-900 mb-1"
                    >
                        पेआउट सेटल करा
                    </h2>
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs text-stone-500 mb-5"
                    >
                        Settle Payout — {card.id.slice(-6).toUpperCase()}
                    </p>

                    {/* Worker + job summary */}
                    <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4 mb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-black text-emerald-800">
                                {(card.assignedWorkerDisplayName ?? 'W').slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                                <p
                                    className="text-sm font-bold text-stone-900"
                                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                >
                                    {card.assignedWorkerDisplayName ?? 'Worker'}
                                </p>
                                <p
                                    className="text-[10px] text-stone-400"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    {card.lineItems.map(l => l.activityType).join(', ')} · {card.plannedDate}
                                </p>
                            </div>
                        </div>

                        {/* Verification status */}
                        {!canSettle && (
                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mt-2">
                                <p
                                    className="text-xs font-semibold text-amber-800"
                                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                >
                                    ⚠ नोंद अद्याप तपासलेली नाही
                                </p>
                                <p
                                    className="text-[11px] text-amber-700 mt-0.5"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    Linked daily log must be verified before settling. Current status: {card.status}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Estimated vs actual */}
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p
                                    className="text-[10px] font-bold uppercase text-stone-400"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    Estimated
                                </p>
                                <p
                                    className="text-base font-black text-stone-500 line-through"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    {card.estimatedTotalCurrency} {Math.round(card.estimatedTotalAmount).toLocaleString('en-IN')}
                                </p>
                            </div>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-300">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                            <div>
                                <p
                                    className="text-[10px] font-bold uppercase text-stone-400 text-right"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    Actual payout
                                </p>
                                <input
                                    type="number"
                                    min="0"
                                    value={actualAmount}
                                    onChange={e => setActualAmount(parseFloat(e.target.value) || 0)}
                                    disabled={!canSettle}
                                    className="w-28 rounded-xl border border-stone-200 px-3 py-1.5 text-base font-black text-stone-900 text-right disabled:opacity-50"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Settlement note */}
                    <div className="mb-5">
                        <label
                            className="block text-xs font-bold text-stone-500 mb-1"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Settlement note (optional)
                        </label>
                        <textarea
                            value={settlementNote}
                            onChange={e => setSettlementNote(e.target.value)}
                            disabled={!canSettle}
                            rows={2}
                            placeholder="टीप..."
                            className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm resize-none disabled:opacity-50"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        />
                    </div>

                    {/* Anti-ego line */}
                    <p
                        className="text-xs text-stone-400 text-center mb-4 px-2"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Settling marks this job as paid in your ledger. It does not send money.
                    </p>

                    {error && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 mb-4">
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => setShowConfirmDialog(true)}
                            disabled={!canSettle || isSaving}
                            className="flex-1 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            सेटल करा
                        </button>
                    </div>
                </div>
            </div>

            {/* Double-confirm dialog */}
            {showConfirmDialog && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/60 backdrop-blur-sm px-4">
                    <div className="w-full max-w-xs rounded-3xl bg-white p-6 shadow-2xl text-center">
                        <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4 text-rose-600">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h3
                            className="text-base font-black text-stone-900 mb-1"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        >
                            खात्री आहे का?
                        </h3>
                        <p
                            className="text-xs text-stone-500 mb-5"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Settle {card.estimatedTotalCurrency} {Math.round(actualAmount).toLocaleString('en-IN')} for {card.assignedWorkerDisplayName ?? 'Worker'}?
                            <br />
                            This cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowConfirmDialog(false)}
                                className="flex-1 rounded-2xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-stone-700"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                नाही
                            </button>
                            <button
                                onClick={handleSettle}
                                disabled={isSaving}
                                className="flex-1 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {isSaving ? '…' : 'होय, सेटल करा'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default PayoutConfirmationSheet;
