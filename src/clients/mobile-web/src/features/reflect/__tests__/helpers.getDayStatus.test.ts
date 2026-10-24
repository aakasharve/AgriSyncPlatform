/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-28-labour-v2-release-1 (task-0b, fix round 1)
 *
 * `getDayStatus` (`../helpers.tsx`) is the primary daily-history screen's day
 * classifier — `CompactCropCard.tsx` -> `ReflectPage.tsx` -> `mainView.tsx`.
 * It used to read `dayOutcome === 'WORK_RECORDED'` with NO fallback to the
 * buckets actually recorded on the log.
 *
 * Before task-0b, `logsReconciler.toDailyLog` fabricated `dayOutcome:
 * 'WORK_RECORDED'` for EVERY pulled log, so this screen accidentally always
 * showed "worked" correctly. Fixing the fabrication (task-0b) exposed this
 * function's own pre-existing weakness: `logSyncMutationService.ts` omits
 * `dayOutcome` from the push whenever it would be `WORK_RECORDED` — the
 * COMMON case for an ordinary voice-confirmed work day — so a genuinely
 * `dayOutcome: null` log with real crop activity, pulled to a second device
 * or after a reinstall, rendered as an empty (red) card. Real logged work,
 * invisible on the farmer's own primary screen.
 *
 * These tests pin the corrected precedence (mirrors `DayClassifier.Classify`):
 *   1. An explicit declaration wins: NO_WORK_PLANNED -> not worked,
 *      WORK_RECORDED -> worked, regardless of buckets.
 *   2. `null` means "the farmer did not say" — NOT "no work". Fall back to
 *      the evidence actually recorded (the same five buckets
 *      `DfesLensExtractor.HasWork` checks server-side).
 *   3. `null` AND no evidence -> genuinely empty.
 */
import { describe, it, expect } from 'vitest';
import { getDayStatus } from '../helpers';
import type { DailyLog } from '../../logs/logs.types';

function baseLog(overrides: Partial<DailyLog> & { id: string }): DailyLog {
    return {
        date: '2026-08-28',
        context: { selection: [] },
        dayOutcome: null,
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
        ...overrides,
    };
}

describe('getDayStatus', () => {
    it('THE REGRESSION THIS ROUND FIXES — a pulled log with dayOutcome: null but real crop activity renders as worked, not empty', () => {
        // Exactly the shape a cross-device pull produces for an ordinary
        // voice-confirmed work day: dayOutcome null (the server was never
        // told WORK_RECORDED — logSyncMutationService.ts omits it), real
        // work in the buckets.
        const log = baseLog({
            id: 'log-null-with-work',
            dayOutcome: null,
            cropActivities: [{ id: 'ca-1', title: 'Pruning', workTypes: ['Pruning'] }],
        });

        expect(getDayStatus(log)).toBe('worked');
    });

    it('dayOutcome: null with real labour also renders as worked', () => {
        const log = baseLog({
            id: 'log-null-with-labour',
            dayOutcome: null,
            labour: [{ id: 'lab-1', type: 'HIRED', count: 3, activity: 'Weeding' }],
        });

        expect(getDayStatus(log)).toBe('worked');
    });

    it('a declared NO_WORK_PLANNED day still renders as not-worked, even if some bucket carries leftover data', () => {
        // The declaration must keep winning — this is the counterweight to
        // the fix above, and mirrors DayClassifier.Classify's
        // HasDeclaredNoWorkReason-outranks-HasWork precedence (task-0b step 5).
        const log = baseLog({
            id: 'log-declared-no-work',
            dayOutcome: 'NO_WORK_PLANNED',
            cropActivities: [{ id: 'stray', title: 'Stray activity', workTypes: ['Stray'] }],
        });

        expect(getDayStatus(log)).toBe('empty');
    });

    it('an explicit WORK_RECORDED still renders as worked with empty buckets (declaration wins outright)', () => {
        const log = baseLog({ id: 'log-explicit-work-recorded', dayOutcome: 'WORK_RECORDED' });

        expect(getDayStatus(log)).toBe('worked');
    });

    it('dayOutcome: null with genuinely no evidence renders as empty', () => {
        const log = baseLog({ id: 'log-genuinely-empty', dayOutcome: null });

        expect(getDayStatus(log)).toBe('empty');
    });

    it('a FULL_DAY disturbance still renders as blocked ahead of any dayOutcome/bucket check', () => {
        const log = baseLog({
            id: 'log-blocked',
            dayOutcome: null,
            disturbance: {
                scope: 'FULL_DAY',
                group: 'weather',
                reason: 'rain',
                blockedSegments: ['irrigation'],
            },
        });

        expect(getDayStatus(log)).toBe('blocked');
    });

    it('no log at all renders as empty', () => {
        expect(getDayStatus(undefined)).toBe('empty');
    });
});
