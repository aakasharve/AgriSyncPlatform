/**
 * LogFactory.dueDate — Daily Clarity Loop v1, load-bearing fix.
 *
 * spec: dfes-companion-2026-07-11
 *
 * Proves the spine of the loop: a spoken plan ("उद्या फवारायचं आहे") whose
 * voice parse carries only a free-text `dueHint` ('उद्या') now gets a concrete
 * `dueDate`, so it is COUNTED by day-state math instead of being silently
 * dropped (`dayState.ts`: `if (!task.dueDate) return false`).
 */

import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import { computeDayState } from '../../../shared/utils/dayState';
import type { Clock } from '../services/Clock';
import type {
    FarmerProfile,
    CropProfile,
    LogScope,
    AgriLogResponse,
} from '../../../types';

// A fixed clock: 2026-07-13 06:00Z = 11:30 IST → IST date-key 2026-07-13 (Mon).
const FIXED_ISO = '2026-07-13T06:00:00.000Z';
const TODAY = '2026-07-13';
const TOMORROW = '2026-07-14';

const fixedClock: Clock = {
    now: () => new Date(FIXED_ISO),
    nowISO: () => FIXED_ISO,
    nowEpoch: () => new Date(FIXED_ISO).getTime(),
};

function makeProfile(): FarmerProfile {
    return {
        activeOperatorId: 'owner',
        trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false },
        operators: [],
    } as unknown as FarmerProfile;
}

/** Single plot, NO schedule → computeDayState contributes 0 planned-from-schedule. */
function makeCrops(): CropProfile[] {
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [
                { id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } },
            ] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeSinglePlotScope(): LogScope {
    return {
        selectedPlotIds: ['plot-a'],
        selectedCropIds: ['crop-grapes'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

function makeVoiceResponseWithTask(dueHint: string | undefined): AgriLogResponse {
    return {
        summary: 'उद्या फवारायचं आहे',
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        plannedTasks: [
            {
                title: 'फवारणी',
                dueHint,
                category: 'maintenance',
                sourceText: 'उद्या फवारायचं आहे',
                systemInterpretation: 'Spray tomorrow',
            },
        ],
        missingSegments: [],
    } as AgriLogResponse;
}

describe('LogFactory voice path — spoken due-date hint becomes a concrete dueDate', () => {
    it("'उद्या' → mirrored PlannedTask.dueDate === tomorrow (and dueHint preserved)", () => {
        const logs = LogFactory.createFromVoiceResult(
            makeVoiceResponseWithTask('उद्या'),
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
            undefined,
            undefined,
            fixedClock,
        );
        expect(logs).toHaveLength(1);

        const task = logs[0].plannedTasks?.find(t => t.title === 'फवारणी');
        expect(task).toBeDefined();
        expect(task!.dueDate).toBe(TOMORROW);
        // Provenance kept alongside the resolved date.
        expect(task!.dueHint).toBe('उद्या');
    });

    it('that task now COUNTS in pendingCount for tomorrow (was silently dropped before)', () => {
        const logs = LogFactory.createFromVoiceResult(
            makeVoiceResponseWithTask('उद्या'),
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
            undefined,
            undefined,
            fixedClock,
        );
        const crops = makeCrops();
        const tasks = logs[0].plannedTasks ?? [];

        // No schedule on the plot ⇒ plannedFromSchedule is 0, so pendingCount is
        // purely the spoken task's contribution.
        const tomorrow = computeDayState({ logs, crops, tasks, date: TOMORROW });
        expect(tomorrow.pendingCount).toBe(1);

        // Carry-forward semantics: a task due TOMORROW is not yet pending TODAY.
        const today = computeDayState({ logs, crops, tasks, date: TODAY });
        expect(today.pendingCount).toBe(0);

        // And it is exactly this task driving the count (delta vs no tasks).
        const baseline = computeDayState({ logs, crops, tasks: [], date: TOMORROW });
        expect(tomorrow.pendingCount - baseline.pendingCount).toBe(1);
    });

    it("VAGUE hint 'नंतर' → no dueDate, never counted (clear-only)", () => {
        const logs = LogFactory.createFromVoiceResult(
            makeVoiceResponseWithTask('नंतर'),
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
            undefined,
            undefined,
            fixedClock,
        );
        const task = logs[0].plannedTasks?.find(t => t.title === 'फवारणी');
        expect(task).toBeDefined();
        expect(task!.dueDate).toBeUndefined();

        const state = computeDayState({
            logs,
            crops: makeCrops(),
            tasks: logs[0].plannedTasks ?? [],
            date: TOMORROW,
        });
        expect(state.pendingCount).toBe(0);
    });
});
