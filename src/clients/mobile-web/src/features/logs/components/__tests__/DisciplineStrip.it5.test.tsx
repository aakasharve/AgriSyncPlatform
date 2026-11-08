// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 3; founder 2026-11-06, D-98) - the streak strip shows DAYS and the
 * small total line the founder kept (D-98: "Keep the small total line"): no daily points list, no "15" (the daily cap is a server
 * tunable and is never a screen word). It adds no display of its own: it shows what the SERVER's engagement says, so a worker's
 * streak moves when the owner confirms (the server counts the day), and not when the worker merely tells it.
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t as translate } from '../../../../i18n/translations';

vi.mock('../../../../app/featureFlags', async (importActual) => {
    const actual = await importActual<typeof import('../../../../app/featureFlags')>();
    return { ...actual, FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, disciplineSystem: true } };
});
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
}));
const getFarmerEngagement = vi.hoisted(() => vi.fn());
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { getFarmerEngagement: (...args: unknown[]) => getFarmerEngagement(...args) } }));

import { DisciplineStrip } from '../DisciplineStrip';
import { useFarmerEngagement } from '../../hooks/useFarmerEngagement';
import type { FarmerEngagementDto } from '../../../../infrastructure/api/resources/DfesResource';

const engagement = (streak: number, total = 60): FarmerEngagementDto => ({
    currentStreak: streak, longestStreak: 9, totalShramPoints: total, lastAccountedDate: '2026-11-08', totalRichDays: 12, unlockStatus: 'locked',
});

/**
 * The strip as the app feeds it: the server's engagement for the farm, read again on demand. The page also holds this phone's own
 * records: "add an unconfirmed log" saves one and tells the app to read again, as a save does (`agrisync:sync-reconciled`).
 */
const Harness: React.FC = () => {
    const { engagement: dto, refresh } = useFarmerEngagement('farm-1');
    const [logs, setLogs] = React.useState<string[]>([]);
    return (
        <div>
            <DisciplineStrip engagement={dto} />
            <span data-testid="local-logs">{logs.length}</span>
            <button type="button" data-testid="reread" onClick={() => { void refresh(); }}>reread</button>
            <button type="button" data-testid="add-log" onClick={() => { setLogs(l => [...l, `log-${l.length}`]); window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled')); }}>add</button>
        </div>
    );
};

beforeEach(() => { getFarmerEngagement.mockReset(); });
afterEach(cleanup);

describe('DisciplineStrip - days only (IT5 Task 3)', () => {
    it('NoDailyPointsList_And_No15: days, the chain and the one kept total line - no list of daily points, no "15"', () => {
        render(<DisciplineStrip engagement={engagement(5, 60)} />);
        const strip = screen.getByTestId('discipline-strip');
        expect(screen.getByTestId('discipline-streak')).toHaveTextContent('५');
        // exactly the pieces the strip has always had; nothing was added for points
        expect(Array.from(strip.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')))
            .toEqual(['discipline-streak', 'discipline-tomorrow', 'discipline-tomorrow-line', 'discipline-recognition', 'discipline-points']);
        expect(strip.querySelector('ul, ol, li, table, tr')).toBeNull(); // no list of any kind
        expect(screen.getByTestId('discipline-points')).toHaveTextContent('६० श्रम-गुण'); // D-98: the small total stays
        const text = strip.textContent ?? '';
        expect(text).not.toMatch(/15|१५/);
        expect(text).not.toMatch(/आजचे गुण|आज.*गुण|कमाल|मर्यादा/); // no "today's points" and no cap wording
        // one number for days (the streak), one for the total: nothing else
        expect(text.match(/[०-९0-9]+/g)).toEqual(expect.arrayContaining(['५', '६०']));
        expect((text.match(/[०-९0-9]+/g) ?? []).length).toBeLessThanOrEqual(3);
    });

    it('NoDailyPointsList_And_No15 (source): the strip and its words never name the daily cap or a daily points figure', () => {
        const root = path.resolve(process.cwd(), 'src', 'features', 'logs');
        for (const rel of [['components', 'DisciplineStrip.tsx'], ['services', 'disciplineRecognition.ts']]) {
            const source = fs.readFileSync(path.join(root, ...rel), 'utf8');
            expect(source).not.toMatch(/DailyPointCap|dailyPointCap|pointsToday|todayPoints|dailyPoints|\bcap\b/i);
        }
    });

    it('WorkerSees_StreakMovesWhenOwnerConfirms_Line: the strip displays what the server returns - when the answer of the server moves (after the owner confirms), the number and the line move with it', async () => {
        // the worker told today's work: the server has not counted it yet, so the chain stands where it was
        getFarmerEngagement.mockResolvedValue(engagement(1));
        render(<Harness />);
        await waitFor(() => expect(screen.getByTestId('discipline-streak')).toHaveTextContent('१'));
        expect(screen.getByTestId('discipline-recognition')).toHaveTextContent('आजचं काम सांगितलं. उद्याही भेटूया.');

        // the owner confirmed: the server's answer moves, and the strip follows it - streak, dots and the line
        getFarmerEngagement.mockResolvedValue(engagement(2));
        await act(async () => { fireEvent.click(screen.getByTestId('reread')); });
        await waitFor(() => expect(screen.getByTestId('discipline-streak')).toHaveTextContent('२'));
        expect(screen.getByTestId('discipline-recognition')).toHaveTextContent('सलग २ दिवस काम सांगितलं!');
        expect(getFarmerEngagement).toHaveBeenCalledWith('farm-1');
    });

    it('Streak_DoesNotMoveUntilConfirmed: a new unconfirmed log on this phone moves nothing; only a changed count from the server moves the streak', async () => {
        getFarmerEngagement.mockResolvedValue(engagement(3));
        render(<Harness />);
        await waitFor(() => expect(screen.getByTestId('discipline-streak')).toHaveTextContent('३'));

        // a new, unconfirmed log is saved here and the app is told (as every save does): the strip counts nothing of it
        fireEvent.click(screen.getByTestId('add-log'));
        fireEvent.click(screen.getByTestId('add-log'));
        expect(screen.getByTestId('local-logs')).toHaveTextContent('2');
        expect(screen.getByTestId('discipline-streak')).toHaveTextContent('३');
        // the server still says 3 (nothing confirmed yet): reading again keeps it
        await act(async () => { fireEvent.click(screen.getByTestId('reread')); });
        await waitFor(() => expect(getFarmerEngagement).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId('discipline-streak')).toHaveTextContent('३');
        expect(screen.getByTestId('discipline-recognition')).toHaveTextContent('सलग ३ दिवस');

        // the server counts the day (the owner confirmed): only now does the streak change
        getFarmerEngagement.mockResolvedValue(engagement(4));
        await act(async () => { fireEvent.click(screen.getByTestId('reread')); });
        await waitFor(() => expect(screen.getByTestId('discipline-streak')).toHaveTextContent('४'));
        expect(screen.getByTestId('local-logs')).toHaveTextContent('2');
    });

    it('Streak_DoesNotMoveUntilConfirmed: when the server cannot be read there is no strip and no number (nothing is invented)', async () => {
        getFarmerEngagement.mockResolvedValueOnce(engagement(3)).mockRejectedValue(new Error('offline'));
        render(<Harness />);
        await waitFor(() => expect(screen.getByTestId('discipline-streak')).toHaveTextContent('३'));
        await act(async () => { fireEvent.click(screen.getByTestId('reread')); });
        await waitFor(() => expect(screen.queryByTestId('discipline-strip')).toBeNull());
    });
});
