import React, { useState } from 'react';

interface CloneTemplateSheetProps {
    isOpen: boolean;
    onClose: () => void;
    sourceName: string;
    sourceVersion?: number;
    onClone: (newName: string, scope: 'Private', reason: string) => void;
}

const CloneTemplateSheet: React.FC<CloneTemplateSheetProps> = ({
    isOpen,
    onClose,
    sourceName,
    sourceVersion,
    onClone,
}) => {
    const [newName, setNewName] = useState(`${sourceName} (my copy)`);
    const [reason, setReason] = useState('');

    if (!isOpen) return null;

    const handleClone = () => {
        if (!newName.trim() || !reason.trim()) return;
        onClone(newName.trim(), 'Private', reason.trim());
    };

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
                    Clone Schedule
                </h2>
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-sm text-stone-400 mb-5"
                >
                    Source: <span className="font-semibold text-stone-600">{sourceName}</span>
                    {sourceVersion != null && (
                        <span className="ml-1 text-stone-400">v{sourceVersion}</span>
                    )}
                </p>

                {/* New name */}
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

                {/* Scope selector */}
                <div className="mb-4">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Scope
                    </label>
                    <div className="flex gap-2">
                        {/* Private — enabled */}
                        <label className="flex items-center gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-3 py-2 cursor-pointer">
                            <input type="radio" name="scope" value="Private" defaultChecked readOnly className="accent-emerald-600" />
                            <span
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-sm font-semibold text-emerald-700"
                            >
                                Private
                            </span>
                        </label>

                        {/* Team — disabled */}
                        <div
                            className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 opacity-50 cursor-not-allowed"
                            title="Team scope is not yet available"
                        >
                            <input type="radio" disabled className="accent-stone-400" />
                            <span
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-sm font-semibold text-stone-400"
                            >
                                Team
                            </span>
                        </div>

                        {/* Licensed — disabled */}
                        <div
                            className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 opacity-50 cursor-not-allowed"
                            title="Licensed scope is not yet available"
                        >
                            <input type="radio" disabled className="accent-stone-400" />
                            <span
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-sm font-semibold text-stone-400"
                            >
                                Licensed
                            </span>
                        </div>
                    </div>
                </div>

                {/* Reason */}
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
                        placeholder="Why are you cloning this schedule?"
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Actions */}
                <button
                    onClick={handleClone}
                    disabled={!newName.trim() || !reason.trim()}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed active:bg-emerald-700 transition-colors mb-3"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Clone Schedule
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

export default CloneTemplateSheet;
