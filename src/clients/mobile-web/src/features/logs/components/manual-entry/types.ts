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
