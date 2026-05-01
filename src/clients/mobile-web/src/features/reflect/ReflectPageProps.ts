/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { DailyLog } from '../logs/logs.types';
import { CropProfile, LedgerDefaults, LogVerificationStatus, FarmOperator } from '../../types';

export interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    onEditLog?: (log: DailyLog) => void; // Callback to navigate to Log page with pre-filled data
    onUpdateNote?: (logId: string, noteId: string, updates: any) => void;
    // Trust Layer
    onVerifyLog?: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    navigate?: (route: any) => void;
    focusLogRequest?: { logId: string; date: string; plotId?: string } | null;
    onFocusLogConsumed?: () => void;

    // Tasks (already present)
    tasks?: any[];
    onUpdateTask?: (task: any) => void;
    onAddTask?: () => void;
}
