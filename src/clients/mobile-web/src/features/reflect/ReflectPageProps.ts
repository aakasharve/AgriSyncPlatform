/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { DailyLog } from '../logs/logs.types';
import { CropProfile, LedgerDefaults, LogVerificationStatus, FarmOperator } from '../../types';
import type { FeedEntry } from '../logs/components/TodayActivityFeed';

export interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    onEditLog?: (log: DailyLog) => void; // Callback to navigate to Log page with pre-filled data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    onUpdateNote?: (logId: string, noteId: string, updates: any) => void;
    // Trust Layer
    onVerifyLog?: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    navigate?: (route: any) => void;
    focusLogRequest?: { logId: string; date: string; plotId?: string } | null;
    onFocusLogConsumed?: () => void;

    /** Today's logs for the Activity Feed, behind its own button at the top of this page. Omit to hide the button. */
    activityFeed?: { entries: readonly FeedEntry[]; dateLabel: string };

    // Tasks (already present)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    tasks?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    onUpdateTask?: (task: any) => void;
    onAddTask?: () => void;
}
