// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 Task 5; founder D-78, D-79, D-84 = 1; R14, R15) - लक्ष द्या's reminder list has the same
 * chips as करायची कामे (सगळ्या · नियोजनातून · शेड्यूलमधून · नोंदीतून), narrows to one source with one tap, keeps the counts, and each reminder card says who
 * made it and when, where it came from and (for the owner's setting) why everyone on the plot sees it - only what the server said.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlannedTask } from '../../../types';

const board = vi.hoisted(() => ({ cards: [] as unknown[] }));

vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => ({ tableName: 'shramsafal', lastSyncAt: '2026-11-09T03:30:00.000Z', version: 1 }) },
        appMeta: { get: async () => undefined },
    }),
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({ mutationQueue: { enqueue: vi.fn(), enqueueRepeatable: vi.fn() } }));
vi.mock('../../../core/session/FarmContext', async importActual => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: 'f1', currentFarm: { role: 'Mukadam', authorities: [] } }),
}));
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({
    default: ({ dailyLogId, playLabel }: { dailyLogId: string; playLabel?: string }) => <button type="button" data-testid={`ov-play-${dailyLogId}`}>{playLabel}</button>,
}));

import AttentionPage from '../pages/AttentionPage';
import { clearSeenSignalsForTests } from '../seenSignals';
import { clearRescheduledForTests } from '../scheduledWork';

type Reminder = NonNullable<NonNullable<PlannedTask['listSource']>['reminder']>;
const reminder = (over: Partial<Reminder>): Reminder => ({
    category: 'FromLogs', kind: 'Spoken', createdByUserId: 'u1', createdByName: 'राजू', createdAtUtc: '2026-11-04T05:45:00.000Z', sourceDailyLogId: 'log-1',
    mayPlayVoice: null, wordsWithheld: false, makerAlwaysShown: false, fromChosenPeopleRecord: false, ...over,
});
const task = (id: string, title: string, r: Reminder): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', createdAt: '2026-11-01T05:00:00.000Z', dueDate: '2026-11-05',
    sourceType: r.kind === 'Spoken' ? 'ai_extracted' : r.kind === 'Leftover' ? 'observation_derived' : 'manual',
    listSource: { scope: 'Unspecified', tickable: true, keptOnPhone: false, farmId: 'f1', reminder: r },
}) as PlannedTask;

const SPOKEN = task('r-spoken', 'पाईप बघायचा', reminder({ makerAlwaysShown: true, mayPlayVoice: true }));
const LEFT = task('r-left', 'फवारणी', reminder({ kind: 'Leftover', mayPlayVoice: false }));
const PLAN = task('r-plan', 'खत आणायचं', reminder({ category: 'FromPlanning', kind: 'Typed', sourceDailyLogId: null, createdByName: 'सीमा' }));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T06:00:00.000Z'));
    board.cards = [];
    clearSeenSignalsForTests();
    clearRescheduledForTests();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('लक्ष द्या - the reminder chips (D-79)', () => {
    it('shows the four chips with their counts and filters the late reminders by source', async () => {
        render(<AttentionPage onGo={vi.fn()} tasks={[SPOKEN, LEFT, PLAN]} crops={[]} onUpdateTask={vi.fn()} />);
        const chips = await screen.findByTestId('attention-chips');
        expect(within(chips).getByTestId('attention-chips-all')).toHaveTextContent('सगळ्या (३)');
        expect(within(chips).getByTestId('attention-chips-planning')).toHaveTextContent('नियोजनातून (१)');
        expect(within(chips).getByTestId('attention-chips-schedule')).toHaveTextContent('शेड्यूलमधून (०)');
        expect(within(chips).getByTestId('attention-chips-logs')).toHaveTextContent('नोंदीतून (२)');
        for (const id of ['r-spoken', 'r-left', 'r-plan']) expect(screen.getByTestId(`attention-reminder-${id}`)).toBeInTheDocument();

        fireEvent.click(within(chips).getByTestId('attention-chips-logs'));
        expect(screen.getByTestId('attention-reminder-r-spoken')).toBeInTheDocument();
        expect(screen.getByTestId('attention-reminder-r-left')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-reminder-r-plan')).toBeNull();

        fireEvent.click(within(chips).getByTestId('attention-chips-planning'));
        expect(screen.getByTestId('attention-reminder-r-plan')).toBeInTheDocument();
        expect(screen.queryByTestId('attention-reminder-r-spoken')).toBeNull();

        fireEvent.click(within(chips).getByTestId('attention-chips-all'));
        expect(screen.getAllByTestId(/^attention-reminder-r-/)).toHaveLength(3);
    });

    it('each card says who made it and when, where it came from, "ऐका" only when allowed, and the owner\'s setting line', async () => {
        render(<AttentionPage onGo={vi.fn()} tasks={[SPOKEN, LEFT, PLAN]} crops={[]} onUpdateTask={vi.fn()} />);
        await screen.findByTestId('attention-chips');
        expect(screen.getByTestId('attention-byline-r-spoken').textContent).toMatch(/^राजू · /);
        expect(screen.getByTestId('attention-byline-r-plan').textContent).toMatch(/^सीमा · /);
        expect(screen.getByTestId('attention-source-r-spoken')).toHaveTextContent('बोलण्यातून');
        expect(screen.getByTestId('attention-source-r-left')).toHaveTextContent('अर्धवट राहिलेलं');
        expect(screen.queryByTestId('attention-source-r-plan')).toBeNull();
        expect(within(screen.getByTestId('attention-listen-r-spoken')).getByTestId('ov-play-log-1')).toHaveTextContent('ऐका');
        expect(screen.queryByTestId('attention-listen-r-left')).toBeNull();
        expect(screen.getByTestId('attention-voice-rule-r-left')).toHaveTextContent('श्रमसफलच्या नियमानुसार हा आवाज तुम्हाला ऐकता येत नाही');
        expect(screen.getByTestId('attention-marked-r-spoken')).toHaveTextContent('मालकाच्या मांडणीनुसार ही आठवण या प्लॉटवरच्या सगळ्यांना दिसते.');
    });
});
