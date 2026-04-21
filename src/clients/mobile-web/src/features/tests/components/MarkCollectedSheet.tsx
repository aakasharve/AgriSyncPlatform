/**
 * MarkCollectedSheet — CEI Phase 2 §4.5 task 4.2.2.
 *
 * The simplest possible confirm: collector is the caller (server derives
 * the user id from JWT), and the action flips the instance to
 * `Collected`. No inputs needed — just "is this actually collected?" to
 * avoid accidental taps.
 */

import React, { useState } from 'react';
import { X, Beaker } from 'lucide-react';
import type { DexieTestInstance } from '../../../infrastructure/storage/DexieDatabase';
import { markCollected } from '../data/testsClient';
import { useFarmContext } from '../../../core/session/FarmContext';

interface MarkCollectedSheetProps {
    instance: DexieTestInstance;
    onClose: () => void;
    onSuccess: (updated: DexieTestInstance) => void;
}

const MarkCollectedSheet: React.FC<MarkCollectedSheetProps> = ({ instance, onClose, onSuccess }) => {
    const { meContext } = useFarmContext();
    const collectorName = meContext?.me.displayName ?? '';
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const updated = await markCollected(instance.id);
            onSuccess(updated);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not mark collected. Try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
            onClick={isSaving ? undefined : onClose}
        >
            <div
                className="w-full max-w-md rounded-t-[2rem] bg-white px-6 pb-6 pt-6 shadow-2xl sm:rounded-3xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                        <Beaker size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-lg font-bold text-stone-900"
                        >
                            Confirm sample collected
                        </h3>
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-sm font-semibold text-stone-500"
                        >
                            नमुना घेतल्याची खात्री करा
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 disabled:opacity-50"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Info banner */}
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        className="text-sm font-semibold text-amber-900"
                    >
                        आज नमुना घेतला गेला याची खात्री करा.
                    </p>
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs text-amber-800 mt-0.5"
                    >
                        Confirm the sample was collected today.
                    </p>
                </div>

                {/* Summary block */}
                <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-3 space-y-1">
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-[10px] font-bold uppercase tracking-widest text-stone-400"
                    >
                        Sample
                    </p>
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-base font-bold text-stone-900 truncate"
                    >
                        {instance.testProtocolName ?? 'Test'}
                    </p>
                    <p
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        className="text-xs text-stone-500"
                    >
                        {instance.stageName} · {instance.plannedDueDate}
                    </p>
                </div>

                {/* Collector readonly */}
                {collectorName && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
                        <span
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-[10px] font-bold uppercase tracking-widest text-stone-400"
                        >
                            Collected by
                        </span>
                        <span
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-sm font-semibold text-stone-800 truncate"
                        >
                            {collectorName}
                        </span>
                    </div>
                )}

                {error && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 hover:border-stone-300 disabled:opacity-50"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Not yet
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSaving}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm active:bg-emerald-700 disabled:opacity-50"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {isSaving ? 'Saving…' : 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MarkCollectedSheet;
