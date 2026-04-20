import React, { useState } from 'react';

interface EditTemplateSheetProps {
    isOpen: boolean;
    onClose: () => void;
    currentName: string;
    currentStage?: string;
    currentCropType?: string;
    currentVersion?: number;
    onSave: (updatedName: string, updatedStage: string, updatedCropType: string) => void;
}

const EditTemplateSheet: React.FC<EditTemplateSheetProps> = ({
    isOpen,
    onClose,
    currentName,
    currentStage = '',
    currentCropType = '',
    currentVersion,
    onSave,
}) => {
    const [name, setName] = useState(currentName);
    const [stage, setStage] = useState(currentStage);
    const [cropType, setCropType] = useState(currentCropType);

    if (!isOpen) return null;

    const nextVersion = (currentVersion ?? 1) + 1;

    const handleSave = () => {
        if (!name.trim()) return;
        onSave(name.trim(), stage.trim(), cropType.trim());
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
                    Edit Schedule
                </h2>

                {/* Info banner */}
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xs text-amber-700 font-medium"
                    >
                        Editing creates a new version. Previous version stays read-only.
                    </p>
                </div>

                {/* Name */}
                <div className="mb-4">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Stage */}
                <div className="mb-4">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Stage
                    </label>
                    <input
                        type="text"
                        value={stage}
                        onChange={e => setStage(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Crop Type */}
                <div className="mb-6">
                    <label
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="block text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide"
                    >
                        Crop Type
                    </label>
                    <input
                        type="text"
                        value={cropType}
                        onChange={e => setCropType(e.target.value)}
                        className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-emerald-300"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    />
                </div>

                {/* Actions */}
                <button
                    onClick={handleSave}
                    disabled={!name.trim()}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed active:bg-emerald-700 transition-colors mb-3"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Save as v{nextVersion}
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

export default EditTemplateSheet;
