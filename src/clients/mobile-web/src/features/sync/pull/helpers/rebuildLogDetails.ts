/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — WHERE A PULLED LOG'S DETAILS COME
 * FROM. Split out of `logsReconciler.ts`, which sits at the 800-line cap.
 *
 * Three sources, in this order, and nothing in between is ever guessed:
 *
 *   1. THE SERVER STATED THE DETAILS (`DailyLogDto.content`). They are taken EXACTLY: the stored
 *      document is the phone's own buckets, values, units, his words and the verified flags.
 *   2. The server stated nothing, and THIS PHONE HOLDS ITS OWN RECORD (it made the log, or it
 *      already took the server's details). Kept — task lines cannot express what it holds, the
 *      same "the wire has no word for it" rule that already keeps machinery and expenses.
 *   3. Neither: the server holds only TASK LINES (a record from an older app, or from before F1).
 *      Each line becomes the item it names — filed ONLY by the exact label the phone itself wrote
 *      (`logTaskPayloads.ts` `buildTaskPayloads`: "Irrigation", "Spray X", "Fertilizer X",
 *      "Machinery X", "Observation", "Reminder"). Any other label is crop work under its own title:
 *      "Spraying" or "Check vines" are words, not labels, and a substring guess turned "Spraying"
 *      into an input with an invented product (review S9). Each item carries only its name and its
 *      note. Method, source, reason, type, unit, severity and status are ABSENT when the line does
 *      not say them (doctrine P4): the old rebuild's 'Drip' / 'Field' / 'Preventive' / 'pesticide' /
 *      'unit' / 'normal' / 'manual' / 'completed' were constants wearing the costume of his record.
 */
import type { DailyLog } from '../../../../types';
import type { DailyLogDto, LogContentDto } from '../../../../infrastructure/api/AgriSyncClient';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';

/** The parts of a log that the content document carries (labour has its own path). */
export type LogDetails = Pick<
    DailyLog,
    'cropActivities' | 'irrigation' | 'inputs' | 'observations' | 'machinery' | 'activityExpenses' | 'plannedTasks'
    | 'disturbance' | 'fullTranscript'
>;

/** The detail keys a server statement replaces and a silent server never touches. */
export const LOG_DETAIL_KEYS = [
    'cropActivities', 'irrigation', 'inputs', 'observations', 'machinery', 'activityExpenses', 'plannedTasks',
    'disturbance', 'fullTranscript',
] as const satisfies readonly (keyof LogDetails)[];

const FARM_GLOBAL_ID = 'FARM_GLOBAL';
const MACHINE_TYPES = new Set(['tractor', 'tiller', 'harvester', 'drone', 'sprayer', 'unknown']);

/** The exact labels `buildTaskPayloads` writes, and nothing looser. */
const TASK_LABEL = {
    irrigation: 'Irrigation',
    observation: 'Observation',
    reminder: 'Reminder',
    sprayPrefix: 'Spray ',
    fertilizerPrefix: 'Fertilizer ',
    machineryPrefix: 'Machinery ',
} as const;

/** `buildTaskPayloads`' own stand-in when no product was named — a placeholder, not a product. */
const UNNAMED_INPUT = 'Input';

/** The product a "Spray X" / "Fertilizer X" line names, or nothing when it named none. */
function productNamed(activityType: string): string | undefined {
    const prefix = activityType.startsWith(TASK_LABEL.sprayPrefix) ? TASK_LABEL.sprayPrefix : TASK_LABEL.fertilizerPrefix;
    const named = activityType.slice(prefix.length).trim();
    return named.length > 0 && named !== UNNAMED_INPUT ? named : undefined;
}

/**
 * "Did this response STATE the details?" — presence of a stored document, the same
 * presence-not-contents rule as `serverStatedContext`. `null` / absent is silence (every response
 * but the pull, an older server, a task-lines-only record). An empty document IS a statement:
 * that is how a revision that removed every item reaches other phones.
 */
export function serverStatedContent(source: DailyLogDto): source is DailyLogDto & { content: LogContentDto } {
    const content = source.content;
    return content != null
        && typeof content === 'object'
        && content.document != null
        && typeof content.document === 'object'
        && !Array.isArray(content.document);
}

/**
 * Does this phone hold the log's OWN details — ones a silent server must never overwrite?
 * Yes when it took them from the server's stored document (`legacyPartial === false`), or when
 * this phone made the log: every local log factory stamps `meta.appVersion`, and a log that first
 * arrived by pull never carries one (the pull's `meta` has no such key, and the merge only widens
 * `meta` with what a phone already had). A task-line rebuild (`legacyPartial === true`) is not.
 */
export function holdsOwnDetails(existing: DailyLog): boolean {
    if (existing.legacyPartial === true) return false;
    if (existing.legacyPartial === false) return true;
    return Boolean(existing.meta?.appVersion);
}

const asItems = <T>(value: unknown): T[] =>
    Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object') as T[] : [];

/** Source 1: the stored document, exactly. A bucket it does not name is empty — it is a statement. */
export function detailsFromContent(content: LogContentDto): LogDetails {
    const doc = content.document;
    const disturbance = doc.disturbance;
    const fullTranscript = doc.fullTranscript;
    return {
        cropActivities: asItems(doc.cropActivities),
        irrigation: asItems(doc.irrigation),
        inputs: asItems(doc.inputs),
        observations: asItems(doc.observations),
        machinery: asItems(doc.machinery),
        activityExpenses: asItems(doc.activityExpenses),
        plannedTasks: asItems(doc.plannedTasks),
        disturbance: disturbance && typeof disturbance === 'object' && !Array.isArray(disturbance)
            ? disturbance as DailyLog['disturbance']
            : undefined,
        fullTranscript: typeof fullTranscript === 'string' ? fullTranscript : undefined,
    };
}

/** The server's own word for a task's status, where the app has one; otherwise nothing. */
function statusOf(executionStatus: string | undefined): 'completed' | 'partial' | undefined {
    switch ((executionStatus ?? '').toLowerCase()) {
        case 'completed': return 'completed';
        case 'partial': return 'partial';
        default: return undefined;
    }
}

/**
 * Source 3: what the task lines SAY, and nothing more. `plotId` / `cropId` / `logDate` place an
 * observation the way the old rebuild did (`ObservationNote.plotId` is non-optional; a farm-scoped
 * log uses the app's existing "no plot" encoding, `FARM_GLOBAL`).
 */
export function detailsFromTasks(
    source: DailyLogDto,
    plotId: string | undefined,
    cropId: string | undefined,
): LogDetails {
    const details: LogDetails = {
        cropActivities: [], irrigation: [], inputs: [], observations: [], machinery: [],
        activityExpenses: [], plannedTasks: [],
    };

    for (const task of source.tasks) {
        const activityType = normalizeMojibakeText(task.activityType);
        const notes = task.notes ? normalizeMojibakeText(task.notes) : undefined;

        // "Machinery {type}" — the phone writes `Machinery ${event.type}`.
        if (activityType.startsWith(TASK_LABEL.machineryPrefix)) {
            const said = activityType.slice(TASK_LABEL.machineryPrefix.length).trim();
            details.machinery.push({
                id: task.id,
                // The enum's own "not known" members, never a guessed machine or owner.
                type: (MACHINE_TYPES.has(said) ? said : 'unknown') as DailyLog['machinery'][number]['type'],
                ownership: 'unknown',
                ...(notes !== undefined && { notes }),
            });
            continue;
        }

        if (activityType === TASK_LABEL.irrigation) {
            details.irrigation.push({ id: task.id, ...(notes !== undefined && { notes }) });
            continue;
        }

        if (activityType.startsWith(TASK_LABEL.sprayPrefix) || activityType.startsWith(TASK_LABEL.fertilizerPrefix)) {
            const productName = productNamed(activityType);
            details.inputs.push({
                id: task.id,
                mix: productName ? [{ id: `mix_${task.id}`, productName }] : [],
                ...(productName !== undefined && { productName }),
                ...(notes !== undefined && { notes }),
            });
            continue;
        }

        if (activityType === TASK_LABEL.observation || activityType === TASK_LABEL.reminder) {
            details.observations?.push({
                id: task.id,
                plotId: plotId ?? FARM_GLOBAL_ID,
                cropId,
                dateKey: source.logDate,
                timestamp: task.occurredAtUtc,
                // The line's note IS what he noted; the label is not his text.
                textRaw: notes ?? '',
                noteType: activityType === TASK_LABEL.reminder ? 'reminder' : 'observation',
            });
            continue;
        }

        const status = statusOf(task.executionStatus);
        details.cropActivities.push({
            id: task.id,
            title: activityType,
            workTypes: [activityType],
            ...(notes !== undefined && { notes }),
            ...(status && { status }),
        });
    }

    return details;
}
