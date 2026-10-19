// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE FOUNDER'S 1.0.15 CRASH, REPRODUCED THROUGH THE REAL LOAD PATH.
 *
 * APK 1.0.14's voice-attendance बरोबर saved records with `date: undefined`.
 * Their enqueue was refused (`logDate Required`), so they never left the phone,
 * and an in-place upgrade keeps them. On 1.0.15 the saved screen hands
 * `history` to `computePreviousLog`, whose `normalizeDateKey(log.date)` reads
 * `.includes` on undefined:
 *
 *     TypeError: Cannot read properties of undefined (reading 'includes')
 *
 * These tests drive `useAppData` with a stored ledger that holds one such row
 * and feed `computePreviousLog` the `history` the app actually builds — the
 * same array the saved screen passes as `allLogs`. Before the fix they fail
 * with exactly that TypeError.
 *
 * What the fix may NOT do (lead's brief, doctrine P4): invent a date for the
 * row, delete it, or re-send it. So the store's write methods are spies that
 * must stay untouched, and the row must stay out of every day, not be filed
 * under one.
 *
 * MOCKING mirrors useAppData.dataLoaded.test.ts: the providers and the sync
 * worker are stubbed; Dexie is the real thing on fake-indexeddb.
 *
 * spec: 2026-08-25-prod-cutover-waves (release 1.0.16)
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { DailyLog } from '../../../types';
import { computePreviousLog } from '../../../features/logs/services/dfesPreviousLog';

const TODAY = '2026-10-19';

const makeLog = (o: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1',
    date: TODAY,
    context: { selection: [{ cropId: 'crop-1', cropName: 'grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Plot 1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    ...o,
});

/** The record the farmer just saved (dated, as every 1.0.15+ save is). */
const todaysLog = makeLog({ id: 'today-log', irrigation: [{ id: 'ir-1', method: 'Drip', source: 'well' }] });

/** A real prior working day on the same plot: a spray, three days ago. */
const priorSpray = makeLog({ id: 'spray-2026-10-16', date: '2026-10-16', inputs: [{ id: 'in-1', method: 'Spray', mix: [] }] });

/**
 * The 1.0.14 voice-attendance row: labour on the same plot, no `date`. If
 * anything gave it a day (today, yesterday, ''), it would either change the
 * answer below or join a day it was never filed under.
 */
const legacyDateless = {
    ...makeLog({ id: 'legacy-dateless-1', labour: [{ id: 'lab-1', type: 'HIRED', count: 4 }], captureScope: 'labour' }),
    date: undefined,
} as unknown as DailyLog;

const storedLedger: DailyLog[] = [todaysLog, legacyDateless, priorSpray];

const dataSource = {
    crops: { getAll: vi.fn(async () => []), save: vi.fn(async () => { }) },
    profile: { get: vi.fn(async () => null) },
    logs: {
        getAll: vi.fn(async () => storedLedger),
        // Write paths. The fix must never reach for any of them.
        save: vi.fn(async () => { }),
        batchSave: vi.fn(async () => { }),
        delete: vi.fn(async () => { }),
    },
};

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({
        dataSource,
        auditPort: {},
        isDemoMode: false,
        setDemoMode: async () => { },
        isLoading: false,
    }),
}));

vi.mock('../../providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: false, session: null }),
}));

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => { }) },
}));

import { useAppData } from '../useAppData';

async function loadHistory(): Promise<DailyLog[]> {
    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.dataLoaded).toBe(true));
    return result.current.history;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('useAppData — an old dateless diary row can never crash a screen (1.0.16)', () => {
    it('computePreviousLog over the loaded history does not throw and ignores the dateless row', async () => {
        const history = await loadHistory();

        // The founder's crash: this threw "Cannot read properties of undefined
        // (reading 'includes')" while the dateless row was in `history`.
        expect(() => computePreviousLog(history, 'plot-1', TODAY)).not.toThrow();
        // The answer is the real prior work — the spray three days ago. The
        // labour-only row has no day, so it is never "last time" (P4).
        expect(computePreviousLog(history, 'plot-1', TODAY)).toEqual({ activityMr: 'फवारणी', daysAgo: 3 });
    });

    it('history holds every dated row, in stored order, and not the dateless one', async () => {
        const history = await loadHistory();

        expect(history.map(log => log.id)).toEqual(['today-log', 'spray-2026-10-16']);
    });

    it('the row stays on the phone: nothing is deleted, re-saved, re-dated or re-sent', async () => {
        await loadHistory();

        expect(dataSource.logs.delete).not.toHaveBeenCalled();
        expect(dataSource.logs.save).not.toHaveBeenCalled();
        expect(dataSource.logs.batchSave).not.toHaveBeenCalled();
        // The stored object itself is untouched — no date was written onto it.
        expect(legacyDateless.date).toBeUndefined();
        expect(storedLedger).toHaveLength(3);
    });

    it('one console warning with the count, naming no record', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await loadHistory();

        const historyWarnings = warn.mock.calls.filter(call => String(call[0]).startsWith('[history]'));
        expect(historyWarnings).toHaveLength(1);
        expect(String(historyWarnings[0][0])).toMatch(/^\[history\] 1 /);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('legacy-dateless-1');
    });
});
