/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transcript Timeline Types
 *
 * Split out of log.types.ts to keep that file under the 800-line cap.
 * Behavior-neutral move; log.types.ts re-exports these for backward compat.
 *
 * Layer: Domain (can only import from other domain types)
 */

// =============================================================================
// TRANSCRIPT TIMELINE (For UI display)
// =============================================================================

export interface TranscriptSnapshot {
    raw: string;                      // Original user input
    cleaned?: string;                 // AI-processed version
    language?: 'mr' | 'hi' | 'en';    // Detected language
}

export interface LogTimelineEntry {
    id: string;
    logId: string;                    // Parent DailyLog ID

    // Temporal - EXACT time
    timestamp: string;                // ISO with time: "2026-02-03T07:45:00"
    displayTime: string;              // Formatted: "7:45 AM"

    // Context - crops/plots involved
    contexts: {
        cropId: string;
        cropName: string;
        cropIconName: string;         // Icon name for CropSymbol component
        cropColor?: string;           // Tailwind color class
        plotId?: string;
        plotName?: string;
    }[];

    // Transcript
    rawTranscript: string;            // Original voice/text input
    cleanedTranscript?: string;       // AI-cleaned version
    displayTranscript: string;        // What to show (prefer raw for connection)

    // Source
    source: 'VOICE' | 'MANUAL' | 'QUICK_ACTION';

    // What was logged (summary)
    loggedItems: {
        activities: number;
        observations: number;
        labour: number;
        irrigation: number;
        machinery: number;
        expenses: number;
    };
}

export interface DayTranscriptSummary {
    date: string;                     // YYYY-MM-DD
    totalLogs: number;
    entries: LogTimelineEntry[];

    // Aggregated crops involved today
    cropsInvolved: {
        cropId: string;
        cropName: string;
        cropIconName: string;
        cropColor?: string;
        logCount: number;
    }[];
}
