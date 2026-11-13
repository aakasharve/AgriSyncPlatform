// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L008; doctrine: one language at a time) - the one-tap removal of a
 * reminder made from what he said has its words in `plannedWorkWords` (both languages, PROPOSED): Marathi mode shows the Marathi word and label,
 * English mode the English ones, and neither mixes the other in.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlannedTask } from '../../../types';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import { REMOVE_UNDO_MS, TodoSection } from '../overview/TodoSection';
import { buildTodoList, tickableIds } from '../overview/todoModel';
import { plannedWorkWords } from '../../plannedWork/plannedWorkWords';

afterEach(cleanup);

const task = {
    id: 't1', title: 'पाईपलाईन दुरुस्त करायची', plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'ai_extracted',
    createdAt: '2026-11-08', listSource: { scope: 'Unspecified', tickable: true, keptOnPhone: false },
} as PlannedTask;

const draw = (onRemove = vi.fn()) => {
    const list = buildTodoList({ tasks: [task], storeIds: tickableIds([task]), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: '2026-11-08' });
    render(<TodoSection list={list} onToggle={vi.fn()} onRemove={onRemove} />);
    return onRemove;
};

describe('L008 - "काढा" has an English twin', () => {
    it('Marathi mode: the Marathi word and label, from plannedWorkWords', () => {
        h.language = 'mr';
        const onRemove = draw();
        const button = screen.getByTestId('todo-remove-t1');
        const words = plannedWorkWords('mr');
        expect(button).toHaveTextContent(words.removeShort);
        expect(button).toHaveAttribute('aria-label', words.removeLabel);
        expect(words.removeShort).toBe('काढा');
        expect(button.textContent).not.toMatch(/[A-Za-z]/);
        // Lane REM-1: the removal is sent when the way back ("परत आणा") has passed - one tap, never two.
        vi.useFakeTimers();
        fireEvent.click(button);
        expect(onRemove).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(REMOVE_UNDO_MS + 100); });
        expect(onRemove).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('English mode: the English word and label only', () => {
        h.language = 'en';
        draw();
        const button = screen.getByTestId('todo-remove-t1');
        const words = plannedWorkWords('en');
        expect(button).toHaveTextContent(words.removeShort);
        expect(button).toHaveAttribute('aria-label', words.removeLabel);
        expect(button.textContent).not.toMatch(/[\u0900-\u097F]/);
        expect(button.getAttribute('aria-label')).not.toMatch(/[\u0900-\u097F]/);
    });
});
