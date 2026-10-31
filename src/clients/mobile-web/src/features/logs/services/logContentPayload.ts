/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — WHAT SATHI UNDERSTOOD, as this
 * phone holds it, put on the wire so the server keeps it and no phone ever rebuilds a farmer's
 * record by guessing it back from flattened task lines.
 *
 * THE DOCUMENT IS THE LOG'S OWN BUCKETS, COPIED (`_log_content.zod.ts`): crop work, water,
 * inputs, notes, machinery, expenses and planned work — each item with its values, units,
 * `numbers{…spokenText}`, `sourceText` and `provenanceVerified` — plus the disturbance chip and
 * his whole words (founder D-40 §3). Labour is NOT here: it rides `labour[]` and its own
 * correction route, untouched.
 *
 * NEVER THROWS (doctrine P9). `MutationQueue.enqueue` safe-parses every payload and throws on
 * failure, so the document is checked against the SAME schema here first; a log whose details do
 * not fit (an item with no id, more than the size cap) gets NO content and goes on the wire the
 * old way — the record is never refused over its details.
 */
import {
    LOG_CONTENT_BUCKETS,
    LOG_CONTENT_SCHEMA_VERSION,
    LogContentSchema,
    type LogContentPayloadType,
} from '../../../../../../../sync-contract/schemas/payloads/_log_content.zod';
import { type DailyLog } from '../../../types';

export type LogContentPayload = LogContentPayloadType;

/** The buckets the document carries, in the order the server projects task lines from them. */
export const LOG_CONTENT_KEYS = LOG_CONTENT_BUCKETS;

/** JSON-shaped copy: what the wire carries and the server stores (no `undefined`, no functions). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface BuildLogContentOptions {
    /**
     * `true`: a document with no items is still a statement and must reach the server — for an EDIT
     * ("he removed them all") and, since lane OF-S fix pass 4 (R3-2), for every CREATE outside the
     * हजेरी door, so the server holds each record's create-time details and decides alone which of
     * its money must move with it. Without it, a log with no details sends no document.
     */
    evenIfEmpty?: boolean;
}

/**
 * What a log's details amount to on the wire:
 *   - `content`  — the document, checked against the contract;
 *   - `none`     — nothing to send (the हजेरी door, B002; or no details and not `evenIfEmpty`);
 *   - `withheld` — there ARE details, but they do not fit the contract (over the size cap, or an
 *                  item the contract cannot carry). They stay on this phone, and the farmer is told so
 *                  (review S5) — never only a console line.
 */
export type LogContentOutcome =
    | { kind: 'content'; content: LogContentPayload }
    | { kind: 'none' }
    | { kind: 'withheld'; issues: string[] };

/**
 * The content document of a log, or `undefined` when it has none to send or it does not fit
 * the contract. A labour-door save (`captureScope: 'labour'`) never has one: the farmer
 * confirmed only labour there (B002).
 */
export function buildLogContent(log: DailyLog, options: BuildLogContentOptions = {}): LogContentPayload | undefined {
    const outcome = logContentFor(log, options);
    return outcome.kind === 'content' ? outcome.content : undefined;
}

/** {@link buildLogContent}, saying WHY there is no document when there is none. */
export function logContentFor(log: DailyLog, options: BuildLogContentOptions = {}): LogContentOutcome {
    if (log.captureScope === 'labour') {
        return { kind: 'none' };
    }

    const content: Record<string, unknown> = { schema: LOG_CONTENT_SCHEMA_VERSION };
    if (log.meta?.createdAtISO) {
        content.capturedAtUtc = log.meta.createdAtISO;
    }
    if (typeof log.fullTranscript === 'string' && log.fullTranscript.length > 0) {
        content.fullTranscript = log.fullTranscript;
    }
    for (const bucket of LOG_CONTENT_BUCKETS) {
        const rows = (log as unknown as Record<string, unknown>)[bucket];
        if (Array.isArray(rows) && rows.length > 0) {
            content[bucket] = plain(rows);
        }
    }
    if (log.disturbance && typeof log.disturbance === 'object') {
        content.disturbance = plain(log.disturbance);
    }
    const carriesSomething = Object.keys(content).some(key => key !== 'schema' && key !== 'capturedAtUtc');
    if (!carriesSomething && !options.evenIfEmpty) {
        return { kind: 'none' };
    }

    const checked = LogContentSchema.safeParse(content);
    if (!checked.success) {
        const issues = checked.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'} ${issue.message}`);
        console.warn(JSON.stringify({ component: 'logContentPayload', action: 'content_withheld', logId: log.id, issues }));
        return { kind: 'withheld', issues };
    }
    return { kind: 'content', content: content as LogContentPayload };
}
