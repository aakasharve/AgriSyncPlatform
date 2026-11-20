// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane POSTPONE-B; founder pick B, round 5 question 4) - "पुढे ठरवा" with a limit:
 *   - the row shows how many times the step was postponed (Devanagari digits, an amber chip) to everyone who sees it, authority or not;
 *   - after the SECOND postpone the postpone button is replaced by "आता ठरवा", which opens a small sheet: "काम नोंदवा" and "शेड्यूलमध्ये बघा";
 *   - a person without planning authority sees the chip and neither button, as before;
 *   - the server's refusal of a third postpone turns the row to "आता ठरवा" with a plain Marathi line (a stale phone cannot get past the limit);
 *   - the count rides the wire as an optional field: absent / malformed is "never postponed", never an error.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../infrastructure/api/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { POSTPONE_LIMIT, clearRescheduledForTests, scheduledWorkItemOf, type ScheduledWorkItem } from '../scheduledWork';
import { StepRow } from '../components/AttentionItemRow';
import { PostponeLimitError, rescheduleStep } from '../data/rescheduleStep';

const wire = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    plannedActivityId: 'step-1', farmId: 'f1', plotId: 'p1', plotName: 'प्लॉट २', cropCycleId: 'cc1', activityName: 'फवारणी', stage: 'फुलोरा',
    plannedDate: '2026-11-13', daysLate: 0, isMissed: false,
    subscriptionId: 'sub-1', activityId: 'act-1', originalDate: '2026-11-10', ...extra,
});

const stepOf = (postponeCount?: unknown): ScheduledWorkItem => {
    const item = scheduledWorkItemOf(wire(postponeCount === undefined ? {} : { postponeCount }));
    expect(item).not.toBeNull();
    return item!;
};

const draw = (step: ScheduledWorkItem, props: Partial<React.ComponentProps<typeof StepRow>> = {}) =>
    render(<StepRow step={step} label="फवारणी" dueText="आज" tone="today"
        onRecord={() => undefined} onMove={async () => undefined} onOpenSchedule={() => undefined} {...props} />);

beforeEach(() => { apiFetch.mockReset(); clearRescheduledForTests(); });
afterEach(() => { cleanup(); });

describe('the count on the wire', () => {
    it('a whole count above zero is kept; absent, zero, negative, fractional or text is "never postponed"', () => {
        expect(stepOf(1).postponeCount).toBe(1);
        expect(stepOf(2).postponeCount).toBe(2);
        for (const bad of [undefined, 0, -1, 1.5, '2', null]) {
            expect(stepOf(bad).postponeCount, `read ${String(bad)}`).toBeUndefined();
        }
    });

    it('the limit the phone draws is the one the server enforces', () => {
        expect(POSTPONE_LIMIT).toBe(2);
    });
});

describe('the chip', () => {
    it('shows "१ वेळा पुढे ढकललं" after one postpone and "२ वेळा पुढे ढकललं" after two, with 14 px text', () => {
        const { rerender } = draw(stepOf(1));
        expect(screen.getByTestId('attention-postponed-step-1')).toHaveTextContent('१ वेळा पुढे ढकललं');
        expect(screen.getByTestId('attention-postponed-step-1').className).toContain('text-[14px]');

        rerender(<StepRow step={stepOf(2)} label="फवारणी" dueText="आज" tone="today" onRecord={() => undefined} onMove={async () => undefined} />);
        expect(screen.getByTestId('attention-postponed-step-1')).toHaveTextContent('२ वेळा पुढे ढकललं');
    });

    it('no chip for a step never postponed', () => {
        draw(stepOf());
        expect(screen.queryByTestId('attention-postponed-step-1')).toBeNull();
    });
});

