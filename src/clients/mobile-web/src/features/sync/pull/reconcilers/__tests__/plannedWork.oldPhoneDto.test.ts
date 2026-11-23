/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - the strict push rule's other half: a phone built BEFORE the new keys reads the NEW server response.
 * `pull-plannedwork-slice5.json` is the `plannedWork` array the real server answered in ScheduleFeedRealPostgresTests.OldPhone_PullsAScheduleMadePlan_AndOnlyNewKeysAreAdded
 * (a waiting plan from the own schedule, and an ordinary plan; test ids and test names only). The pre-slice-5 parser (frozen copy) reads both without crashing:
 * the waiting plan is an undated OPEN plan to it (never done, never late), and nothing new is invented. The current parser keeps the link, and an ordinary plan
 * keeps no new field at all.
 */
import { describe, expect, it } from 'vitest';
import sample from './fixtures/pull-plannedwork-slice5.json';
import { preSlice5PlannedWorkRowFromDto } from './fixtures/plannedWorkRowFromDto.preSlice5';
import { plannedWorkRowFromDto } from '../plannedWorkReconciler';
import type { PlannedWorkDto } from '../../../../../infrastructure/api/plannedWorkDtos';

const dtos = sample as unknown as PlannedWorkDto[];
const fromSchedule = dtos.find(d => d.source === 'Schedule')!;
const ordinary = dtos.find(d => d.source === 'Planning')!;

describe('an older phone reads a plan from the own schedule (slice 5)', () => {
    it('the captured server response carries both kinds of plan', () => {
        expect(dtos).toHaveLength(2);
        expect(fromSchedule.ownItemId).toBeTruthy();
        expect(fromSchedule.waiting).toBe(true);
        expect(ordinary.ownItemId ?? null).toBeNull();
    });

    it('the pre-slice-5 parser reads every row, and the waiting plan is an undated open plan to it', () => {
        const rows = dtos.map(preSlice5PlannedWorkRowFromDto);
        expect(rows.every(r => r !== null)).toBe(true);
        const waiting = rows.find(r => r!.id === fromSchedule.id)!;
        expect(waiting.plannedDate).toBeNull();
        expect(waiting.status).toBe('Open');
        expect(waiting.source).toBe('Schedule');
        expect(waiting.title).toBe(fromSchedule.title);
        expect(Object.keys(waiting)).not.toContain('ownItemId');
    });

    it('the current parser keeps the link, the expectation and the waiting state; an ordinary plan keeps no new field', () => {
        const linked = plannedWorkRowFromDto(fromSchedule)!;
        expect(linked.ownItemId).toBe(fromSchedule.ownItemId);
        expect(linked.scheduleTaskKey).toBe('flower');
        expect(linked.occurrence).toBe(1);
        expect(linked.waiting).toBe(true);
        expect(linked.expectedFrom).toBe(fromSchedule.expectedFrom);
        expect(linked.signAnswer ?? null).toBeNull();

        const plain = plannedWorkRowFromDto(ordinary)!;
        expect(Object.keys(plain)).not.toContain('ownItemId');
        expect(Object.keys(plain)).not.toContain('waiting');
    });

    it('an unknown sign answer from a later server is no answer (never guessed)', () => {
        const row = plannedWorkRowFromDto({ ...fromSchedule, signAnswer: 'maybe-later' })!;
        expect(row.signAnswer).toBeNull();
    });
});
