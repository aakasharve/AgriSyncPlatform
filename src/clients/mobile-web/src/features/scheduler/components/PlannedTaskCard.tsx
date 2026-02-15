/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PlannedTaskCard - Phase 2 + Phase 3
 * Displays planned tasks with lifecycle management
 */

import React, { useState } from 'react';
import { CheckCircle2, Circle, Calendar, AlertCircle, MoreVertical, Edit2, Trash2, Clock } from 'lucide-react';
import { PlannedTask } from '../../../types';

interface PlannedTaskCardProps {
    task: PlannedTask;
    cropName?: string;
    plotName?: string;
    plotColor?: string;
    onToggleStatus: (taskId: string) => void;
    onViewSource?: (noteId: string) => void;
    onSnooze?: (taskId: string, days: number) => void;  // Phase 3
    onEdit?: (taskId: string, updates: Partial<PlannedTask>) => void;  // Phase 3
    onDelete?: (taskId: string) => void;  // Phase 3
}

const PlannedTaskCard: React.FC<PlannedTaskCardProps> = ({
    task,
    cropName,
    plotName,
    plotColor,
    onToggleStatus,
    onViewSource,
    onSnooze,
    onEdit,
    onDelete
}) => {

    const [showActions, setShowActions] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(task.title);

    const isDone = task.status === 'done';
    const isHighPriority = task.priority === 'high';

    // Format due date
    const formatDueDate = (dateStr?: string): string => {
        if (!dateStr) return 'No date';

        const date = new Date(dateStr);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        today.setHours(0, 0, 0, 0);
        tomorrow.setHours(0, 0, 0, 0);
        date.setHours(0, 0, 0, 0);

        if (date.getTime() === today.getTime()) return 'Today';
        if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

        const diffTime = date.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 7) {
            return `In ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
        }

        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    };

    // Check if overdue
    const isOverdue = (): boolean => {
        if (!task.dueDate || isDone) return false;
        const dueDate = new Date(task.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate < today;
    };

    const overdue = isOverdue();

    return (
        <div
            className={`
        border-2 rounded-xl p-4 transition-all
        ${isDone
                    ? 'bg-stone-50 border-stone-200 opacity-60'
                    : isHighPriority
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-white border-stone-200 hover:border-emerald-300 hover:shadow-md'
                }
      `}
        >
            <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                    onClick={() => onToggleStatus(task.id)}
                    className="flex-shrink-0 mt-0.5 transition-transform active:scale-90"
                >
                    {isDone ? (
                        <CheckCircle2 className="text-emerald-600" size={24} />
                    ) : (
                        <Circle className={isHighPriority ? 'text-amber-600' : 'text-stone-400'} size={24} />
                    )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {/* Title or Edit Mode */}
                    {isEditing && onEdit ? (
                        <div className="space-y-2 mb-2">
                            <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full px-3 py-2 border-2 border-emerald-500 rounded-lg text-sm font-bold focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        onEdit(task.id, { title: editTitle });
                                        setIsEditing(false);
                                    }
                                    if (e.key === 'Escape') {
                                        setEditTitle(task.title);
                                        setIsEditing(false);
                                    }
                                }}
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        onEdit(task.id, { title: editTitle });
                                        setIsEditing(false);
                                    }}
                                    className="px-3 py-1 bg-emerald-600 text-white text-xs font-bold rounded-md hover:bg-emerald-700"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => {
                                        setEditTitle(task.title);
                                        setIsEditing(false);
                                    }}
                                    className="px-3 py-1 bg-stone-200 text-stone-700 text-xs font-bold rounded-md hover:bg-stone-300"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <h4 className={`
              font-bold text-base mb-2
              ${isDone ? 'line-through text-stone-500' : 'text-stone-800'}
            `}>
                            {task.title}
                        </h4>
                    )}

                    {/* Metadata Row */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        {/* Plot & Crop */}
                        {(plotName || cropName) && (
                            <div className="flex items-center gap-1.5">
                                {plotColor && <span className={`w-2 h-2 rounded-full ${plotColor}`} />}
                                <span className="font-medium text-stone-600">
                                    {cropName && plotName ? `${cropName} • ${plotName}` : cropName || plotName}
                                </span>
                            </div>
                        )}

                        {/* Due Date */}
                        {task.dueDate && (
                            <div className={`
                flex items-center gap-1 px-2 py-0.5 rounded-full font-medium
                ${overdue
                                    ? 'bg-red-100 text-red-700'
                                    : isDone
                                        ? 'bg-stone-100 text-stone-500'
                                        : 'bg-blue-50 text-blue-700'
                                }
              `}>
                                <Calendar size={12} />
                                <span>{formatDueDate(task.dueDate)}</span>
                                {overdue && <AlertCircle size={12} />}
                            </div>
                        )}

                        {/* Priority Badge */}
                        {isHighPriority && !isDone && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold text-[10px] uppercase">
                                High Priority
                            </span>
                        )}
                    </div>

                    {/* View Source Link */}
                    {task.sourceObservationId && onViewSource && !isDone && (
                        <button
                            onClick={() => onViewSource(task.sourceObservationId!)}
                            className="mt-2 text-xs text-emerald-600 hover:text-emerald-700 font-medium underline"
                        >
                            View source observation
                        </button>
                    )}

                    {/* Completed timestamp */}
                    {isDone && task.completedAt && (
                        <div className="mt-2 text-[10px] text-stone-400">
                            Completed on {new Date(task.completedAt).toLocaleDateString('en-IN')}
                        </div>
                    )}
                </div>

                {/* Phase 3: Action Menu */}
                {!isDone && (onSnooze || onEdit || onDelete) && (
                    <div className="relative flex-shrink-0">
                        <button
                            onClick={() => setShowActions(!showActions)}
                            className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center transition-colors"
                        >
                            <MoreVertical size={16} className="text-stone-400" />
                        </button>

                        {showActions && (
                            <>
                                {/* Backdrop */}
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowActions(false)}
                                />

                                {/* Menu */}
                                <div className="absolute right-0 top-10 bg-white border-2 border-stone-200 rounded-xl shadow-xl z-20 min-w-[160px] overflow-hidden">
                                    {onSnooze && (
                                        <>
                                            <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-200">
                                                <span className="text-[10px] font-bold text-stone-500 uppercase">Snooze</span>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    onSnooze(task.id, 1);
                                                    setShowActions(false);
                                                }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
                                            >
                                                <Clock size={14} className="text-blue-600" />
                                                +1 day
                                            </button>
                                            <button
                                                onClick={() => {
                                                    onSnooze(task.id, 3);
                                                    setShowActions(false);
                                                }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
                                            >
                                                <Clock size={14} className="text-blue-600" />
                                                +3 days
                                            </button>
                                            <button
                                                onClick={() => {
                                                    onSnooze(task.id, 7);
                                                    setShowActions(false);
                                                }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2 border-b border-stone-200"
                                            >
                                                <Clock size={14} className="text-blue-600" />
                                                +1 week
                                            </button>
                                        </>
                                    )}

                                    {onEdit && (
                                        <button
                                            onClick={() => {
                                                setIsEditing(true);
                                                setShowActions(false);
                                            }}
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2"
                                        >
                                            <Edit2 size={14} className="text-emerald-600" />
                                            Edit
                                        </button>
                                    )}

                                    {onDelete && (
                                        <button
                                            onClick={() => {
                                                if (confirm('Delete this task?')) {
                                                    onDelete(task.id);
                                                }
                                                setShowActions(false);
                                            }}
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 flex items-center gap-2 text-red-700"
                                        >
                                            <Trash2 size={14} />
                                            Delete
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PlannedTaskCard;
