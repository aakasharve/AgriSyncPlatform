/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Transcript Timeline Service
 * Builds chronological timeline of log entries for emotional display
 */

import { DailyLog, LogTimelineEntry, DayTranscriptSummary } from '../features/logs/logs.types';
import { CropProfile } from '../types';
import { formatDisplayTime } from '../shared/utils/cropEmojis';

/**
 * Build a day's transcript timeline from logs
 */
export function buildDayTimeline(
    logs: DailyLog[],
    crops: CropProfile[],
    targetDate: string
): DayTranscriptSummary {
    // Filter logs for target date that have transcripts
    const dayLogs = logs.filter(log =>
        log.date === targetDate &&
        (log.fullTranscript || log.transcriptSnapshot?.raw)
    );

    // Build entries sorted by time
    const entries: LogTimelineEntry[] = dayLogs
        .map(log => buildTimelineEntry(log, crops))
        .filter((entry): entry is LogTimelineEntry => entry !== null)
        .sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

    // Aggregate crops involved
    const cropMap = new Map<string, { count: number; name: string; iconName: string; color?: string }>();
    entries.forEach(entry => {
        entry.contexts.forEach(ctx => {
            const existing = cropMap.get(ctx.cropId);
            if (existing) {
                existing.count++;
            } else {
                cropMap.set(ctx.cropId, {
                    count: 1,
                    name: ctx.cropName,
                    iconName: ctx.cropIconName,
                    color: ctx.cropColor
                });
            }
        });
    });

    return {
        date: targetDate,
        totalLogs: entries.length,
        entries,
        cropsInvolved: Array.from(cropMap.entries()).map(([cropId, data]) => ({
            cropId,
            cropName: data.name,
            cropIconName: data.iconName,
            cropColor: data.color,
            logCount: data.count
        }))
    };
}

/**
 * Build a single timeline entry from a DailyLog
 * Includes both voice logs (with transcripts) and manual logs (without transcripts)
 */
function buildTimelineEntry(log: DailyLog, crops: CropProfile[]): LogTimelineEntry | null {
    const transcript = log.transcriptSnapshot?.raw || log.fullTranscript || '';

    // Include all logs - even ones without transcripts (manual entries)
    // Only skip if there's literally no content at all
    const hasAnyContent =
        transcript ||
        (log.cropActivities && log.cropActivities.length > 0) ||
        (log.observations && log.observations.length > 0) ||
        (log.labour && log.labour.length > 0) ||
        (log.irrigation && log.irrigation.length > 0) ||
        (log.machinery && log.machinery.length > 0) ||
        (log.activityExpenses && log.activityExpenses.length > 0);

    if (!hasAnyContent) return null;

    const timestamp = log.meta?.createdAtISO || `${log.date}T12:00:00`;
    const displayTime = formatDisplayTime(timestamp);

    // Build contexts from log's farm context
    const contexts: LogTimelineEntry['contexts'] = [];

    if (log.context?.selection) {
        log.context.selection.forEach(sel => {
            const crop = crops.find(c => c.id === sel.cropId);
            if (crop) {
                // Get plots for this selection
                const plotIds = sel.selectedPlotIds || [];
                if (plotIds.length > 0) {
                    plotIds.forEach(plotId => {
                        const plot = crop.plots.find(p => p.id === plotId);
                        contexts.push({
                            cropId: crop.id,
                            cropName: crop.name,
                            cropIconName: crop.iconName,
                            cropColor: crop.color,
                            plotId: plot?.id,
                            plotName: plot?.name
                        });
                    });
                } else {
                    // No specific plots, just add the crop
                    contexts.push({
                        cropId: crop.id,
                        cropName: crop.name,
                        cropIconName: crop.iconName,
                        cropColor: crop.color
                    });
                }
            }
        });
    }

    // Fallback if no contexts found
    if (contexts.length === 0 && crops.length > 0) {
        contexts.push({
            cropId: crops[0].id,
            cropName: crops[0].name,
            cropIconName: crops[0].iconName,
            cropColor: crops[0].color
        });
    }

    // Count logged items
    const loggedItems = {
        activities: log.cropActivities?.length || 0,
        observations: log.observations?.length || 0,
        labour: log.labour?.length || 0,
        irrigation: log.irrigation?.length || 0,
        machinery: log.machinery?.length || 0,
        expenses: log.activityExpenses?.length || 0
    };

    // Determine source - voice logs have non-empty transcripts
    const hasTranscript = transcript && transcript.trim().length > 0;
    const source: 'VOICE' | 'MANUAL' | 'QUICK_ACTION' =
        hasTranscript ? 'VOICE' : 'MANUAL';

    return {
        id: `entry_${log.id}`,
        logId: log.id,
        timestamp,
        displayTime,
        contexts,
        rawTranscript: transcript,
        cleanedTranscript: log.transcriptSnapshot?.cleaned,
        displayTranscript: transcript, // Always show raw for emotional connection
        source,
        loggedItems
    };
}

/**
 * Build timeline entries for a list of logs (all on same day)
 */
export function buildTimelineEntries(
    logs: DailyLog[],
    crops: CropProfile[]
): LogTimelineEntry[] {
    return logs
        .map(log => buildTimelineEntry(log, crops))
        .filter((entry): entry is LogTimelineEntry => entry !== null)
        .sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
}
