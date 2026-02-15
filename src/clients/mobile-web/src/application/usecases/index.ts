/**
 * Application Use-Cases
 *
 * This module exports all use-cases for the application layer.
 * Use-cases are the entry points for all business operations.
 *
 * UI components should import from here, not directly from services.
 */

// Log Creation
export {
    createLogsFromManualEntry,
    createLogsFromVoiceResult,
    type CreateLogsFromManualInput,
    type CreateLogsFromVoiceInput,
    type CreateLogsResult
} from './CreateLog';

// Log Verification
export {
    verifyLog,
    batchVerifyLogs,
    getLogsNeedingVerification,
    type VerifyLogInput,
    type BatchVerifyInput,
    type VerifyResult
} from './VerifyLog';

// Log Loading/Queries
export {
    loadAllLogs,
    loadLogsByDate,
    loadTodayLogs,
    loadLogsWithFilter,
    getTodaySummary,
    loadLogsGroupedByDate,
    type LoadLogsFilter,
    type TodaySummary
} from './LoadLogs';

// Voice Parsing
export {
    parseVoiceToDraft
} from './ParseVoiceToDraft';

// Log Mutation
export {
    updateLog
} from './UpdateLog';

export {
    deleteLog
} from './DeleteLog';

export {
    addIssueToLog
} from './AddIssueToLog';

// Weather Attachments
export {
    getWeatherForLocation
} from './AttachWeatherSnapshot';
