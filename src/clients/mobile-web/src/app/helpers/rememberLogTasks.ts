/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-78 = 1, D-29) - what the phone does with the planned items of
 * the logs it has just saved.
 *
 *   - Real app: they are the speaker's OWN reminders on the server (the server makes them in the same save as the log), and this phone
 *     shows each at once under the id the server will give it, in the `plannedWork` store the one list reads (`mirrorSpokenReminders`),
 *     until the pull brings the server's row. It no longer files them in a second, local list.
 *   - Demo mode: demo data is never sent to a server, so the old in-memory list keeps them, exactly as before.
 */
import type React from 'react';
import type { DailyLog, PlannedTask } from '../../types';
import { mirrorSpokenReminders } from '../../features/plannedWork/data/spokenMirror';

const mergeUniqueTasks = (existing: PlannedTask[], incoming: PlannedTask[]): PlannedTask[] => {
    if (incoming.length === 0) return existing;
    const merged = new Map<string, PlannedTask>();
    existing.forEach(task => merged.set(task.id, task));
    incoming.forEach(task => merged.set(task.id, task));
    return Array.from(merged.values());
};

export function rememberLogTasks(
    isDemoMode: boolean,
    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>,
    logs: readonly DailyLog[],
): void {
    if (isDemoMode) {
        const tasks = logs.flatMap(log => log.plannedTasks || []);
        if (tasks.length > 0) setPlannedTasks(prev => mergeUniqueTasks(prev, tasks));
        return;
    }
    void mirrorSpokenReminders(logs, null);
}
