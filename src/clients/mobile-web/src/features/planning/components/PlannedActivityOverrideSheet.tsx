import React, { useState } from 'react';

export type OverrideAction = 'shift_date' | 'rename' | 'restage' | 'remove';

interface PlannedActivityOverrideSheetProps {
    isOpen: boolean;
    onClose: () => void;
    activityName: string;
    plannedDate: string;
    onSave: (action: OverrideAction, payload: Record<string, string>, reason: string) => void;
}

const ACTION_OPTIONS: { value: OverrideAction; labelEn: string; labelMr: string }[] = [
    { value: 'shift_date', labelEn: 'Shift date', labelMr: 'तारीख बदल' },
    { value: 'rename',     labelEn: 'Rename',     labelMr: 'नाव बदल' },
    { value: 'restage',    labelEn: 'Restage',    labelMr: 'स्टेज बदल' },
    { value: 'remove',     labelEn: 'Remove',     labelMr: 'हटवा' },
];

const PlannedActivityOverrideSheet: React.FC<PlannedActivityOverrideSheetProps> = ({
    isOpen,
    onClose,
    activityName,
    plannedDate,
    onSave,
}) => {
    const [action, setAction] = useState<OverrideAction>('shift_date');
    const [newDate, setNewDate] = useState(plannedDate);
    const [newName, setNewName] = useState(activityName);
    const [newStage, setNewStage] = useState('');
    const [reason, setReason] = useState('');

    if (!isOpen) return null;

    const handleSave = () => {
        if (!reason.trim()) return;

        const payload: Record<string, string> = {};
        if (action === 'shift_date') payload['newDate'] = newDate;
        if (action === 'rename') payload['newName'] = newName;
        if (action === 'restage') payload['newStage'] = newStage;

        onSave(action, payload, reason.trim());
    };

    const formattedDate = (() => {
        try {
            return new Date(plannedDate).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric'
            });
        } catch {
            return plannedDate;
        }
    })();

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="relative bg-white rounded-t-3xl px-5 pt-5 pb-8 shadow-xl max-h-[85vh] overflow-y-auto">
                {/* Handle */}
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-200" />

                <h2
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-lg font-bold text-stone-800 mb-1"
                >
                    Override Activity
                </h2>

                {/* Activity summary */}
                <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-sm font-semibold text-stone-700"
                    >
                        {activityName}
                    </p>
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs text-stone-400 mt-0.5"
                    >
                        Planned: {formattedDate}
                    </p>
                </div>

                {/* Action selector */}
                <div className="mb-4">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Action
                    </label>
                    <div className="flex flex-col gap-2">
                        {ACTION_OPTIONS.map(opt => (
                            <label
                                key={opt.value}
                                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                                    action === opt.value
                                        ? 'border-emerald-300 bg-emerald-50'
                                        : 'border-stone-200 bg-white'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="override-action"
                                    value={opt.value}
                                    checked={action === opt.value}
                                    onChange={() => setAction(opt.value)}
                                    className="accent-emerald-600 flex-shrink-0"
                                />
                                <div>
                                    <p
                                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        className="text-sm font-medium text-stone-800"
                                    >
                                        {opt.labelMr}
                                    </p>
                                    <p
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                        className="text-xs text-stone-400"
                                    >
                                        {opt.labelEn}
                                    </p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Dependent fields */}
                {action === 'shift_date' && (
                    <div className="mb-4">
                        <label
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                        >
                            New date
                        </label>
                        <input
                            type="date"
                            value={newDate}
                            onChange={e => setNewDate(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        />
                    </div>
                )}

                {action === 'rename' && (
                    <div className="mb-4">
                        <label
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                        >
                            New name
                        </label>
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        />
                    </div>
                )}

                {action === 'restage' && (
                    <div className="mb-4">
                        <label
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                        >
                            New stage
                        </label>
                        <input
                            type="text"
                            value={newStage}
                            onChange={e => setNewStage(e.target.value)}
                            placeholder="e.g. Flowering"
                            className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        />
                    </div>
                )}

                {/* Reason — always required */}
                <div className="mb-6">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Reason <span className="text-rose-400">*</span>
                    </label>
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        rows={3}
                        placeholder="Why are you making this change?"
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Actions */}
                <button
                    onClick={handleSave}
                    disabled={!reason.trim()}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed active:bg-emerald-700 transition-colors mb-3"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Save
                </button>
                <button
                    onClick={onClose}
                    className="w-full text-center text-sm font-semibold text-stone-400 py-1"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default PlannedActivityOverrideSheet;
