/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * activityFeedEntries — turns today's logs into the cards of the Activity Feed (PLR-D5).
 *
 * This is the mapping that used to sit inline in `mainView.tsx`'s log page, moved here unchanged in
 * behaviour when the feed moved to "माझं शेत" (founder 2026-10-24). It lives in `core/navigation` because
 * it uses that folder's display helpers; the feed component itself stays presentational.
 */
import type { DailyLog } from '../../features/logs/logs.types';
import type { CropProfile } from '../../types';
import type { FeedEntry } from '../../features/logs/components/TodayActivityFeed';
import { formatLogTime, getPrimaryWorkDone, getSummaryLines, getVerificationPresentation } from './helpers';

export interface FeedDeps {
    crops: readonly CropProfile[];
    operatorNameById: ReadonlyMap<string, string>;
    getLogContextSnapshot: (log: DailyLog) => { plotName: string; cropName: string };
    onOpenLog: (log: DailyLog) => void;
}

export function buildFeedEntries(logs: readonly DailyLog[], deps: FeedDeps): FeedEntry[] {
    return logs.map(log => {
        const contextDetails = deps.getLogContextSnapshot(log);
        const verification = getVerificationPresentation(log.verification?.status);
        const createdById = log.meta?.createdByOperatorId || '';
        // Truth audit T1.12b, finding 4: a record nobody was recorded as making is NEVER attributed to a
        // real person by name. `अज्ञात` is the word the app already uses for "no identity" (P4/P7).
        const loggedBy = deps.operatorNameById.get(createdById) || 'अज्ञात';
        const primaryCropId = log.context.selection[0]?.cropId;
        const cropColor = deps.crops.find(crop => crop.id === primaryCropId)?.color || 'bg-slate-400';
        return {
            id: log.id,
            logId: log.id,
            workDone: getPrimaryWorkDone(log),
            plotName: contextDetails.plotName,
            cropName: contextDetails.cropName,
            cropColor,
            loggedBy,
            timeLabel: formatLogTime(log.meta?.createdAtISO),
            statusLabel: verification.label,
            statusTone: verification.tone,
            counts: {
                cropActivities: log.cropActivities.length,
                irrigation: log.irrigation.length,
                labour: log.labour.length,
                inputs: log.inputs.length,
            },
            summaryLines: getSummaryLines(log),
            onOpen: () => deps.onOpenLog(log),
        };
    });
}
