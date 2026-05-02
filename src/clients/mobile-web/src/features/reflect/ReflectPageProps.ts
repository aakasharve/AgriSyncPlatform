/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { DailyLog } from '../logs/logs.types';
import {
    CropProfile,
    LedgerDefaults,
    LogVerificationStatus,
    FarmOperator,
    ObservationNote,
    PlannedTask
} from '../../types';

export interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    onEditLog?: (log: DailyLog) => void; // Callback to navigate to Log page with pre-filled data
    onUpdateNote?: (logId: string, noteId: string, updates: Partial<ObservationNote>) => void;
    // Trust Layer
    onVerifyLog?: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    // navigate is wired to setCurrentRoute (AppRoute) at the call site, but
    // ReflectPage also invokes it with a structured `{ route, view }` shape
    // for the income deep-link. Keeping this loose preserves runtime behavior
    // on both call sites without coupling ReflectPage to AppRoute or
    // rewriting the call. Type-only escape hatch — runtime is unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixed string/object navigate contract
    navigate?: (route: any) => void;
    focusLogRequest?: { logId: string; date: string; plotId?: string } | null;
    onFocusLogConsumed?: () => void;

    // Tasks (already present)
    tasks?: PlannedTask[];
    // The two consumers disagree on this signature: ToDoTasksBlock calls
    // onUpdateTask(taskId, updates) while the mainView wires a single-arg
    // (task) adapter. Keeping `any` preserves runtime behavior on both sides
    // — reconciling the call sites is a separate refactor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inconsistent caller contracts; runtime preserved
    onUpdateTask?: (...args: any[]) => void;
    onAddTask?: () => void;
}
