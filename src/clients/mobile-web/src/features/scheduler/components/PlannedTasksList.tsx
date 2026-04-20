/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { ClipboardList, Calendar, Inbox } from 'lucide-react';
import PlannedTaskCard from './PlannedTaskCard';
import { PlannedTask, CropProfile } from '../../../types';

interface PlannedTasksListProps {
    tasks: PlannedTask[];
    crops?: CropProfile[];
    selectedPlotId?: string;  // For filtering
    onToggleTaskStatus: (taskId: string) => void;
    onViewSource?: (noteId: string) => void;
}

interface GroupedTasks {
    today: PlannedTask[];
    next7Days: PlannedTask[];
    later: PlannedTask[];
    noDate: PlannedTask[];
    completed: PlannedTask[];
}

const PlannedTasksList: React.FC<PlannedTasksListProps> = ({
    tasks,
    crops = [],
    selectedPlotId,
    onToggleTaskStatus,
    onViewSource
}) => {

    // Filter and group tasks
    const { filteredTasks, groupedTasks } = useMemo(() => {
        // Filter by plot if specified
        const filtered = selectedPlotId
            ? tasks.filter(t => t.plotId === selectedPlotId)
            : tasks;

        // Group by date
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const in7Days = new Date(today);
        in7Days.setDate(today.getDate() + 7);

        const grouped: GroupedTasks = {
            today: [],
            next7Days: [],
            later: [],
            noDate: [],
            completed: []
        };

        filtered.forEach(task => {
            // Completed tasks go to separate section
            if (task.status === 'done') {
                grouped.completed.push(task);
                return;
            }

            // No date
            if (!task.dueDate) {
                grouped.noDate.push(task);
                return;
            }

            const dueDate = new Date(task.dueDate);
            dueDate.setHours(0, 0, 0, 0);

            // Today
            if (dueDate.getTime() === today.getTime()) {
                grouped.today.push(task);
            }
            // Next 7 days
            else if (dueDate > today && dueDate <= in7Days) {
                grouped.next7Days.push(task);
            }
            // Later
            else if (dueDate > in7Days) {
                grouped.later.push(task);
            }
            // Overdue (treat as today)
            else {
                grouped.today.push(task);
            }
        });

        return { filteredTasks: filtered, groupedTasks: grouped };
    }, [tasks, selectedPlotId]);

    // Get crop/plot info for a task
    const getTaskContext = (task: PlannedTask) => {
        if (!task.cropId) return {};

        const crop = crops.find(item => item.id === task.cropId);
        if (!crop) return {};

        const plot = crop.plots.find(p => p.id === task.plotId);

        return {
            cropName: crop.name,
            plotName: plot?.name,
            plotColor: crop.color
        };
    };

    // Render a group section
    const renderGroup = (title: string, tasks: PlannedTask[], icon: React.ReactNode, emptyMessage: string) => {
        if (tasks.length === 0) return null;

        return (
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-3 px-1">
                    <div className="text-stone-400">{icon}</div>
                    <h3 className="text-sm font-bold text-stone-600 uppercase tracking-wide">
                        {title}
                    </h3>
                    <span className="text-xs font-bold text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">
                        {tasks.length}
                    </span>
                </div>

                <div className="space-y-2">
                    {tasks.map(task => {
                        const context = getTaskContext(task);
                        return (
                            <PlannedTaskCard
                                key={task.id}
                                task={task}
                                {...context}
                                onToggleStatus={onToggleTaskStatus}
                                onViewSource={onViewSource}
                            />
                        );
                    })}
                </div>
            </div>
        );
    };

    // Empty state
    if (filteredTasks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4">
                    <ClipboardList className="text-stone-400" size={32} />
                </div>
                <h3 className="text-lg font-bold text-stone-700 mb-2">No Planned Tasks</h3>
                <p className="text-sm text-stone-500 max-w-xs">
                    Tasks will appear here when you create observations with planning intent
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-6">
            {/* Today (including overdue) */}
            {renderGroup(
                'Today',
                groupedTasks.today,
                <Calendar size={16} />,
                'No tasks due today'
            )}

            {/* Next 7 Days */}
            {renderGroup(
                'Next 7 Days',
                groupedTasks.next7Days,
                <Calendar size={16} />,
                'No upcoming tasks'
            )}

            {/* Later */}
            {renderGroup(
                'Later',
                groupedTasks.later,
                <Calendar size={16} />,
                'No tasks scheduled for later'
            )}

            {/* No Date */}
            {renderGroup(
                'No Date',
                groupedTasks.noDate,
                <Inbox size={16} />,
                'All tasks have dates'
            )}

            {/* Completed */}
            {groupedTasks.completed.length > 0 && (
                <details className="mt-6">
                    <summary className="cursor-pointer text-sm font-bold text-stone-500 uppercase tracking-wide px-1 py-2 hover:text-stone-700">
                        Completed ({groupedTasks.completed.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                        {groupedTasks.completed.map(task => {
                            const context = getTaskContext(task);
                            return (
                                <PlannedTaskCard
                                    key={task.id}
                                    task={task}
                                    {...context}
                                    onToggleStatus={onToggleTaskStatus}
                                    onViewSource={onViewSource}
                                />
                            );
                        })}
                    </div>
                </details>
            )}
        </div>
    );
};

export default PlannedTasksList;
