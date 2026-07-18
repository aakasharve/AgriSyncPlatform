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
    todayCountsMap?: Record<string, TodayCounts>;
    transcriptEntries?: LogTimelineEntry[];  // Today's past logs for timeline display
    todayLogs?: DailyLog[];                  // Full log objects for loading into editor
    onLogSelect?: (logId: string) => void;   // Callback when user selects a log to edit
}
