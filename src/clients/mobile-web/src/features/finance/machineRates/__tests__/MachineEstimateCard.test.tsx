// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the machine cost reads the rate card"). The
 * "अंदाजे" machine cost on the money home, KEPT APART from confirmed money:
 *   - a record line that states no machine cost, of a machine with a rate he typed: "३ तास × ₹ 900 तासाला" and "अंदाजे ₹ 2,700";
 *   - a line that states its cost is not here (its money is the confirmed money); a machine with no rate is not here (no default);
 *   - a rate the record cannot use (per acre): the rate, and "no estimate", never an amount;
 *   - the card says it is an estimate, not in the total spent; the money home's own figures do not move;
 *   - nothing to estimate (or a seat that does not read work rates): no card at all; English mode is English only.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en', answer: null as null | Record<string, unknown> }));
vi.mock('../../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../farmRates/farmRatesApi', async (importActual) => {
    const real = await importActual<typeof import('../../farmRates/farmRatesApi')>();
    return { ...real, fetchFarmRates: vi.fn(async () => (h.answer ? real.farmRatesFrom(h.answer) : null)), fetchRateSuggestions: vi.fn(async () => []) };
});

import { MachineEstimateCard } from '../MachineEstimateCard';
import FinanceManagerHome from '../../../../pages/FinanceManagerHome';
import type { DailyLog, MachineryEvent } from '../../../../types';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { FARM_A, MACHINE_A, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';

configure({ asyncUtilTimeout: 5000 });

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const DEVANAGARI = /[ऀ-ॿ]/;
const rate = (over: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-00000000c001', rateLineId: MACHINE_A, farmId: FARM_A, version: 1, kind: 'Work', itemName: 'महिंद्रा 575', unit: null,
    basis: 'PerHour', workerCategory: null, amount: 900, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null, retired: false,
    suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.000Z', ...over,
});
const answer = (rates: unknown[], over: Record<string, unknown> = {}) => ({ mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates, ...over });

const machine = (over: Partial<MachineryEvent> = {}): MachineryEvent => ({ id: 'm1', type: 'tractor', ownership: 'owned', hoursUsed: 3, ...over });
const log = (id: string, date: string, machinery: MachineryEvent[]): DailyLog => ({
    id, date, context: { selection: [] }, dayOutcome: null, cropActivities: [], irrigation: [], labour: [], inputs: [], machinery,
} as unknown as DailyLog);

const LOGS = [
    log('l1', '2026-11-25', [machine()]),
    log('l2', '2026-11-24', [machine({ id: 'm2', rentalCost: 1500 })]),
];

beforeEach(async () => {
    h.language = 'mr';
    h.answer = answer([rate()]);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmMachines.clear(), db.farmWaterSources.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.appMeta.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set]);
});
afterEach(() => cleanup());

describe('the अंदाजे machine cost, apart from confirmed money', () => {
    it('his rate x his hours, labelled अंदाजे; a line that stated its cost is not here', async () => {
        render(<MachineEstimateCard farmId={FARM_A} logs={LOGS} />);
        const card = await screen.findByTestId('machine-estimate');
        expect(card).toHaveTextContent('यंत्राचा अंदाजे खर्च');
        const row = within(card).getByTestId('machine-estimate-l1:m1');
        expect(row).toHaveTextContent('महिंद्रा 575');
        expect(row).toHaveTextContent('3 तास × ₹ 900 तासाला');
        expect(row).toHaveTextContent('अंदाजे ₹ 2,700');
        expect(within(card).queryByTestId('machine-estimate-l2:m2')).not.toBeInTheDocument();
        expect(within(card).getByTestId('machine-estimate-total')).toHaveTextContent('अंदाजे एकूण ₹ 2,700');
        expect(within(card).getByTestId('machine-estimate-apart')).toHaveTextContent('हा अंदाज आहे, पक्का खर्च नाही. तो एकूण खर्चात धरलेला नाही.');
    });

    it('a rate the record cannot use says so, with no amount', async () => {
        h.answer = answer([rate({ basis: 'PerAcre', amount: 1500 })]);
        render(<MachineEstimateCard farmId={FARM_A} logs={LOGS} />);
        const row = await screen.findByTestId('machine-estimate-l1:m1');
        expect(row).toHaveTextContent('दर ₹ 1,500 एकरी — नोंदीत किती ते सांगितलेलं नाही, म्हणून अंदाज नाही.');
        expect(row).not.toHaveTextContent('अंदाजे ₹');
        expect(screen.queryByTestId('machine-estimate-total')).not.toBeInTheDocument();
    });

    it('no rate on the machine, or a seat that does not read work rates: no card at all', async () => {
        h.answer = answer([]);
        const { unmount } = render(<MachineEstimateCard farmId={FARM_A} logs={LOGS} />);
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_farm_rate_access_v1:${FARM_A}`)).toBeDefined());
        expect(screen.queryByTestId('machine-estimate')).not.toBeInTheDocument();
        unmount();
        await getDatabase().appMeta.clear();
        h.answer = answer([rate()], { seeWorkRates: false, mayWrite: false });
        render(<MachineEstimateCard farmId={FARM_A} logs={LOGS} />);
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_farm_rate_access_v1:${FARM_A}`)).toBeDefined());
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId('machine-estimate')).not.toBeInTheDocument();
    });

    it('English mode is English only (his machine name aside)', async () => {
        h.language = 'en';
        render(<MachineEstimateCard farmId={FARM_A} logs={LOGS} />);
        const card = await screen.findByTestId('machine-estimate');
        expect(card).toHaveTextContent('Estimated machine cost');
        expect(card).toHaveTextContent('3 hr × ₹ 900 per hour');
        expect(card).toHaveTextContent('about ₹ 2,700');
        expect((card.textContent ?? '').replace(/महिंद्रा 575/g, '')).not.toMatch(DEVANAGARI);
    });

    it('on the money home it sits apart, and the home\'s own money lines do not take it in', async () => {
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={vi.fn()} onBack={vi.fn()} farmId={FARM_A} logs={LOGS} />);
        const card = await screen.findByTestId('machine-estimate');
        expect(card).toHaveTextContent('अंदाजे ₹ 2,700');
        // no money entry exists on this phone: the home still says nothing is recorded (the estimate is not money)
        expect(screen.getByTestId('fin-home-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('fin-quick-spent')).not.toBeInTheDocument();
    });
});
