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
 *      rendering the page untouched — it is not deleted or migrated. FIX
 *      ROUND 1: this must be asserted against the RAW store
 *      (readHarvestConfigRaw/readHarvestSessionsRaw), not through
 *      getHarvestConfig/getHarvestSessions — those fall back to a
 *      module-level cache populated by the same seeding call, so asserting
 *      through them would still pass even if the page wiped every
 *      `harvest_config_*`/`harvest_sessions_*` localStorage key on mount.
 *      The raw functions read localStorage directly, so this is the only
 *      form of the assertion that can fail for the failure mode it guards;
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
 *
 * LANGUAGE. The page hands the farmer's language preference to
 * `HarvestComingSoon`, whose copy exists in both `mr` and `en`
 * (`i18n/harvestAvailabilityTranslations.ts`). `useLanguage` throws outside
 * `<LanguageProvider>` and `render` mounts none, so the same stand-in
 * `ReviewInboxSheet.noApproval.test.tsx` uses is installed below. It defaults
 * to `'mr'` — NOT `'en'` — because that is what the app itself defaults to
 * since `d1c3837d`, and a suite that quietly tested English would have gone
 * on passing through the exact defect this notice's Marathi was written to
 * fix: a warning the reader cannot read.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CropProfile } from '../../types';
import type { OtherIncomeEntry } from '../../features/logs/harvest.types';
import { t as translate } from '../../i18n/translations';
import type { Language } from '../../i18n/language';
import { harvestAvailabilityTranslations } from '../../i18n/harvestAvailabilityTranslations';

const mockGetOtherIncomeEntries = vi.fn<() => OtherIncomeEntry[]>(() => []);

// The app's own default (`i18n/LanguageContext.tsx`), so the default render
// below is the one a pilot farmer actually gets.
const langRef = { current: 'mr' as Language };

vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

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
import { saveHarvestConfig, startHarvestSession, getHarvestConfig } from '../../services/harvestService';
// Read-only import of the raw store — NOT an edit to
// infrastructure/storage/, and the only way to prove the underlying
// localStorage bytes (not a module-level cache) survive the render. See the
// suite-level comment above (fix round 1, IMPORTANT finding).
import { readHarvestConfigRaw, readHarvestSessionsRaw } from '../../infrastructure/storage/HarvestLegacyStore';

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
    langRef.current = 'mr';
    vi.clearAllMocks();
});

describe('HarvestIncomePage — route "income" (Task 6, spec D4)', () => {
    it.each<Language>(['mr', 'en'])(
        'shows the honest harvest coming-soon message, readable in %s',
        (language) => {
            langRef.current = language;
            render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);
            const notice = screen.getByTestId('harvest-coming-soon');
            expect(notice).toBeInTheDocument();
            // The page must hand DOWN the preference, not pick one. Asserting
            // the literal shipped copy for the requested language is the only
            // form of this that fails when the wiring is dropped — a testid
            // check alone passed all the way through the English-only defect.
            expect(notice.textContent).toContain(
                harvestAvailabilityTranslations[language].harvestUnavailableTitle,
            );
            expect(notice.textContent).toContain(
                harvestAvailabilityTranslations[language].harvestUnavailableBody,
            );
        },
    );

    it('no longer offers "Log New Harvest" or a sale-entry save control', () => {
        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);
        expect(screen.queryByText(/log new harvest/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save entry/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/patti/i)).not.toBeInTheDocument();
    });

    it('leaves pre-existing local harvest config and session data untouched (raw store)', () => {
        const config = saveAndReadConfig();
        startHarvestSession('plot-1', 'crop-1', config);

        // Snapshot the RAW localStorage bytes before the page ever renders —
        // not the service's cached read — so a page that wiped these keys on
        // mount would show up here even though `getHarvestConfig` /
        // `getHarvestSessions` would still return the in-memory cache and
        // silently pass.
        const rawConfigBefore = readHarvestConfigRaw('plot-1');
        const rawSessionsBefore = readHarvestSessionsRaw('plot-1', 'crop-1');
        expect(rawConfigBefore).not.toBeNull();
        expect(rawSessionsBefore).not.toBeNull();

        render(<HarvestIncomePage context={null} crops={CROPS} onBack={() => undefined} />);

        // Byte-identical after the coming-soon page has rendered — this
        // component reads, writes and deletes nothing under
        // infrastructure/storage/.
        expect(readHarvestConfigRaw('plot-1')).toBe(rawConfigBefore);
        expect(readHarvestSessionsRaw('plot-1', 'crop-1')).toBe(rawSessionsBefore);
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
