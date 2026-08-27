/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    FarmContext, CropActivityEvent, IrrigationEvent, LabourEvent,
    MachineryEvent, LedgerDefaults, FarmerProfile, CropProfile,
    InputEvent, AgriLogResponse, TodayCounts, ActivityExpenseEvent, ObservationNote,
    LogTimelineEntry, PlannedTask, DailyLog, DisturbanceEvent
} from '../../../../types';
import type { LogProvenance } from '../../../../domain/ai/LogProvenance';
import type { FarmWideDaySummary } from '../../../../app/helpers/appContentDailyCounts';

export const SAFE_DEFAULTS: LedgerDefaults = {
    irrigation: {
        method: 'drip',
        source: 'Well',
        defaultDuration: 2
    },
    labour: {
        defaultWage: 300,
        defaultHours: 8,
        shifts: []
    },
    machinery: {
        defaultRentalCost: 1000,
        defaultFuelCost: 200
    }
};

/**
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — WHERE THE FORM'S
 * CONTENTS CAME FROM, declared by the code that put them there.
 *
 * The save button cannot work this out. It sees populated buckets and an absent AI
 * marker and would conclude "hand-typed", which is wrong for both routes that pre-fill
 * this screen without a marker: "Edit This Log" (mainView `onEditLog` hands the saved
 * log in as `initialData` and sets no provenance) and the same-day re-open
 * (`useManualEntryHydration` merges today's already-saved log back into the form).
 * Getting that wrong writes an AI-inferred number to the server as `Provenance.Manual`
 * — permanent, and forbidden by doctrine P8. Only `'blank'` earns the manual claim.
 *
 * `'prefilled-draft'` deliberately does NOT say "voice": an `AgriLogResponse` reaches
 * the hydration hook from a fresh parse AND from the edit route, and the hook cannot
 * tell them apart. Naming it 'voice' would be its own mislabel. It says only what is
 * true — the farmer did not type this here.
 */
export type ManualEntryFormOrigin =
    /** Opened empty and stayed empty until the farmer typed. */
    | 'blank'
    /** An AgriLogResponse was handed in (fresh voice parse, or "Edit This Log"). */
    | 'prefilled-draft'
    /** Filled from a log that was already saved (today's merge, or the log picker). */
    | 'existing-log';

export interface TargetSelectionGroup {
    cropId: string;
    cropName: string;
    iconName?: string;
    color: string;
    plotNames: string[];
}

export interface ManualEntryProps {
    context: FarmContext | null;
    crops: CropProfile[]; // Added dynamic crops
    defaults?: LedgerDefaults;
    profile: FarmerProfile;
    onSubmit: (data: {
        cropActivities: CropActivityEvent[];
        irrigation: IrrigationEvent[];
        labour: LabourEvent[];
        inputs: InputEvent[];
        machinery: MachineryEvent[];
        activityExpenses: ActivityExpenseEvent[];
        observations: ObservationNote[];
        plannedTasks: PlannedTask[]; // NEW
        disturbance?: DisturbanceEvent;
        date: string;
        manualTotalCost?: number;
        fullTranscript?: string;
        originalLogId?: string; // NEW: ID of the log being edited
        /**
         * BUGFIX_2026-07-19 (spec: dfes-companion-2026-07-11) — carries the
         * REAL voice-parse provenance (source: 'ai' + sourceAiJobId) through
         * to the persisted log when this NEW-log submission originated from a
         * voice draft. Omitted (never fabricated) when editing an existing
         * log or when the entry is genuinely manual.
         */
        provenance?: LogProvenance | null;
    }) => void;
    disabled?: boolean;
    initialData?: AgriLogResponse | null;
    provenance?: LogProvenance | null;
    onDataConsumed?: () => void;
    /**
     * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — OPTIONAL
     * override for the submitted `date` field. Every existing caller omits
     * this, so the default stays exactly `getDateKey()` (today), unchanged
     * for the live voice/manual path where "today" is correct. It exists
     * for the offline AI-drafts reviewing surface: a note recorded at dusk
     * and drained (or reviewed) the next morning must be dated to when the
     * farmer actually recorded it, not to whichever day he happens to open
     * the review screen — see `AiDraftsPage.tsx`.
     */
    recordedDateKey?: string;
    todayCountsMap?: Record<string, TodayCounts>;
    /**
     * LABOUR_PHASE2 P2.4 — what the farmer recorded for the WHOLE FARM today.
     *
     * SEPARATE from `todayCountsMap` on purpose. That map is per-plot and its
     * consumer SUMS it across the plots in context, so folding a farm-wide
     * record into it multiplies one record by the plot count — `R24` measured
     * a plot's 3 labour entries becoming 11. This prop has no plot key, so the
     * two can never be added together.
     */
    farmWideToday?: FarmWideDaySummary;
    transcriptEntries?: LogTimelineEntry[];  // Today's past logs for timeline display
    todayLogs?: DailyLog[];                  // Full log objects for loading into editor
    onLogSelect?: (logId: string) => void;   // Callback when user selects a log to edit
}
