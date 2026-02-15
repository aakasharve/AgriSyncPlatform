/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { PlannedTask, CropProfile, Plot, Person } from '../../../types';
import { X, Calendar, Check, AlertTriangle, Clock, Tag, User } from 'lucide-react';
import { getDateKey } from '../../../domain/system/DateKeyService';

interface TaskCreationSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (task: PlannedTask) => void;
    crops: CropProfile[];
    selectedCropId?: string;
    selectedPlotId?: string;
    defaultDate?: string; // YYYY-MM-DD
    people?: Person[]; // NEW: Layer 3
}

type Priority = 'normal' | 'high' | 'urgent';

const TaskCreationSheet: React.FC<TaskCreationSheetProps> = ({
    isOpen,
    onClose,
    onSave,
    crops,
    selectedCropId,
    selectedPlotId,
    defaultDate,
    people = []
}) => {
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState<Priority>('normal');
    const [dueDate, setDueDate] = useState<string>(defaultDate || 'tomorrow'); // 'today', 'tomorrow', 'next_week', 'no_date'
    const [assigneeId, setAssigneeId] = useState<string>('');

    if (!isOpen) return null;

    const currentCrop = crops.find(c => c.id === selectedCropId);

    const calculateDate = (key: string): string | undefined => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (key === 'today') return getDateKey(today);
        if (key === 'tomorrow') {
            const d = new Date(today);
            d.setDate(d.getDate() + 1);
            return getDateKey(d);
        }
        if (key === 'next_week') {
            const d = new Date(today);
            d.setDate(d.getDate() + 7);
            return getDateKey(d);
        }
        return undefined; // no_date
    };

    const handleSave = () => {
        if (!title.trim()) return;

        const newTask: PlannedTask = {
            id: crypto.randomUUID(),
            title: title.trim(),
            plotId: selectedPlotId || 'unknown_plot', // Fallback, practically required
            cropId: selectedCropId,
            priority: priority,
            status: 'pending',
            sourceType: 'manual',
            dueDate: calculateDate(dueDate),
            assigneeId: assigneeId || undefined,
            createdAt: new Date().toISOString(),
            tags: []
        };

        onSave(newTask);

        // Reset and close
        setTitle('');
        setPriority('normal');
        setDueDate('tomorrow');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-md rounded-t-[32px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">

                {/* HEADER */}
                <div className="px-6 py-5 flex items-center justify-between border-b border-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Add New Task</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                            {currentCrop?.name || 'Farm'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 bg-slate-50 rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* CONTENT */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">

                    {/* Task Title Input */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">
                            What needs to be done?
                        </label>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-50 transition-all">
                            <textarea
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="E.g., Spray fungicide on Row 4..."
                                className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 text-lg font-medium leading-relaxed resize-none outline-none min-h-[80px]"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Assignee Selector (Layer 3) */}
                    {people.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Example: Assign to</label>
                            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                                <button
                                    onClick={() => setAssigneeId('')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-all whitespace-nowrap ${!assigneeId ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'
                                        }`}
                                >
                                    <User size={14} />
                                    Anyone
                                </button>
                                {people.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setAssigneeId(assigneeId === p.id ? '' : p.id)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-all whitespace-nowrap ${assigneeId === p.id
                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200 ring-2 ring-emerald-500/20'
                                            : 'bg-white text-slate-600 border-slate-200'
                                            }`}
                                    >
                                        <div className="w-4 h-4 rounded-full bg-emerald-200 text-[8px] flex items-center justify-center text-emerald-800 uppercase">
                                            {p.name.charAt(0)}
                                        </div>
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Priority Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Priority</label>
                        <div className="flex gap-2">
                            {(['normal', 'high', 'urgent'] as Priority[]).map(level => {
                                const isSelected = priority === level;
                                return (
                                    <button
                                        key={level}
                                        onClick={() => setPriority(level)}
                                        className={`flex-1 py-3 rounded-xl text-sm font-bold capitalize transition-all border-2 ${isSelected
                                            ? level === 'urgent'
                                                ? 'bg-red-50 border-red-500 text-red-700'
                                                : level === 'high'
                                                    ? 'bg-amber-50 border-amber-500 text-amber-700'
                                                    : 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                            : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                                            }`}
                                    >
                                        <div className="flex items-center justify-center gap-1.5">
                                            {level === 'urgent' && <AlertTriangle size={14} />}
                                            {level}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Due Date Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">When is it due?</label>
                        <div className="grid grid-cols-2 gap-2">
                            {['today', 'tomorrow', 'next_week', 'no_date'].map(opt => {
                                const isSelected = dueDate === opt;
                                const label = opt.replace('_', ' ');
                                return (
                                    <button
                                        key={opt}
                                        onClick={() => setDueDate(opt)}
                                        className={`px-4 py-3 rounded-xl text-sm font-bold capitalize transition-all border ${isSelected
                                            ? 'bg-slate-800 border-slate-800 text-white shadow-md'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                            }`}
                                    >
                                        <div className="flex items-center justify-center gap-2">
                                            {opt !== 'no_date' && <Calendar size={14} />}
                                            {label}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="p-6 pt-0 mt-auto bg-gradient-to-t from-white via-white to-transparent">
                    <button
                        onClick={handleSave}
                        disabled={!title.trim()}
                        className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 ${title.trim()
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200/50'
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <Check size={20} />
                        Create Task
                    </button>
                </div>

            </div>
        </div >
    );
};

export default TaskCreationSheet;
