/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-78, D-79, D-84 = 1; R14-R16) - what a reminder's card says about
 * it: which of the three sources it comes from, who made it and when ("‹नाव› · ‹तारीख›, ‹वेळ›", farm time), its source line, the voice and
 * the two D-84 = 1 lines. Pure. The phone says only what the server told it (P4): no name, source or permission is made up here; a field
 * the server did not send is not claimed.
 *
 *   - Chips: सगळ्या · नियोजनातून · शेड्यूलमधून · नोंदीतून. The category is the server's (`reminder.category`); a task of the demo list has
 *     none and is read from its old `sourceType` so the chips still sort it.
 *   - "ऐका" only when the server says this reader may hear the source voice (`mayPlayVoice` true) and the reminder names its log; when the
 *     server says a recording exists that he may NOT hear (false), the ShramSafal-rule line stands in (R15); when it says nothing (null), nothing (P5).
 *   - A reminder whose words mention money and that this reader may not hear carries no words (R16): the card shows the rule card.
 */
import type { PlannedTask } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { dateLabel, fromDateKey } from '../../reflect/overview/reflectDates';
import { formatDisplayDateTime, formatFarmerTime } from '../../../shared/utils/displayTime';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { workTypeNameIn } from '../../../shared/names/namesIn';
import { plannedWorkWords, type ReminderWords } from '../plannedWorkWords';

export type ReminderChip = 'all' | 'planning' | 'schedule' | 'logs';
export const REMINDER_CHIPS: readonly ReminderChip[] = ['all', 'planning', 'schedule', 'logs'];

type Category = 'FromPlanning' | 'FromSchedule' | 'FromLogs';

/** The chip a task belongs to (never `all`). */
export function chipOf(task: PlannedTask): Exclude<ReminderChip, 'all'> {
    const category: Category | undefined = task.listSource?.reminder?.category;
    if (category) return category === 'FromSchedule' ? 'schedule' : category === 'FromLogs' ? 'logs' : 'planning';
    // A task of the demo list: the old source words sort it.
    if (task.sourceType === 'schedule') return 'schedule';
    if (task.sourceType === 'ai_extracted' || task.sourceType === 'observation_derived') return 'logs';
    return 'planning';
}

export const matchesChip = (task: PlannedTask, chip: ReminderChip): boolean => chip === 'all' || chipOf(task) === chip;

/** How many of the tasks each chip would show (the chip says its number; an empty chip is still a chip, not a hidden door). */
export function chipCounts(tasks: readonly PlannedTask[]): Record<ReminderChip, number> {
    const counts: Record<ReminderChip, number> = { all: tasks.length, planning: 0, schedule: 0, logs: 0 };
    for (const t of tasks) counts[chipOf(t)] += 1;
    return counts;
}

export function chipLabel(words: ReminderWords, chip: ReminderChip): string {
    return chip === 'all' ? words.chipAll : chip === 'planning' ? words.chipPlanning : chip === 'schedule' ? words.chipSchedule : words.chipLogs;
}

export type VoiceState = 'play' | 'rule' | 'none';

export interface ReminderLines {
    /** "‹नाव› · ‹तारीख›, ‹वेळ›" - each part only when the server told it; null when none of them is known. */
    byline: string | null;
    /** The source line of a reminder made from a record: spoken (with its plot) or left unfinished; null for the rest. */
    sourceLine: string | null;
    leftover: boolean;
    voice: VoiceState;
    /** The log whose voice "ऐका" plays (never copied: the original-voice door is asked for it). */
    voiceLogId: string | null;
    wordsWithheld: boolean;
    markedMaker: boolean;
    chosenPeople: boolean;
}

/**
 * The title a card shows (fix round, review M4). A left-over reminder's title is the work's own word as the server kept it - the voice parse
 * writes the English work type ("Spraying") beside its Marathi title - so it is shown through the app's own work-name map at display time
 * (फवारणी in Marathi mode, Spraying in English mode); the stored row is untouched. A word the map does not know is never shown in the other
 * language: the card says the left-over word instead (no translation is made up here). What a person said or typed is shown as kept.
 */
export function reminderTitleIn(task: PlannedTask, language: string | null | undefined): string {
    if (task.listSource?.reminder?.kind !== 'Leftover') return task.title;
    const lang = language === 'en' ? 'en' : 'mr';
    return workTypeNameIn(task.title, lang, { strict: true }) || plannedWorkWords(lang).reminders.leftover;
}

/** "‹तारीख›, ‹वेळ›" of an instant, in farm time (IST), in the screen's language. Empty when the instant is unknown or unreadable. */
export function whenText(createdAtUtc: string | null | undefined, language: string | null | undefined): string {
    if (!createdAtUtc || Number.isNaN(new Date(createdAtUtc).getTime())) return '';
    if (language === 'en') return formatDisplayDateTime(createdAtUtc);
    const day = digitsFor(dateLabel(fromDateKey(getDateKey(createdAtUtc))), language);
    const time = formatFarmerTime(createdAtUtc);
    return digitsFor(time ? `${day}, ${time}` : day, language);
}

/**
 * The card's lines for a task of the server's list, or null for a task that is not one (the demo list: nothing is claimed).
 * @param placeLabel the place the card already shows ("G1 · द्राक्ष"): the plot name is the source line's place.
 */
export function reminderLines(task: PlannedTask, language: string | null | undefined, placeLabel?: string): ReminderLines | null {
    const r = task.listSource?.reminder;
    if (!r) return null;
    const words = plannedWorkWords(language).reminders;
    const when = whenText(r.createdAtUtc, language);
    const byline = [r.createdByName, when].filter((part): part is string => Boolean(part)).join(' · ') || null;
    const place = placeLabel ? placeLabel.split(' · ')[0] : null;
    const leftover = r.kind === 'Leftover';
    // The server says so: true = he may hear it; false = a recording exists and he may NOT (the rule line); null = nothing to speak of.
    const voice: VoiceState = r.mayPlayVoice === true && r.sourceDailyLogId ? 'play' : r.mayPlayVoice === false ? 'rule' : 'none';
    return {
        byline,
        sourceLine: leftover ? words.leftover : r.kind === 'Spoken' ? words.fromSpoken(place) : null,
        leftover,
        voice: r.wordsWithheld ? 'none' : voice,
        voiceLogId: r.sourceDailyLogId,
        wordsWithheld: r.wordsWithheld,
        markedMaker: r.makerAlwaysShown && !r.fromChosenPeopleRecord,
        chosenPeople: r.fromChosenPeopleRecord,
    };
}
