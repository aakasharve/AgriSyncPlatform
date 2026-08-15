// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4 — Task 6.
 *
 * `HarvestIncomePage` is route 'income' — reached from BottomNavigation's
 * "Income" tab and from ReflectPage's "In Hand Income" tile. It used to host
 * the harvest sale/session/config flow whose save handler only ever updated
 * React state (`handleEntrySaved` called `setSessions`, never
 * `updateHarvestSession`), so a recorded sale vanished on navigation. This
 * suite proves:
 *   1. the page now shows the honest coming-soon message instead of that
 *      flow, and the broken controls (Log New Harvest, Save Entry) are gone
 *      — not merely hidden behind a still-reachable path;
 *   2. pre-existing local harvest data (config + a session) survives
 *      rendering the page untouched — it is not deleted or migrated;
 *   3. "Other Income" — a different, working feature D4 keeps shipping —
 *      still renders and its entry point is still reachable.
 *
 * `getOtherIncomeEntries` is the only harvestService function this page
 * still imports, so it is mocked here to isolate the page from the finance
 * mutation pipeline `addOtherIncomeEntry` calls into; `OtherIncomeSheet` is
 * stubbed for the same reason — its own write path is out of this task's
 * scope and has no test coverage of its own yet.
 *
 * `harvestService.ts` imports `financeCommandService.ts`, whose own import
 * graph reaches for IndexedDB at load time; jsdom does not provide one. Per
 * the established precedent (financeCommandService.test.ts,
 * REPRO-A3-money-integrity.test.ts, LogCommandService.captureMoneyEvents.test.ts),
 * `fake-indexeddb/auto` is imported first so that chain has a real (fake)
 * IndexedDB to talk to, rather than hand-mocking every module in it.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CropProfile } from '../../types';
import type { OtherIncomeEntry } from '../../features/logs/harvest.types';

const mockGetOtherIncomeEntries = vi.fn<() => OtherIncomeEntry[]>(() => []);

// `services/harvestService.ts` imports `financeCommandService.ts`, which
// calls `backgroundSyncWorker.triggerNow()` after a real mutation — a path
// this suite never exercises (only the localStorage-backed config/session
// functions and a mocked `getOtherIncomeEntries` are used), but the
// singleton's own construction reaches for IndexedDB, which jsdom does not
// provide. Mocked per the precedent in LabourFeature.test.tsx /
// FieldOperatorPicker.test.tsx rather than pulling in `fake-indexeddb`,
// since no test here needs real Dexie behaviour.
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

vi.mock('../../services/harvestService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/harvestService')>();
    return {
        ...actual,
        getOtherIncomeEntries: (...args: unknown[]) => mockGetOtherIncomeEntries(...(args as [])),
    };
});

vi.mock('../../features/logs/components/harvest/OtherIncomeSheet', () => ({
    default: ({ onClose, onSave }: { onClose: () => void; onSave: () => void }) => (
        <div data-testid="other-income-sheet-stub">
            <button type="button" onClick={onSave}>stub-save</button>
            <button type="button" onClick={onClose}>stub-close</button>
        </div>
    ),
}));

import HarvestIncomePage from '../HarvestIncomePage';
import { saveHarvestConfig, startHarvestSession, getHarvestConfig, getHarvestSessions } from '../../services/harvestService';

const CROPS: CropProfile[] = [{
    id: 'crop-1',
    name: 'Grapes',
    color: 'bg-emerald-400',
    plots: [{ id: 'plot-1', name: 'Plot A' }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any];

beforeEach(() => {
    localStorage.clear();
    mockGetOtherIncomeEntries.mockReturnValue([]);
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('HarvestIncomePage — route "income" (Task 6, spec D4)', () => {
    it('shows the honest harvest coming-soon message', () => {
        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);
        expect(screen.getByTestId('harvest-coming-soon')).toBeInTheDocument();
        expect(screen.getByText(/harvest tracking is coming soon/i)).toBeInTheDocument();
    });

    it('no longer offers "Log New Harvest" or a sale-entry save control', () => {
        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);
        expect(screen.queryByText(/log new harvest/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save entry/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/patti/i)).not.toBeInTheDocument();
    });

    it('leaves pre-existing local harvest config and session data untouched', () => {
        const config = saveAndReadConfig();
        const session = startHarvestSession('plot-1', 'crop-1', config);

        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);

        // Same data, same shape, after the coming-soon page has rendered —
        // nothing in this component reads, writes or deletes it.
        expect(getHarvestConfig('plot-1')).toEqual(config);
        const sessionsAfter = getHarvestSessions('plot-1', 'crop-1');
        expect(sessionsAfter).toHaveLength(1);
        expect(sessionsAfter[0]).toEqual(session);
    });

    it('keeps "Other Income" reachable and rendering its existing entries', () => {
        mockGetOtherIncomeEntries.mockReturnValue([{
            id: 'inc-1',
            date: '2026-08-01',
            source: 'OTHER',
            description: 'Sold scrap drip pipe',
            amount: 500,
        }]);

        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);

        expect(screen.getByText('Sold scrap drip pipe')).toBeInTheDocument();
        expect(screen.getByText(/\+₹500/)).toBeInTheDocument();
    });

    it('"+ Add Custom" still opens the Other Income entry surface', () => {
        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);

        expect(screen.queryByTestId('other-income-sheet-stub')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('+ Add Custom'));
        expect(screen.getByTestId('other-income-sheet-stub')).toBeInTheDocument();
    });
});

function saveAndReadConfig() {
    saveHarvestConfig({
        plotId: 'plot-1',
        pattern: 'SINGLE',
        configuredAt: '2026-01-01T00:00:00.000Z',
        primaryUnit: { type: 'WEIGHT', weightUnit: 'KG' },
    });
    const config = getHarvestConfig('plot-1');
    if (!config) {
        throw new Error('test setup: saveHarvestConfig did not persist');
    }
    return config;
}
