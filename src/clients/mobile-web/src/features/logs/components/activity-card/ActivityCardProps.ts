/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import {
    CropActivityEvent,
    IrrigationEvent,
    LabourEvent,
    MachineryEvent,
    LedgerDefaults,
    FarmerProfile,
    Plot,
    InputEvent,
    ActivityExpenseEvent,
    ObservationNote,
    PlannedTask,
    CropProfile,
    DailyLog,
    DisturbanceEvent,
    LogVerificationStatus,
} from '../../../../types';
import { BucketIssue } from '../../../../domain/types/log.types';
import type { ActivityDetailData } from './sheets/DetailSheet';

export interface ActivityCardProps {
    activity: CropActivityEvent;
    linkedData: {
        labour?: LabourEvent;
        irrigation?: IrrigationEvent;
        machinery?: MachineryEvent;
    };
    inputs: InputEvent[]; // NEW: Inputs as array
    // The `data` shape varies by `type` (LabourEvent/IrrigationEvent/MachineryEvent/InputEvent[]);
    // typed as ActivityDetailData from the shared sheet (see DetailSheet.tsx docstring).
    onUpdateDetails: (type: 'labour' | 'irrigation' | 'machinery' | 'input', data: ActivityDetailData) => void;
    onUpdateWorkTypes?: (types: string[]) => void;
    onDeleteActivity: () => void;
    defaults: LedgerDefaults;
    profile: FarmerProfile;
    currentPlot?: Plot;
    cropContractUnit?: string;
    expenses?: ActivityExpenseEvent[];
    onAddExpense?: (exp: ActivityExpenseEvent) => void;
    onUpdateExpenses?: (exp: ActivityExpenseEvent) => void;
    onDeleteExpense?: (expId: string) => void;
    observations?: ObservationNote[];
    onAddObservation?: (obs: ObservationNote) => void;
    draftDisturbance?: DisturbanceEvent;
    plannedTasks?: PlannedTask[];
    crops?: CropProfile[];
    todayLogs?: DailyLog[]; // NEW: To show cumulative daily summary
    onRefineWorkType?: (oldType: string, newType: string, mode: 'manual' | 'voice') => void;
    verificationStatus?: LogVerificationStatus; // DFES Phase 0: Trust badge
    onUpdateIssue?: (issue: BucketIssue | undefined) => void; // NEW
}
