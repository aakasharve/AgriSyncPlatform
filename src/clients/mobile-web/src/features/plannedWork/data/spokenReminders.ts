/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-78 = 1, D-29, D-31, P3) - the reminders a log's planned items
 * stand for. The phone's twin of the server's `PlannedWorkProjection` (+ `SpokenReminders`): ONE rule, so the phone can show a spoken
 * reminder the moment he saves it, under the id the server will give it, until the pull brings the server's row. One shared fixture of
 * cases pins both sides (`sync-contract/tests/fixtures/planned-work-projection.json`).
 *
 *   - An item is a reminder while it is open (status not done / cancelled), is not schedule work, and has words (title, else description).
 *   - It carries only a short title (cut at the cap, on a word boundary) and a day from a CLEAR cue (`resolveDueDate`, from the log's day).
 *     A date the phone wrote on the item is not a cue (D-29). Never the transcript, source text or interpretation (D-31).
 *   - Its id is `spokenTaskId(log, item.id)`.
 */
import { resolveDueDate } from '../../../core/domain/dueDateResolver';
import { spokenTaskId } from './plannedWorkIds';

/** `PlannedWork.MaxTitle`. */
export const REMINDER_TITLE_MAX = 200;

export interface SpokenReminderPlan {
    id: string;
    itemKey: string;
    title: string;
    dueDate: string | null;
    namedPlotId: string | null;
    itemSourceType: string | null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

const text = (item: Record<string, unknown>, name: string): string | null => {
    const value = item[name];
    return typeof value === 'string' ? value : null;
};
const words = (value: string | null): string | null => (value !== null && value.trim().length > 0 ? value.trim() : null);

/** At most `REMINDER_TITLE_MAX` characters, cut between words when the text is longer (never inside a surrogate pair). */
export function capReminderTitle(title: string): string {
    if (title.length <= REMINDER_TITLE_MAX) return title;
    let cut = REMINDER_TITLE_MAX;
    while (cut > 0 && !/\s/.test(title[cut])) cut--;
    if (cut <= 0) {
        const last = title.charCodeAt(REMINDER_TITLE_MAX - 1);
        cut = last >= 0xd800 && last <= 0xdbff ? REMINDER_TITLE_MAX - 1 : REMINDER_TITLE_MAX;
    }
    return title.slice(0, cut).trimEnd();
}

/** The reminders for the `plannedTasks` of a content document, in the order he said them. `logDay` is the log's day (YYYY-MM-DD). */
export function projectSpokenReminders(dailyLogId: string, logDay: string, content: { plannedTasks?: unknown } | null | undefined): SpokenReminderPlan[] {
    const items = content?.plannedTasks;
    if (!Array.isArray(items)) return [];
    const found: SpokenReminderPlan[] = [];
    for (const raw of items) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        const itemId = text(item, 'id');
        if (!itemId) continue;
        const status = text(item, 'status');
        if (status === 'done' || status === 'cancelled') continue;
        const sourceType = text(item, 'sourceType');
        if (sourceType === 'schedule') continue;
        const title = words(text(item, 'title')) ?? words(text(item, 'description'));
        if (title === null) continue;
        const plot = text(item, 'plotId');
        found.push({
            id: spokenTaskId(dailyLogId, itemId),
            itemKey: itemId,
            title: capReminderTitle(title),
            dueDate: resolveDueDate(text(item, 'dueHint') ?? undefined, logDay),
            namedPlotId: plot !== null && GUID.test(plot) && plot !== EMPTY_GUID ? plot.toLowerCase() : null,
            itemSourceType: sourceType,
        });
    }
    return found;
}
