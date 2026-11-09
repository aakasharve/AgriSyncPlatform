/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-78 = 1, P3) - the id of a task made from a SPOKEN planned
 * item, the same on the server (`ShramSafal.Domain.Planning.PlannedWorkIds`) and here: a name-based UUID (RFC 4122 version 5) of the
 * log and the item. The phone shows a spoken reminder the moment he saves, under THIS id, until the pull brings the server's row (same
 * id: the pull replaces the mirror, never doubles it). One shared fixture of vectors pins both sides
 * (`sync-contract/tests/fixtures/planned-work-ids.json`).
 *
 * The key is the item's OWN id, never its place in the list: a later reorder, or an item inserted in the middle, can neither re-create
 * a task nor collide with one. An item of the voice parse a 1.0.17 phone confirmed has no id; the server keys it by its place in that
 * parse (`jobTaskId`) - a 1.0.17 phone never runs this code, so only the tests use it here.
 */
import { v5 as uuidv5 } from 'uuid';

/** NEVER CHANGE THIS VALUE. Every spoken reminder id ever made lives under it; a new one would re-create every task once. */
export const SPOKEN_TASK_NAMESPACE = 'c2f6d3a8-4b1e-4f57-9d0a-6e8b7a1c5d93';

/** The name prefix of the one-time upload of the old local to-dos (the same namespace: one function, not two). */
export const LEGACY_TODO_PREFIX = 'legacy-todo:';

const logKey = (dailyLogId: string): string => dailyLogId.toLowerCase();

/** The task id for a content item (`plannedTasks[].id`) of a log. */
export function spokenTaskId(dailyLogId: string, itemId: string): string {
    return uuidv5(`${logKey(dailyLogId)}:plannedTasks:${itemId}`, SPOKEN_TASK_NAMESPACE);
}

/** The task id for the item at `index` of the voice parse a log was confirmed from (1.0.17's way; the server's rule). */
export function jobTaskId(dailyLogId: string, index: number): string {
    return uuidv5(`${logKey(dailyLogId)}:job:${index}`, SPOKEN_TASK_NAMESPACE);
}

/** The task id of an old local to-do uploaded once: the same old to-do is always the same task ("run twice" is one change). */
export function legacyTodoTaskId(oldTodoId: string): string {
    return uuidv5(`${LEGACY_TODO_PREFIX}${oldTodoId}`, SPOKEN_TASK_NAMESPACE);
}
