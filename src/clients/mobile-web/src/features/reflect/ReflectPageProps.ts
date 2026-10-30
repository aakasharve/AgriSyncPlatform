/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { DailyLog } from '../logs/logs.types';
import { CropProfile, LedgerDefaults, LogVerificationStatus, FarmOperator } from '../../types';
import type { PlannedTask } from '../../types';

export interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    onEditLog?: (log: DailyLog) => void; // Callback to navigate to Log page with pre-filled data
    /**
     * Lane RF — "बदला" on a recording: the result screen's own edit path (`handleEditLog`). Falls back to
     * `onEditLog` when absent. `onEditLog` alone still starts a plot day nothing was told for.
     */
    onOpenLog?: (log: DailyLog) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    onUpdateNote?: (logId: string, noteId: string, updates: any) => void;
    // Trust Layer
    onVerifyLog?: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    /** Lane RF — ids that mean "the person holding this phone" (active operator, signed-in user): his work reads "तुम्ही". */
    youIds?: readonly string[];
    /**
     * Lane RF — his role on this farm as the server told this phone (`PrimaryOwner`, …; null = not told yet). It decides
     * whether he sees the farm's money (`mayShowFarmMoney`, founder D-22) and where ▶ may be offered (`listenModel`).
     */
    farmRole?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    navigate?: (route: any) => void;
    focusLogRequest?: { logId: string; date: string; plotId?: string } | null;
    onFocusLogConsumed?: () => void;
    /**
     * spec plr-d10 (I14, H16) — open the page narrowed to this one plot (a लक्ष द्या "तुकडा पहा" card), then
     * call `onFocusPlotConsumed`. A plot that is not on this phone leaves the page on the whole farm.
     */
    focusPlotId?: string | null;
    onFocusPlotConsumed?: () => void;
    /**
     * spec: plr-d10 (I22, founder D-1) — the आढावा strip's tap: open लक्ष द्या. Omit → no strip (a strip that
     * cannot open its page would be a dead control, P5).
     */
    onOpenAttention?: () => void;

    // Tasks (already present)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    tasks?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    onUpdateTask?: (task: any) => void;
    onAddTask?: () => void;
    /** spec plr-d10 (I14, T2) — save a to-do typed in place ("आठवण जोडा") to the task store. Preferred over `onAddTask`. */
    onSaveTask?: (task: PlannedTask) => void;
    /** spec plr-d10 (I14, T2) — "बोलून सांगा": open the real voice log flow (a spoken reminder becomes a to-do). */
    onTellTodo?: () => void;
}
