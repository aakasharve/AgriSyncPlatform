// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// TaskCloseConfirm — the one-tap suggest-and-confirm card (Task 5,
// "राहिलं → झालं"). Renders the candidate's task title; होय calls onConfirm;
// नाही calls onDismiss. This component NEVER flips the task itself — it only
// reports the tap, so these tests assert on the callback, not on any status
// mutation (the mutation is the caller's responsibility).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import TaskCloseConfirm from '../TaskCloseConfirm';
import type { TaskCloseCandidate } from '../../../services/taskAutoClose';
import type { PlannedTask } from '../../../../../types';

function makeCandidate(overrides: Partial<PlannedTask> = {}): TaskCloseCandidate {
    const task: PlannedTask = {
        id: 'task-1',
        title: 'Pruning',
        plotId: 'plot-a',
        cropId: 'crop-1',
        priority: 'normal',
        status: 'pending',
        sourceType: 'manual',
        createdAt: '2026-07-01T06:00:00.000Z',
        dueDate: '2026-07-14',
        ...overrides,
    };
    return { task, matchedActivityTitle: 'Pruning done today' };
}

afterEach(() => {
    cleanup();
});

describe('TaskCloseConfirm', () => {
    it('renders the candidate task title', () => {
        render(
            <TaskCloseConfirm candidate={makeCandidate()} onConfirm={() => {}} onDismiss={() => {}} />,
        );

        expect(screen.getByTestId('task-close-confirm-title')).toHaveTextContent('Pruning');
    });

    it('होय (yes) calls onConfirm and NOT onDismiss', () => {
        const onConfirm = vi.fn();
        const onDismiss = vi.fn();
        render(
            <TaskCloseConfirm candidate={makeCandidate()} onConfirm={onConfirm} onDismiss={onDismiss} />,
        );

        fireEvent.click(screen.getByTestId('task-close-confirm-yes'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('नाही (no) calls onDismiss and NOT onConfirm', () => {
        const onConfirm = vi.fn();
        const onDismiss = vi.fn();
        render(
            <TaskCloseConfirm candidate={makeCandidate()} onConfirm={onConfirm} onDismiss={onDismiss} />,
        );

        fireEvent.click(screen.getByTestId('task-close-confirm-no'));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('renders both होय and नाही button labels', () => {
        render(
            <TaskCloseConfirm candidate={makeCandidate()} onConfirm={() => {}} onDismiss={() => {}} />,
        );

        expect(screen.getByTestId('task-close-confirm-yes')).toHaveTextContent('होय');
        expect(screen.getByTestId('task-close-confirm-no')).toHaveTextContent('नाही');
    });
});
