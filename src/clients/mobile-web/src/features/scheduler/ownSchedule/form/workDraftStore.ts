/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker) - "the draft kept when the farmer goes back": the cards' unsaved
 * answers, kept in memory for this app session by plot-season and work (a new work, or the key being changed). Back keeps it; opening the same work
 * again shows it; saving clears it. Never stored on disk and never sent: an unsaved draft is not farm truth (P10), and nothing here is a save.
 */
import type { WorkDraft } from './workDraft';

const drafts = new Map<string, WorkDraft>();

export const draftKey = (cropCycleId: string, taskKey: string | null): string => `${cropCycleId}:${taskKey ?? 'new'}`;

export const readWorkDraft = (key: string): WorkDraft | null => drafts.get(key) ?? null;
export const keepWorkDraft = (key: string, draft: WorkDraft): void => { drafts.set(key, draft); };
export const dropWorkDraft = (key: string): void => { drafts.delete(key); };
/** Tests, and a sign-out. */
export const clearWorkDrafts = (): void => { drafts.clear(); };
