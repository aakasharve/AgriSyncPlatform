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
import { PART_LABEL_EN, blockersOf, partEntriesOf, partMeta, type PartEntry } from '../../features/logs/components/voiceResult/resultModel';
import { resultStr } from '../../features/logs/components/voiceResult/resultStrings';
import { formatFarmerLogTime, getVerificationPresentation } from './helpers';
import { cropNameIn } from '../../shared/names/namesIn';

export interface FeedDeps {
    crops: readonly CropProfile[];
    operatorNameById: ReadonlyMap<string, string>;
    getLogContextSnapshot: (log: DailyLog) => { plotName: string; cropName: string };
    onOpenLog: (log: DailyLog) => void;
    /** Ids that mean "the person holding this phone" (active operator, signed-in user). */
    youIds?: ReadonlySet<string>;
    /**
     * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; founder 2026-11-06) - the phone holder's own name from his
     * profile: his cards read it when the operator list has no name for him, so the glance says a real name, never "तुम्ही" and
     * not "अज्ञात" for himself.
     */
    ownName?: string;
    /** spec I18 — the language of the card's words (default Marathi). */
    language?: string;
}

/**
 * The card's headline: the first thing understood (crop work first), else the part's name; "—" when nothing.
 * Only what the server could VERIFY in his words may headline a card: an item it could not find there is shown
 * flagged inside the glance, never as the card's fact.
 */
export function workDoneOf(log: DailyLog, language: string | null | undefined = 'mr'): string {
    return headlineOf(partEntriesOf(log, language), blockersOf(log, language).length > 0, language);
}

/**
 * The same rule over entries already read (lane RF, review B002): आढावा applies it AFTER hiding money the person
 * may not see, so a headline can never carry an amount the screen hid. An entry with no value (a hidden amount is
 * one) never headlines with its value — its part's name stands instead.
 */
export function headlineOf(all: readonly PartEntry[], hasBlockers: boolean, language: string | null | undefined = 'mr'): string {
    const entries = all.filter(e => e.verified);
    const valued = entries.find(e => e.part === 'crop' && e.value) ?? entries.find(e => e.value);
    if (valued?.value) return valued.value;
    // spec I18 — the part's name and the stoppage word in his language.
    if (entries[0]) return language === 'en' ? PART_LABEL_EN[entries[0].part] : partMeta(entries[0].part).label;
    return hasBlockers ? resultStr(language).blockers : '—';
}

export function buildFeedEntries(logs: readonly DailyLog[], deps: FeedDeps): FeedEntry[] {
    return logs.map(log => {
        const contextDetails = deps.getLogContextSnapshot(log);
        const verification = getVerificationPresentation(log.verification?.status);
        const createdById = log.meta?.createdByOperatorId || '';
        // Truth audit T1.12b, finding 4: a record nobody was recorded as making is NEVER attributed to a
        // real person by name. `अज्ञात` is the word the app already uses for "no identity" (P4/P7).
        const byYou = !!createdById && !!deps.youIds?.has(createdById);
        const loggedBy = deps.operatorNameById.get(createdById) || (byYou ? deps.ownName?.trim() : '') || resultStr(deps.language).unknownPerson;
        const primaryCropId = log.context.selection[0]?.cropId;
        const cropColor = deps.crops.find(crop => crop.id === primaryCropId)?.color || 'bg-slate-400';
        const snippet = log.fullTranscript?.trim();
        return {
            id: log.id,
            logId: log.id,
            log,
            byYou,
            workDone: workDoneOf(log, deps.language),
            plotName: contextDetails.plotName,
            cropName: cropNameIn(contextDetails.cropName, deps.language),
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
