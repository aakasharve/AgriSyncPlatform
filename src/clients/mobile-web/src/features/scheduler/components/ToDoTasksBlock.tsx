import React, { useMemo, useState } from 'react';
import { PlannedTask, CropProfile } from '../../../types';
import { Check, AlertTriangle } from 'lucide-react';

interface ToDoTasksBlockProps {
    tasks: PlannedTask[]; // Phase 2: Consumes PlannedTask[] now
    crops: CropProfile[];
    selectedCropId?: string;
    onUpdateTask: (taskId: string, updates: Partial<PlannedTask>) => void;
    onAddTask?: () => void;
}

const ToDoTasksBlock: React.FC<ToDoTasksBlockProps> = ({ tasks, crops, selectedCropId, onUpdateTask, onAddTask }) => {

    // Internal filter state (overrides global if set by user interaction here)
    const [internalFilterId, setInternalFilterId] = useState<string | null>(null);

    // 1. Filter and Process Tasks
    const allTasks = useMemo(() => {
        let filtered = tasks;

        if (selectedCropId) {
            filtered = filtered.filter(t => t.cropId === selectedCropId);
        }

        // Sort by Priority then Date Descending (Newest First)
        return filtered.sort((a, b) => {
            // Priority Sort: Urgent > High > Normal
            const pScore = (p: string) => p === 'urgent' ? 3 : p === 'high' ? 2 : 1;
            const diff = pScore(b.priority) - pScore(a.priority);
            if (diff !== 0) return diff;
            // Date Sort
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [tasks, selectedCropId]);

    // 2. Calculate Stats
    const stats = useMemo(() => {
        const total = allTasks.length;
        const resolved = allTasks.filter(t => t.status === 'done' || t.status === 'cancelled').length;
        const pending = total - resolved;

        const cropStats: Record<string, { id: string, total: number, resolved: number, pending: number, name: string, color: string }> = {};

        allTasks.forEach(task => {
            if (task.cropId) {
                const crop = crops.find(c => c.id === task.cropId);
                if (crop) {
                    if (!cropStats[crop.id]) {
                        cropStats[crop.id] = { id: crop.id, total: 0, resolved: 0, pending: 0, name: crop.name, color: crop.color };
                    }
                    cropStats[crop.id].total++;
                    if (task.status === 'done' || task.status === 'cancelled') cropStats[crop.id].resolved++;
                    else cropStats[crop.id].pending++;
                }
            }
        });

        return { total, resolved, pending, cropStats };
    }, [allTasks, crops]);

    // 3. Filtered Tasks for Display
    const displayedTasks = useMemo(() => {
        if (!internalFilterId) return allTasks;
        return allTasks.filter(t => t.cropId === internalFilterId);
    }, [allTasks, internalFilterId]);

    // 4. Group by Date (Due Date or Created Date)
    const groupedTasks = useMemo(() => {
        const grouped: Record<string, PlannedTask[]> = {};
        displayedTasks.forEach(task => {
            // Use Due Date grouping if available, else "No Date"
            let dateKey = 'No Due Date';
            if (task.dueDate) {
                const dateParams = new Date(task.dueDate);
                dateKey = dateParams.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

                // Add "Overdue" prefix if past due and not done
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (dateParams < today && task.status !== 'done' && task.status !== 'cancelled') {
                    dateKey = `OVERDUE - ${dateKey}`;
                }
            } else {
                // Or fallback to created date if needed
            }

            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(task);
        });
        return grouped;
    }, [displayedTasks]);

    if (tasks.length === 0 && !onAddTask) return null;

    // --- HANDLERS ---

    const handleToggle = (e: React.MouseEvent, task: PlannedTask) => {
        e.stopPropagation();
        const newStatus = task.status === 'done' ? 'pending' : 'done';
        onUpdateTask(task.id, {
            status: newStatus,
            completedAt: newStatus === 'done' ? new Date().toISOString() : undefined
        });
    };

    return (
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 animate-in fade-in duration-500">
            {/* 1. Header & Stats */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-800">To Do Tasks</h2>
                <div className="flex gap-2">
                    {onAddTask && (
                        <button onClick={onAddTask} className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg hover:bg-emerald-200 transition-colors">
                            + Add Task
                        </button>
                    )}
                    <div className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1.5 rounded-lg">
                        {internalFilterId ?
                            `${stats.cropStats[internalFilterId]?.pending || 0} Pending` :
                            `${stats.pending} Pending`
                        }
                    </div>
                </div>
            </div>

            {/* Scrollable Stats Row */}
            <div className="flex gap-3 overflow-x-auto pb-4 mb-2 scrollbar-hide">
                {/* Global Stat Card */}
                <button
                    onClick={() => setInternalFilterId(null)}
                    className={`
                        shrink-0 p-3 border rounded-xl min-w-[100px] text-left transition-all
                        ${!internalFilterId ? 'bg-slate-800 border-slate-700 ring-2 ring-slate-200' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'}
                    `}
                >
                    <p className={`text-[10px] uppercase font-bold mb-1 ${!internalFilterId ? 'text-slate-300' : 'text-slate-400'}`}>Total Tasks</p>
                    <div className="flex items-end gap-1">
                        <span className={`text-2xl font-bold leading-none ${!internalFilterId ? 'text-white' : 'text-slate-800'}`}>{stats.total}</span>
                        <span className="text-xs font-bold text-emerald-500 mb-0.5">{stats.resolved} done</span>
                    </div>
                </button>

                {/* Crop Stats Cards */}
                {(Object.values(stats.cropStats) as { id: string, total: number, resolved: number, pending: number, name: string, color: string }[]).map((stat) => {
                    const isActive = internalFilterId === stat.id;
                    return (
                        <button
                            key={stat.id}
                            onClick={() => setInternalFilterId(isActive ? null : stat.id)}
                            className={`
                                shrink-0 p-3 border rounded-xl min-w-[120px] shadow-sm text-left transition-all
                                ${isActive ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100' : 'bg-white border-slate-100 hover:border-emerald-200'}
                            `}
                        >
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <div className={`w-2 h-2 rounded-full ${stat.color}`} />
                                <p className="text-[10px] uppercase font-bold text-slate-400 truncate max-w-[80px]">{stat.name}</p>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xl font-bold text-slate-800 leading-none">{stat.pending}</span>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-slate-300">OPEN</span>
                                    {stat.resolved > 0 && <span className="text-[10px] font-bold text-emerald-600">+{stat.resolved} done</span>}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* 2. Task Timeline List */}
            <div className="space-y-6 max-h-[500px] overflow-y-auto pr-1">
                {/* Empty State */}
                {Object.keys(groupedTasks).length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                        No tasks found for this selection.
                    </div>
                )}

                {Object.entries(groupedTasks).map(([dateLabel, groupTasks]) => (
                    <div key={dateLabel}>
                        <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ml-1 ${dateLabel.includes('OVERDUE') ? 'text-red-400' : 'text-slate-400'}`}>
                            {dateLabel}
                        </h3>
                        <div className="space-y-3">
                            {groupTasks.map(task => {
                                const isDone = task.status === 'done';
                                const isUrgent = task.priority === 'urgent';
                                const isHigh = task.priority === 'high';

                                return (
                                    <div
                                        key={task.id}
                                        className={`group relative flex items-start gap-4 p-3 rounded-2xl border transition-all bg-white hover:border-emerald-200 hover:shadow-md ${isDone ? 'border-slate-100 opacity-60' : 'border-slate-200'
                                            }`}
                                    >
                                        {/* Status Color Bar */}
                                        <div className={`absolute top-3 bottom-0 left-0 w-1 rounded-r-full transition-colors ${isDone ? 'bg-emerald-300' :
                                            isUrgent ? 'bg-red-500 h-full' :
                                                isHigh ? 'bg-amber-500 h-full' :
                                                    'bg-slate-300 h-6'
                                            }`} />

                                        {/* Content */}
                                        <div className="flex-1 pl-2">
                                            <div className="flex items-start justify-between">
                                                <p className={`text-base font-medium leading-relaxed transition-all ${isDone ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800'}`}>
                                                    {task.title}
                                                </p>
                                                {isUrgent && !isDone && <AlertTriangle size={14} className="text-red-500 shrink-0 mt-1" />}
                                            </div>

                                            {/* Metadata */}
                                            <div className="flex items-center gap-3 mt-1.5">
                                                {task.cropId && (
                                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                                                        {crops.find(c => c.id === task.cropId)?.name}
                                                    </span>
                                                )}

                                                {isDone && task.completedAt && (
                                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                                        Done
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Checkbox Action */}
                                        <button
                                            onClick={(e) => handleToggle(e, task)}
                                            className={`
                                                shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300
                                                ${isDone ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-white border-slate-300 text-transparent hover:border-emerald-300'}
                                            `}
                                        >
                                            <Check size={16} strokeWidth={3} className={`transition-transform duration-300 ${isDone ? 'scale-100' : 'scale-0'}`} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ToDoTasksBlock;
