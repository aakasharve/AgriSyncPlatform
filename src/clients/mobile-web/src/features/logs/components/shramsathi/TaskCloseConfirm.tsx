/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TaskCloseConfirm — the one-tap SUGGEST-AND-CONFIRM close card (Task 5,
 * "राहिलं → झालं", spec: dfes-companion-2026-07-11).
 *
 * Renders the single top `TaskCloseCandidate` from `taskAutoClose.ts` on the
 * "Saved to Ledger" success card: a calm one-line prompt, the task's own
 * title, and two buttons — होय (yes) / नाही (no). This component NEVER
 * flips the task itself; it only reports the farmer's tap via `onConfirm` /
 * `onDismiss` — the caller (mainView.tsx) owns the actual
 * `handleUpdateTask(id, { status: 'done', completedAt })` mutation and the
 * traceability log event. नाही must leave the task pending with NO penalty.
 *
 * The होय/नाही copy is plain UI copy (not agronomy/AI content), so — like
 * the "नंतर" dismiss affordance in MeterDisplay.tsx and the composed line in
 * DailyLoopInsight.tsx — it is hardcoded here rather than routed through the
 * i18n content-gate machinery.
 */
import React from 'react';
import type { TaskCloseCandidate } from '../../services/taskAutoClose';

export interface TaskCloseConfirmProps {
    candidate: TaskCloseCandidate;
    onConfirm: () => void;
    onDismiss: () => void;
}

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

const TaskCloseConfirm: React.FC<TaskCloseConfirmProps> = ({ candidate, onConfirm, onDismiss }) => {
    return (
        <div
            data-testid="task-close-confirm"
            className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center"
        >
            <p
                data-testid="task-close-confirm-prompt"
                className="text-sm font-semibold text-stone-700"
                style={{ fontFamily: MARATHI_BODY }}
            >
                हे काम पूर्ण झालं का?
            </p>
            <p
                data-testid="task-close-confirm-title"
                className="mt-1 text-base font-black text-stone-900"
                style={{ fontFamily: MARATHI_BODY }}
            >
                {candidate.task.title}
            </p>
            <div className="mt-3 flex items-center justify-center gap-3">
                <button
                    type="button"
                    data-testid="task-close-confirm-yes"
                    onClick={onConfirm}
                    className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                    style={{ fontFamily: MARATHI_BODY }}
                >
                    होय
                </button>
                <button
                    type="button"
                    data-testid="task-close-confirm-no"
                    onClick={onDismiss}
                    className="rounded-full border border-stone-300 bg-white px-6 py-2 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-100"
                    style={{ fontFamily: MARATHI_BODY }}
                >
                    नाही
                </button>
            </div>
        </div>
    );
};

export default TaskCloseConfirm;
