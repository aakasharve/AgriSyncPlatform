import React, { useState } from 'react';

// spec: plr-d10 lane F99 fix pass 1 (F100, row 15) — the server's report takes a period only. The template-lineage box
// and the resolved-warnings switch changed nothing the server sends, so they are gone (P5: no control that does nothing).
interface ServiceProofFilterSheetProps {
    onApply: (params: {
        fromDate: string;
        toDate: string;
    }) => void;
    onClose: () => void;
}

const defaultFromDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
};

const defaultToDate = () => new Date().toISOString().split('T')[0];

const ServiceProofFilterSheet: React.FC<ServiceProofFilterSheetProps> = ({ onApply, onClose }) => {
    const [fromDate, setFromDate] = useState(defaultFromDate);
    const [toDate, setToDate] = useState(defaultToDate);

    const handleApply = () => {
        onApply({
            fromDate,
            toDate,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="relative w-full rounded-t-3xl bg-white px-5 pt-4 pb-safe-area shadow-2xl">
                {/* Handle */}
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-300" />

                <h2 style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }} className="text-base font-bold text-stone-900 mb-4">
                    फिल्टर करा — Filter
                </h2>

                {/* Date range */}
                <div className="mb-6 flex gap-3">
                    <div className="flex-1">
                        <label style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs font-semibold text-stone-600 mb-1 block">From</label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={e => setFromDate(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                    </div>
                    <div className="flex-1">
                        <label style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-xs font-semibold text-stone-600 mb-1 block">To</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={e => setToDate(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-semibold text-stone-600"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ServiceProofFilterSheet;
