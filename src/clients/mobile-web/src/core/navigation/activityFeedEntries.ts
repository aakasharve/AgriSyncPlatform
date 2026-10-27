/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * activityFeedEntries — turns today's logs into the cards of the Activity Feed (PLR-D5).
 *
 * This is the mapping that used to sit inline in `mainView.tsx`'s log page, moved here unchanged in
 * behaviour when the feed moved to "माझं शेत" (founder 2026-10-24). It lives in `core/navigation` because
 * it uses that folder's display helpers; the feed component itself stays presentational.
 *
 * PLR-D10 I13 (LP-24, V-5, LP-27): each card now carries his words (a snippet of the transcript) and the
 * log itself, so the sheet can play the recording behind it (when its clip is on this phone) and open
 * "everything understood from that recording". The card's headline is what was understood (his part
 * values, in Marathi) instead of the English "… Completed" / "Input: …" lines (`getSummaryLines`).
 * Where those lines' facts went: hours, litres, the input, the workers, an observation and a free note on
 * a crop activity or irrigation event (when it reads in Marathi) are in the glance sheet, part by part.
 * The irrigation method / source is NOT: the save path fills it with defaults when he named none
 * ("Drip" / "Shared Source", logSubmissionService.ts buildIrrigation), so it cannot be listed as
 * "understood from this recording". It stays in the record and on the edit form's water card ("बदला").
 */
import type { DailyLog } from '../../features/logs/logs.types';
import type { CropProfile } from '../../types';
import type { FeedEntry } from '../../features/logs/components/TodayActivityFeed';
import { blockersOf, partEntriesOf, partMeta } from '../../features/logs/components/voiceResult/resultModel';
import { RESULT_STR } from '../../features/logs/components/voiceResult/resultStrings';
import { formatFarmerLogTime, getVerificationPresentation } from './helpers';

export interface FeedDeps {
    crops: readonly CropProfile[];
    operatorNameById: ReadonlyMap<string, string>;
    getLogContextSnapshot: (log: DailyLog) => { plotName: string; cropName: string };
    onOpenLog: (log: DailyLog) => void;
    /** Ids that mean "the person holding this phone" (active operator, signed-in user). */
    youIds?: ReadonlySet<string>;
}

/**
 * The card's headline: the first thing understood (crop work first), else the part's name; "—" when nothing.
 * Only what the server could VERIFY in his words may headline a card: an item it could not find there is shown
 * flagged inside the glance, never as the card's fact.
 */
export function workDoneOf(log: DailyLog): string {
    const entries = partEntriesOf(log).filter(e => e.verified);
    const valued = entries.find(e => e.part === 'crop' && e.value) ?? entries.find(e => e.value);
    if (valued?.value) return valued.value;
    if (entries[0]) return partMeta(entries[0].part).label;
    return blockersOf(log).length > 0 ? RESULT_STR.blockers : '—';
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
        const snippet = log.fullTranscript?.trim();
        return {
            id: log.id,
            logId: log.id,
            log,
            byYou: !!createdById && !!deps.youIds?.has(createdById),
            workDone: workDoneOf(log),
            plotName: contextDetails.plotName,
            cropName: contextDetails.cropName,
            cropColor,
            loggedBy,
            // In his words ("सकाळी 10:30"), as the result screen reads the same recording; '' when no time was captured.
            timeLabel: formatFarmerLogTime(log.meta?.createdAtISO),
            statusLabel: verification.label,
            statusTone: verification.tone,
            counts: {
                cropActivities: log.cropActivities.length,
                irrigation: log.irrigation.length,
                labour: log.labour.length,
                inputs: log.inputs.length,
            },
            ...(snippet ? { snippet } : {}),
            onOpen: () => deps.onOpenLog(log),
        };
    });
}