describe('"पुढे ठरवा" until the second postpone, "आता ठरवा" after it', () => {
    it('never postponed and once postponed: "पुढे ठरवा" is there, "आता ठरवा" is not', () => {
        const { rerender } = draw(stepOf());
        expect(screen.getByTestId('attention-later-step-1')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-decide-step-1')).toBeNull();

        rerender(<StepRow step={stepOf(1)} label="फवारणी" dueText="आज" tone="today" onRecord={() => undefined} onMove={async () => undefined} onOpenSchedule={() => undefined} />);
        expect(screen.getByTestId('attention-later-step-1')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-decide-step-1')).toBeNull();
    });

    it('after two: "पुढे ठरवा" is gone, "आता ठरवा" (44 px) stands where it was, "काम नोंदवा" stays', () => {
        draw(stepOf(2));

        expect(screen.queryByTestId('attention-later-step-1')).toBeNull();
        expect(screen.getByTestId('attention-decide-step-1')).toHaveTextContent('आता ठरवा');
        expect(screen.getByTestId('attention-decide-step-1').className).toContain('min-h-[44px]');
        expect(screen.getByTestId('attention-record-step-1')).toBeInTheDocument();
    });

    it('"आता ठरवा" opens a sheet with "काम नोंदवा" and "शेड्यूलमध्ये बघा", each a 44 px door that closes the sheet', () => {
        const onRecord = vi.fn();
        const onOpenSchedule = vi.fn();
        draw(stepOf(2), { onRecord, onOpenSchedule });
        expect(screen.queryByTestId('attention-decide-sheet-step-1')).toBeNull();

        fireEvent.click(screen.getByTestId('attention-decide-step-1'));
        const sheet = screen.getByTestId('attention-decide-sheet-step-1');
        expect(sheet).toHaveAttribute('role', 'dialog');
        expect(screen.getByTestId('attention-decide-record-step-1')).toHaveTextContent('काम नोंदवा');
        expect(screen.getByTestId('attention-decide-schedule-step-1')).toHaveTextContent('शेड्यूलमध्ये बघा');
        expect(screen.getByTestId('attention-decide-record-step-1').className).toContain('min-h-[44px]');
        expect(screen.getByTestId('attention-decide-schedule-step-1').className).toContain('min-h-[44px]');
        expect(screen.getByTestId('attention-decide-close-step-1').className).toContain('min-h-[44px]');

        fireEvent.click(screen.getByTestId('attention-decide-schedule-step-1'));
        expect(onOpenSchedule).toHaveBeenCalledWith(expect.objectContaining({ plannedActivityId: 'step-1' }));
        expect(screen.queryByTestId('attention-decide-sheet-step-1')).toBeNull();

        fireEvent.click(screen.getByTestId('attention-decide-step-1'));
        fireEvent.click(screen.getByTestId('attention-decide-record-step-1'));
        expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ plannedActivityId: 'step-1' }));
        expect(screen.queryByTestId('attention-decide-sheet-step-1')).toBeNull();

        fireEvent.click(screen.getByTestId('attention-decide-step-1'));
        fireEvent.click(screen.getByTestId('attention-decide-close-step-1'));
        expect(screen.queryByTestId('attention-decide-sheet-step-1')).toBeNull();
    });

    it('the sheet draws only the doors the page gives (P5): no schedule door, no schedule button; no door at all, no "आता ठरवा"', () => {
        const { unmount } = draw(stepOf(2), { onOpenSchedule: undefined });
        fireEvent.click(screen.getByTestId('attention-decide-step-1'));
        expect(screen.getByTestId('attention-decide-record-step-1')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-decide-schedule-step-1')).toBeNull();
        unmount();

        draw(stepOf(2), { onRecord: undefined, onOpenSchedule: undefined });
        expect(screen.queryByTestId('attention-decide-step-1')).toBeNull();
        expect(screen.queryByTestId('attention-later-step-1')).toBeNull();
    });

    it('a person without planning authority sees the chip and neither postpone button, as before', () => {
        draw(stepOf(2), { onMove: undefined });

        expect(screen.getByTestId('attention-postponed-step-1')).toHaveTextContent('२ वेळा पुढे ढकललं');
        expect(screen.queryByTestId('attention-later-step-1')).toBeNull();
        expect(screen.queryByTestId('attention-decide-step-1')).toBeNull();
        expect(screen.getByTestId('attention-record-step-1')).toBeInTheDocument();
    });
});

describe('the server refuses a third postpone', () => {
    it('rescheduleStep turns the server\'s limit code into PostponeLimitError, and any other refusal stays a plain failure', async () => {
        apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'ShramSafal.ScheduleStepPostponeLimit.InvalidCommand', message: 'x' }) });
        await expect(rescheduleStep(stepOf(1), '2026-11-14')).rejects.toBeInstanceOf(PostponeLimitError);

        apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'ShramSafal.ScheduleStepMoveDate.InvalidCommand' }) });
        const other = await rescheduleStep(stepOf(1), '2026-11-14').catch((e: unknown) => e);
        expect(other).not.toBeInstanceOf(PostponeLimitError);
        expect((other as Error).message).toContain('HTTP 400');

        apiFetch.mockResolvedValue({ ok: false, status: 400 }); // no readable body at all
        await expect(rescheduleStep(stepOf(1), '2026-11-14')).rejects.toThrow('HTTP 400');
        apiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'ScheduleStepPostponeLimit' }) });
        await expect(rescheduleStep(stepOf(1), '2026-11-14')).rejects.toThrow('HTTP 503');
    });

    it('a stale phone (count 1 here, 2 on the server): the row turns to "आता ठरवा" with a plain Marathi line, and nothing else changes', async () => {
        const onMove = vi.fn(async () => { throw new PostponeLimitError(); });
        draw(stepOf(1), { onMove });
        expect(screen.getByTestId('attention-later-step-1')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('attention-later-step-1'));
        fireEvent.click(screen.getByTestId('attention-later-choices-step-1-tomorrow'));

        await waitFor(() => expect(screen.getByTestId('attention-later-limit-step-1')).toBeInTheDocument());
        expect(screen.getByTestId('attention-later-limit-step-1')).toHaveTextContent('हे काम आधीच दोनदा पुढे ढकललं आहे. आता काम नोंदवा किंवा शेड्यूलमध्ये बघा.');
        expect(screen.getByTestId('attention-later-limit-step-1')).toHaveAttribute('role', 'alert');
        expect(screen.queryByTestId('attention-later-step-1')).toBeNull();
        expect(screen.getByTestId('attention-decide-step-1')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-later-failed-step-1')).toBeNull();
    });

    it('any other failure keeps "पुढे ठरवा" and today\'s "नेट सुरू आहे ना" line', async () => {
        draw(stepOf(1), { onMove: async () => { throw new Error('HTTP 503'); } });

        fireEvent.click(screen.getByTestId('attention-later-step-1'));
        fireEvent.click(screen.getByTestId('attention-later-choices-step-1-tomorrow'));

        await waitFor(() => expect(screen.getByTestId('attention-later-failed-step-1')).toBeInTheDocument());
        expect(screen.getByTestId('attention-later-step-1')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-later-limit-step-1')).toBeNull();
    });
});
