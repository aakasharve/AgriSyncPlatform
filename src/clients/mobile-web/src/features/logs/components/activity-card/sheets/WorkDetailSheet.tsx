/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ListPlus, X, Zap } from 'lucide-react';
import Button from '../../../../../shared/components/ui/Button';
import IssueFormSheet from '../../IssueFormSheet';
import { BucketIssue } from '../../../../../domain/types/log.types';

const WorkDetailSheet = ({
    workTypes,
    onSave,
    onClose,
    availableActivities,
    sourceText,
    systemInterpretation,
    initialIssue
}: {
    workTypes: string[],
    onSave: (types: string[], issue?: BucketIssue) => void,
    onClose: () => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    availableActivities?: any[], // WorkflowStep[] technically
    sourceText?: string,
    systemInterpretation?: string,
    initialIssue?: BucketIssue
}) => {
    const [selected, setSelected] = useState<string[]>(workTypes || []);
    const [custom, setCustom] = useState('');
    const [issue, setIssue] = useState<BucketIssue | undefined>(initialIssue);
    const [showIssueSheet, setShowIssueSheet] = useState(false);

    const toggle = (name: string) => {
        if (selected.includes(name)) setSelected(selected.filter(s => s !== name));
        else setSelected([...selected, name]);
    };

    const addCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (custom.trim() && !selected.includes(custom.trim())) {
            setSelected([...selected, custom.trim()]);
            setCustom('');
        }
    };

    const suggested = availableActivities?.filter(a => a.type === 'activity').map(a => a.name) || [];
    // Combine suggested with currently selected to show all
    const allOptions = Array.from(new Set([...suggested, ...selected]));

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose} />
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                        <ListPlus size={20} className="text-emerald-500" />
                        Work Done
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Issue Button */}
                        <button
                            onClick={() => setShowIssueSheet(true)}
                            className={`p-2 rounded-full transition-colors ${issue
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                                }`}
                        >
                            <AlertTriangle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={18} /></button>
                    </div>
                </div>

                <div className="space-y-4 mb-6 max-h-[60vh] overflow-y-auto pr-1">
                    {/* NEW: Transparency Feedback inside Sheet */}
                    {(sourceText || systemInterpretation) && (
                        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-4 animate-in fade-in slide-in-from-top-2">
                            {sourceText && (
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5 whitespace-nowrap">YOU SAID:</span>
                                    <p className="text-xs font-medium text-slate-600 italic">"{sourceText}"</p>
                                </div>
                            )}
                            {systemInterpretation && (
                                <div className="flex items-start gap-2 bg-emerald-100/30 p-2 rounded-xl border border-emerald-50">
                                    <div className="mt-0.5 text-emerald-500">
                                        <Zap size={10} fill="currentColor" />
                                    </div>
                                    <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                                        {systemInterpretation}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    <p className="text-sm text-slate-500">Select activities performed today:</p>

                    <div className="flex flex-wrap gap-2">
                        {allOptions.map(opt => (
                            <button
                                key={opt}
                                onClick={() => toggle(opt)}
                                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${selected.includes(opt)
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200'}`}
                            >
                                {opt}
                                {selected.includes(opt) && <Check size={14} className="inline ml-1.5" />}
                            </button>
                        ))}
                    </div>

                    <form onSubmit={addCustom} className="flex gap-2 pt-2">
                        <input
                            className="flex-1 p-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-500"
                            placeholder="Add other activity..."
                            value={custom}
                            onChange={e => setCustom(e.target.value)}
                        />
                        <button disabled={!custom.trim()} className="bg-slate-800 text-white px-4 rounded-lg font-bold text-sm disabled:opacity-50">Add</button>
                    </form>
                </div>

                <Button onClick={() => { onSave(selected, issue); onClose(); }} className="w-full py-4 shadow-lg">
                    Save Work Details
                </Button>
            </div>

            {/* Issue Form Sheet */}
            <IssueFormSheet
                isOpen={showIssueSheet}
                onClose={() => setShowIssueSheet(false)}
                onSave={(newIssue) => {
                    setIssue(newIssue);
                    setShowIssueSheet(false);
                }}
                initialData={issue}
                bucketType="crop_activity"
            />
        </div>,
        document.body
    );
};

export default WorkDetailSheet;
