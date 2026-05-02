/**
 * CreateJobCardSheet — bottom sheet to create a new job card.
 * CEI Phase 4 §4.8
 *
 * Fields:
 *   - Plot picker (required)
 *   - Crop cycle picker (optional)
 *   - Planned date (default today)
 *   - Line items (repeatable): activityType, expectedHours, ratePerHour, notes
 *   - Estimated total (read-only, auto-computed)
 *   - "Create draft" and "Create and assign" buttons
 */

import React, { useState, useMemo } from 'react';
import type { JobCardLineItem } from '../../../domain/work/JobCard';
import type { CreateJobCardRequest } from '../data/jobCardsClient';
import { createJobCard } from '../data/jobCardsClient';

interface PlotOption {
    id: string;
    name: string;
    cropCycles?: { id: string; name: string }[];
}

interface CreateJobCardSheetProps {
    farmId: string;
    /** Plots available for selection. Caller provides from their crops state. */
    plots?: PlotOption[];
    onClose: () => void;
    onCreated: () => void;
    /** When provided, chains to AssignWorkerSheet after creation */
    onAssignAfterCreate?: (jobCardId: string) => void;
}

const ACTIVITY_TYPES = [
    'Pruning', 'Irrigation', 'Spraying', 'Harvesting', 'Planting',
    'Fertilizing', 'Weeding', 'Monitoring', 'Soil work', 'Other',
];

const emptyLineItem = (): JobCardLineItem => ({
    activityType: '',
    expectedHours: 1,
    ratePerHourAmount: 0,
    ratePerHourCurrencyCode: 'INR',
    notes: '',
});

