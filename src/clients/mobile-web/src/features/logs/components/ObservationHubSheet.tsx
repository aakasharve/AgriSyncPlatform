import React, { useState } from 'react';
import { ObservationNote, CropProfile } from '../../../types';
import { X, Mic, Send, AlertCircle, Calendar, Tag, CheckSquare, Plus, Check, Clock, StickyNote, Bell, AlertTriangle } from 'lucide-react';

interface ObservationHubSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (note: ObservationNote) => void;
    existingNotes: ObservationNote[];
    crops: CropProfile[];
    selectedCropId?: string;
    selectedPlotId?: string;
    selectedDate: string;
    initialType?: 'observation' | 'reminder';
}

const ObservationHubSheet: React.FC<ObservationHubSheetProps> = ({
    isOpen,
    onClose,
    onSave,
    existingNotes,
    crops,
    selectedCropId,
    selectedPlotId,
    selectedDate,
    initialType = 'observation'
}) => {
    const [inputText, setInputText] = useState('');
    const [type, setType] = useState<'observation' | 'reminder'>(initialType);

    if (!isOpen) return null;

    const currentCrop = crops.find(c => c.id === selectedCropId);

    // --- LOGIC ---

    const handleSave = () => {
        if (!inputText.trim()) return;

        const newNote: ObservationNote = {
            id: crypto.randomUUID(),
            plotId: selectedPlotId || 'unknown_plot',
            cropId: selectedCropId,
            dateKey: selectedDate,
            timestamp: new Date().toISOString(),
            textRaw: inputText,
            textCleaned: inputText,
            noteType: type,
            severity: 'normal',
            source: 'manual',
            aiConfidence: 100
        };

        onSave(newNote);
        setInputText('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-md h-[50vh] rounded-t-[32px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">

                {/* HEADER */}
                <div className="px-6 py-5 flex items-center justify-between border-b border-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Add {type === 'reminder' ? 'Reminder' : 'Observation'}</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                            {selectedDate} • {currentCrop?.name || 'Farm'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-slate-50 rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* CONTENT AREA */}
                <div className="flex-1 overflow-y-auto px-6 py-6">

                    <div className="animate-in fade-in slide-in-from-left-4 duration-300 space-y-4">
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-50 transition-all">
                            <textarea
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                placeholder={type === 'reminder' ? "What do you need to be reminded of?" : "Record crop growth, noticeable issues, or general log notes..."}
                                className="w-full bg-transparent text-slate-800 placeholder:text-slate-400 text-base leading-relaxed resize-none outline-none min-h-[160px]"
                                autoFocus
                            />
                            <div className="flex justify-end mt-2">
                                <div className="p-2 bg-white rounded-full text-slate-400 shadow-sm border border-slate-100">
                                    <Mic size={18} />
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={!inputText.trim()}
                            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg shadow-emerald-200/50 flex items-center justify-center gap-2 transition-all active:scale-95 ${inputText.trim()
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                } `}
                        >
                            <Check size={20} />
                            Save {type === 'reminder' ? 'Reminder' : 'Observation'}
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ObservationHubSheet;
