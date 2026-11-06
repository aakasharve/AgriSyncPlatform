/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { DailyLog } from '../logs/logs.types';
import { CropProfile, LedgerDefaults, FarmOperator } from '../../types';
import type { PlannedTask } from '../../types';
import type { SpeakRequestInput } from '../../core/speak/speakStore';

export interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    /**
     * Lane RF / E1 — "बदला" on a recording: the speak-the-change screen (`handleEditLog`). The old hand-filled form is
     * no longer reached from this page (lane E1).
     */
    onOpenLog?: (log: DailyLog) => void;
    /**
     * Lane MIC-1 — THE ONE mic, for this page's speak buttons (the plot day's "आणखी सांगा", करायची कामे's "बोलून सांगा").
     * The page names the purpose, the place and what to do on landing; the router adds where to come back to. Omit →
     * no speak button is drawn (never a dead one, P5).
     */
    onSpeak?: (request: Omit<SpeakRequestInput, 'returnTo'>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing prop shape (not part of the Activity Feed change); typing it is a separate cleanup
    onUpdateNote?: (logId: string, noteId: string, updates: any) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    /**
     * Lane RF (review B001) — the SIGNED-IN user's id (the auth session's), the only id "he said it" is compared with:
     * his records read "तुम्ही", keep his own amounts, and may offer his original voice. Never the profile's active
     * operator (on a non-owner's phone the sync sets that to the primary owner's id).
     */
    sessionUserId?: string | null;
    /**
     * Lane RF — his role on this farm as the server told this phone (`PrimaryOwner`, …; null = not told yet). It decides
     * whether he sees the farm's money (`mayShowFarmMoney`, founder D-22) and where ▶ may be offered (`listenModel`).
     */
    farmRole?: string | null;
    /** lane MU-3 — the server's see-money answer for this seat (absent = the role rule, `mayShowFarmMoney`). */
    maySeeMoney?: boolean;
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
}