const getToday = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const CreateJobCardSheet: React.FC<CreateJobCardSheetProps> = ({
    farmId,
    plots = [],
    onClose,
    onCreated,
    onAssignAfterCreate,
}) => {
    const [plotId, setPlotId] = useState('');
    const [cropCycleId, setCropCycleId] = useState('');
    const [plannedDate, setPlannedDate] = useState(getToday());
    const [lineItems, setLineItems] = useState<JobCardLineItem[]>([emptyLineItem()]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedPlot = plots.find(p => p.id === plotId);

    const estimatedTotal = useMemo(() =>
        lineItems.reduce((sum, item) => sum + item.expectedHours * item.ratePerHourAmount, 0),
        [lineItems]
    );

    const updateLineItem = (idx: number, patch: Partial<JobCardLineItem>) => {
        setLineItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
    };

    const addLineItem = () => setLineItems(prev => [...prev, emptyLineItem()]);
    const removeLineItem = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));

    const handleCreate = async (andAssign: boolean) => {
        if (!plotId) { setError('Plot is required'); return; }
        if (lineItems.some(item => !item.activityType)) { setError('All line items need an activity type'); return; }

        setIsSaving(true);
        setError(null);

        try {
            const req: CreateJobCardRequest = {
                farmId,
                plotId,
                ...(cropCycleId ? { cropCycleId } : {}),
                plannedDate,
                lineItems: lineItems.filter(item => item.activityType),
            };
            const card = await createJobCard(req);
            onCreated();
            if (andAssign && onAssignAfterCreate) {
                onAssignAfterCreate(card.id);
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create job card');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-t-[2rem] bg-white px-5 pb-8 pt-6 shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle */}
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-stone-200" />

                <h2
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-lg font-black text-stone-900 mb-1"
                >
                    नवीन काम कार्ड
                </h2>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs text-stone-500 mb-5"
                >
                    New Job Card
                </p>

                {/* Plot picker */}
                <div className="mb-4">
                    <label
                        className="block text-xs font-bold text-stone-600 mb-1"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Plot *
                    </label>
                    {plots.length > 0 ? (
                        <select
                            value={plotId}
                            onChange={e => { setPlotId(e.target.value); setCropCycleId(''); }}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-semibold text-stone-800 bg-white"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            <option value="">Select plot...</option>
                            {plots.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            value={plotId}
                            onChange={e => setPlotId(e.target.value)}
                            placeholder="Plot ID"
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        />
                    )}
                </div>

                {/* Crop cycle picker (optional) */}
                {selectedPlot?.cropCycles && selectedPlot.cropCycles.length > 0 && (
                    <div className="mb-4">
                        <label
                            className="block text-xs font-bold text-stone-600 mb-1"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Crop Cycle (optional)
                        </label>
                        <select
                            value={cropCycleId}
                            onChange={e => setCropCycleId(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 bg-white"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            <option value="">None</option>
                            {selectedPlot.cropCycles.map(cc => (
                                <option key={cc.id} value={cc.id}>{cc.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Planned date */}
                <div className="mb-5">
                    <label
                        className="block text-xs font-bold text-stone-600 mb-1"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Planned Date
                    </label>
                    <input
                        type="date"
                        value={plannedDate}
                        onChange={e => setPlannedDate(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Line items */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <label
                            className="text-xs font-bold text-stone-600"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Work Items
                        </label>
                        <button
                            onClick={addLineItem}
                            className="text-xs font-bold text-emerald-700 rounded-lg border border-emerald-200 px-2 py-1"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            + Add
                        </button>
                    </div>

                    <div className="flex flex-col gap-3">
                        {lineItems.map((item, idx) => (
                            <div key={idx} className="rounded-xl border border-stone-200 bg-stone-50 p-3 flex flex-col gap-2">
                                {/* Activity type */}
                                <div className="flex gap-2 flex-wrap">
                                    {ACTIVITY_TYPES.map(at => (
                                        <button
                                            key={at}
                                            onClick={() => updateLineItem(idx, { activityType: at })}
                                            className={`text-[10px] font-bold rounded-full px-2.5 py-1 border transition-colors ${item.activityType === at
                                                ? 'bg-stone-800 text-white border-stone-800'
                                                : 'bg-white text-stone-600 border-stone-200'
                                                }`}
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        >
                                            {at}
                                        </button>
                                    ))}
                                </div>
                                {/* Hours + Rate */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label
                                            className="text-[10px] font-bold text-stone-500 block mb-0.5"
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        >
                                            Hours
                                        </label>
                                        <input
                                            type="number"
                                            min="0.5"
                                            step="0.5"
                                            value={item.expectedHours}
                                            onChange={e => updateLineItem(idx, { expectedHours: parseFloat(e.target.value) || 0 })}
                                            className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-800"
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="text-[10px] font-bold text-stone-500 block mb-0.5"
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        >
                                            Rate / hr (INR)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={item.ratePerHourAmount}
                                            onChange={e => updateLineItem(idx, { ratePerHourAmount: parseFloat(e.target.value) || 0 })}
                                            className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-800"
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        />
                                    </div>
                                </div>
                                {/* Notes */}
                                <input
                                    value={item.notes ?? ''}
                                    onChange={e => updateLineItem(idx, { notes: e.target.value })}
                                    placeholder="Note (optional)"
                                    className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-600"
                                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                />
                                {lineItems.length > 1 && (
                                    <button
                                        onClick={() => removeLineItem(idx)}
                                        className="text-[10px] font-semibold text-rose-500 text-right"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Estimated total */}
                <div className="rounded-xl bg-stone-100 px-4 py-3 mb-5 flex items-center justify-between">
                    <span
                        className="text-xs font-bold text-stone-500"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Estimated Total
                    </span>
                    <span
                        className="text-base font-black text-stone-900"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        INR {Math.round(estimatedTotal).toLocaleString('en-IN')}
                    </span>
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 mb-4">
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2">
                    {onAssignAfterCreate && (
                        <button
                            onClick={() => handleCreate(true)}
                            disabled={isSaving}
                            className="w-full rounded-2xl bg-stone-900 px-4 py-3.5 text-sm font-bold text-white disabled:opacity-50"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {isSaving ? 'Saving…' : 'Create and assign'}
                        </button>
                    )}
                    <button
                        onClick={() => handleCreate(false)}
                        disabled={isSaving}
                        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-sm font-bold text-stone-700 disabled:opacity-50"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {isSaving ? 'Saving…' : 'Create draft'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateJobCardSheet;
