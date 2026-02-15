/**
 * Retention Event Types — DFES V2
 *
 * Types for tracking user engagement and retention metrics.
 * Used by the behavioral layer to measure habit formation.
 *
 * Layer: Domain (pure types, no UI/infrastructure imports)
 */

// =============================================================================
// RETENTION EVENTS
// =============================================================================

export type RetentionEventType =
    | 'APP_OPEN'              // User opened the app
    | 'LOG_CREATED'           // A log was created (any method)
    | 'LOG_CREATED_VOICE'     // Log created via voice
    | 'LOG_CREATED_MANUAL'    // Log created via manual entry
    | 'LOG_CREATED_QUICK'     // Log created via QuickLogSheet
    | 'LOG_CONFIRMED'         // Operator confirmed their log
    | 'LOG_VERIFIED'          // Owner verified a log
    | 'LOG_DISPUTED'          // Owner disputed a log
    | 'DAY_CLOSED'            // User tapped "Close Today" (closure ritual)
    | 'MISSED_DAY_RECOVERED'  // User logged for a missed day
    | 'NO_WORK_RECORDED'      // User explicitly said "no work today"
    | 'ONBOARDING_COMPLETE'   // User finished onboarding flow
    | 'VERIFICATION_BATCH'    // Owner batch-verified multiple logs
    | 'OPERATOR_SWITCH';      // User switched active operator

export interface RetentionEvent {
    id: string;
    type: RetentionEventType;
    timestamp: string;          // ISO string
    actorId: string;            // FarmOperator ID
    metadata?: Record<string, unknown>;
}

// =============================================================================
// RETENTION METRICS (Computed)
// =============================================================================

export interface DailyEngagement {
    date: string;               // YYYY-MM-DD
    logsCreated: number;
    logsVerified: number;
    dayClosed: boolean;
    inputMethods: {
        voice: number;
        manual: number;
        quick: number;
    };
    timeToFirstLogSeconds?: number;  // From app open to first log
}

export interface RetentionCohort {
    day1: boolean;   // Logged on first day
    day3: boolean;   // Logged 2+ of first 3 days
    day7: boolean;   // Logged 4+ of first 7 days
    day14: boolean;  // Logged 8+ of first 14 days
    streakCurrent: number;   // Current consecutive days with a log
    streakLongest: number;   // Longest consecutive days with a log
    totalActiveDays: number; // Total unique days with at least one log
}
