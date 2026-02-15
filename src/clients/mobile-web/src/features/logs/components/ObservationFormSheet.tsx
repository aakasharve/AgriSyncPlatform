/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { ObservationNote, ObservationNoteType, ObservationSeverity } from '../../../types';
import { getDateKey } from '../../../domain/system/DateKeyService';

interface ObservationFormSheetProps {
    onSave: (observation: Partial<ObservationNote>) => void;
    onClose: () => void;
}

const ObservationFormSheet: React.FC<ObservationFormSheetProps> = ({ onSave, onClose }) => {
    const [text, setText] = useState('');
    const [noteType, setNoteType] = useState<ObservationNoteType>('observation');
    const [severity, setSeverity] = useState<ObservationSeverity>('normal');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!text.trim()) {
            return;
        }

        onSave({
            textRaw: text.trim(),
            noteType,
            severity,
            source: 'manual',
            timestamp: new Date().toISOString(),
            dateKey: getDateKey()
        });

        // Reset form
        setText('');
        setNoteType('observation');
        setSeverity('normal');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center animate-in fade-in">
            <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom sm:slide-in-from-bottom-0">

                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-stone-100 p-4 sm:p-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center">
                            <MessageSquare size={20} className="text-stone-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-stone-800">Add Observation</h3>
                            <p className="text-xs text-stone-500">Any important info / reminder / issue</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center transition-colors"
                    >
                        <X size={20} className="text-stone-400" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">

                    {/* Main Text Input */}
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-2">
                            What did you notice? <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Example: Leaf curl noticed on row 3, wind damage on canopy, pump making noise..."
                            className="w-full px-4 py-3 border-2 border-stone-200 rounded-xl focus:border-emerald-500 focus:outline-none resize-none text-stone-800 placeholder:text-stone-400"
                            rows={4}
                            required
                            autoFocus
                        />
                        <p className="text-xs text-stone-400 mt-1">
                            Write anything important - It will be organized automatically
                        </p>
                    </div>

                    {/* Note Type (Optional) */}
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-2">
                            Type (optional)
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {(['observation', 'issue', 'tip', 'reminder'] as ObservationNoteType[]).map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setNoteType(type)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${noteType === type
                                        ? 'bg-emerald-600 text-white shadow-md'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                >
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Severity (Optional) */}
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-2">
                            Severity (optional)
                        </label>
                        <div className="flex gap-2">
                            {(['normal', 'important', 'urgent'] as ObservationSeverity[]).map((sev) => (
                                <button
                                    key={sev}
                                    type="button"
                                    onClick={() => setSeverity(sev)}
                                    className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all ${severity === sev
                                        ? sev === 'urgent'
                                            ? 'bg-red-600 text-white shadow-md'
                                            : sev === 'important'
                                                ? 'bg-amber-600 text-white shadow-md'
                                                : 'bg-stone-600 text-white shadow-md'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                >
                                    {sev.charAt(0).toUpperCase() + sev.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-6 py-3 bg-stone-100 text-stone-700 rounded-xl font-bold hover:bg-stone-200 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!text.trim()}
                            className="flex-1 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-200 disabled:shadow-none"
                        >
                            Save Note
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
};

export default ObservationFormSheet;
