
import { CropActivityEvent, IrrigationEvent, LabourEvent, InputEvent, MachineryEvent, ActivityExpenseEvent, ObservationNote, PlannedTask, DisturbanceEvent, LogVerification } from '../types/log.types';
import { WeatherStamp } from '../types/weather.types';

/**
 * PatchEvent - Represents a snapshot of the log state BEFORE an edit.
 * This ensures we have a full audit trail of what the log looked like at any point in time.
 */
export interface PatchEvent {
    id: string;             // Unique ID for this patch event
    timestamp: string;      // When the edit happened
    actorId: string;        // Who made the edit
    reason: string;         // Why the edit was made (optional, but good for disputes)

    // We store the FULL component types as they were before the change.
    // This effectively creates a reverse-delta.
    previousState: {
        date?: string;
        weatherStamp?: WeatherStamp;
        cropActivities?: CropActivityEvent[];
        irrigation?: IrrigationEvent[];
        labour?: LabourEvent[];
        inputs?: InputEvent[];
        machinery?: MachineryEvent[];
        activityExpenses?: ActivityExpenseEvent[];
        observations?: ObservationNote[];
        plannedTasks?: PlannedTask[];
        disturbance?: DisturbanceEvent;
        verification?: LogVerification;
    };
}
