// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7). On the यंत्रं page of the farm's set:
 *   - right after a NEW machine is saved, a small optional step asks its rate: blank amount, no basis chosen, "जतन करा" waits for both;
 *   - the rate goes out as ONE line of the farm's दरपत्रक (`set_farm_rate`), its line id = the machine's id, kind Work, for the machine's name;
 *   - "नंतर" closes it and nothing but the machine is queued (P9);
 *   - each machine card says its rate (or that none is written, only when the server said so), and "दर बदला" makes a new version of the SAME line;
 *   - only a person the server lets set rates is asked; a seat that does not read work rates is told nothing about a rate;
 *   - changing a machine never asks; English mode is English only.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
const h = vi.hoisted(() => ({
    language: 'mr' as 'mr' | 'en',
    answer: null as null | Record<string, unknown>,
    suggestions: vi.fn(async () => []),
}));
vi.mock('../../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../farmRates/farmRatesApi', async (importActual) => {
    const real = await importActual<typeof import('../../farmRates/farmRatesApi')>();
    return {
        ...real,
        fetchFarmRates: vi.fn(async () => (h.answer ? real.farmRatesFrom(h.answer) : null)),
        fetchRateSuggestions: h.suggestions,
    };
});

import MachinesSection from '../../../profile/sections/MachinesSection';
import { VerificationStatus, type FarmerProfile } from '../../../../domain/types/farm.types';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { useFarmSetup } from '../../../profile/farmSetup/useFarmSetup';
import { FARM_A, FARM_B, MACHINE_A, emptyFarmDto, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';

configure({ asyncUtilTimeout: 5000 });

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const DEVANAGARI = /[ऀ-ॿ]/;
const profile = {
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [], waterResources: [], motors: [],
    machineries: [],
} as unknown as FarmerProfile;

const serverRate = (farmId: string, over: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-00000000c001', rateLineId: MACHINE_A, farmId, version: 1, kind: 'Work', itemName: 'महिंद्रा 575', unit: null,
    basis: 'PerHour', workerCategory: null, amount: 900, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null, retired: false,
    suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.000Z', ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({ mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates: [], ...over });

const Page: React.FC<{ farmId: string }> = ({ farmId }) => {
    const farmSetup = useFarmSetup(farmId);
    return <MachinesSection profile={profile} onUpdate={vi.fn()} farmSetup={farmSetup} canEdit />;
};

const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
const rateRows = async () => (await queue()).filter(r => r.mutationType === SyncMutationName.SetFarmRate);

const addMachine = async (name: string) => {
    fireEvent.click(await screen.findByTestId('machine-add'));
    fireEvent.change(screen.getByTestId('machine-name'), { target: { value: name } });
    await act(async () => { fireEvent.click(screen.getByTestId('machine-save')); });
    await waitFor(async () => expect((await queue()).some(r => r.mutationType === SyncMutationName.FarmsetupMachineSave)).toBe(true));
};

beforeEach(async () => {
    h.language = 'mr';
    h.answer = answer();
    h.suggestions.mockClear();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.appMeta.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
});
afterEach(() => cleanup());

describe('the rate step right after a new machine', () => {
    it('asks the rate: blank amount, no basis chosen, save waits for both', async () => {
        render(<Page farmId={FARM_B} />);
        await addMachine('जॉन डियर 5050');
        const step = await screen.findByTestId('machine-rate-step');
        expect(within(step).getByTestId('machine-rate-step-name')).toHaveTextContent('जॉन डियर 5050');
        expect(step).toHaveTextContent('या यंत्राचा दर');
        expect(screen.getByTestId('machine-rate-amount')).toHaveValue(null);
        for (const b of ['PerHour', 'PerDay', 'PerAcre', 'PerTrip', 'PerTask']) {
            expect(screen.getByTestId(`machine-rate-basis-${b}`)).toHaveAttribute('aria-pressed', 'false');
        }
        expect(screen.getByTestId('machine-rate-save')).toBeDisabled();
        fireEvent.change(screen.getByTestId('machine-rate-amount'), { target: { value: '800' } });
        expect(screen.getByTestId('machine-rate-save')).toBeDisabled();
        fireEvent.change(screen.getByTestId('machine-rate-amount'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('machine-rate-basis-PerHour'));
        expect(screen.getByTestId('machine-rate-save')).toBeDisabled();
        expect(screen.queryByTestId('machine-add')).not.toBeInTheDocument();
        expect(await rateRows()).toHaveLength(0);
    });

    it('the rate he typed goes to the rate card as the machine\'s own line, and the card says it is not saved yet', async () => {
        render(<Page farmId={FARM_B} />);
        await addMachine('जॉन डियर 5050');
        const machineId = (await queue())[0].payload as Record<string, unknown>;
        // more than two decimals is never kept (the server keeps two): what he sees is what is sent
        fireEvent.change(await screen.findByTestId('machine-rate-amount'), { target: { value: '800.555' } });
        fireEvent.click(screen.getByTestId('machine-rate-basis-PerHour'));
        await act(async () => { fireEvent.click(screen.getByTestId('machine-rate-save')); });
        await waitFor(async () => expect(await rateRows()).toHaveLength(1));
        const [row] = await rateRows();
        expect(row.payload).toEqual({
            farmRateId: (row.payload as Record<string, unknown>).farmRateId, rateLineId: machineId.machineId, farmId: FARM_B, change: 'set',
            changedAtUtc: (row.payload as Record<string, unknown>).changedAtUtc, kind: 'Work', itemName: 'जॉन डियर 5050', basis: 'PerHour', amount: 800.55,
            currencyCode: 'INR', effectiveFrom: getDateKey(),
        });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
        await waitFor(() => expect(screen.queryByTestId('machine-rate-step')).not.toBeInTheDocument());
        const card = await screen.findByTestId(`machine-${String(machineId.machineId)}`);
        await waitFor(() => expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('दर: ₹ 800.55 तासाला'));
        expect(within(card).getByTestId('machine-rate-status')).toHaveTextContent('फोनवर लिहिला — इंटरनेट आल्यावर जतन होईल.');
        expect(h.suggestions).not.toHaveBeenCalled();
    });

    it('"नंतर" closes it and queues nothing but the machine; the card then offers "दर लिहा"', async () => {
        render(<Page farmId={FARM_B} />);
        await addMachine('ब्लोअर');
        fireEvent.click(await screen.findByTestId('machine-rate-later'));
        expect(screen.queryByTestId('machine-rate-step')).not.toBeInTheDocument();
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.FarmsetupMachineSave]);
        const id = String(((await queue())[0].payload as Record<string, unknown>).machineId);
        const card = await screen.findByTestId(`machine-${id}`);
        expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('दर लिहिलेला नाही');
        expect(within(card).getByTestId('machine-rate-open')).toHaveTextContent('दर लिहा');
    });

    it('changing a machine never asks its rate', async () => {
        render(<Page farmId={FARM_A} />);
        fireEvent.click(await screen.findByTestId(`machine-edit-${MACHINE_A}`));
        await act(async () => { fireEvent.click(screen.getByTestId('machine-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        expect(screen.queryByTestId('machine-rate-step')).not.toBeInTheDocument();
    });

    it('a person the server does not let set rates is not asked, and gets no rate button', async () => {
        h.answer = answer({ mayWrite: false, rates: [serverRate(FARM_A)] });
        render(<Page farmId={FARM_A} />);
        const card = await screen.findByTestId(`machine-${MACHINE_A}`);
        await waitFor(() => expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('दर: ₹ 900 तासाला'));
        expect(within(card).queryByTestId('machine-rate-open')).not.toBeInTheDocument();
        h.answer = answer({ mayWrite: false });
        cleanup();
        render(<Page farmId={FARM_B} />);
        await addMachine('ट्रॅक्टर');
        expect(screen.queryByTestId('machine-rate-step')).not.toBeInTheDocument();
    });

    it('a seat that does not read work rates is told nothing about a rate (never "no rate")', async () => {
        h.answer = answer({ mayWrite: false, seeWorkRates: false });
        render(<Page farmId={FARM_A} />);
        await screen.findByTestId(`machine-${MACHINE_A}`);
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_farm_rate_access_v1:${FARM_A}`)).toBeDefined());
        expect(screen.queryByTestId('machine-rate-line')).not.toBeInTheDocument();
        expect(screen.queryByTestId('machine-rate-open')).not.toBeInTheDocument();
    });

    it('with no answer from the server and no rate held, "no rate" is never claimed', async () => {
        h.answer = null;
        render(<Page farmId={FARM_A} />);
        await screen.findByTestId(`machine-${MACHINE_A}`);
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByText('दर लिहिलेला नाही')).not.toBeInTheDocument();
    });
});

describe('a machine that already has a rate', () => {
    it('"दर बदला" opens with his rate and makes a new version of the SAME line', async () => {
        h.answer = answer({ rates: [serverRate(FARM_A)] });
        render(<Page farmId={FARM_A} />);
        const card = await screen.findByTestId(`machine-${MACHINE_A}`);
        await waitFor(() => expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('दर: ₹ 900 तासाला'));
        await waitFor(() => expect(within(card).getByTestId('machine-rate-open')).toHaveTextContent('दर बदला'));
        fireEvent.click(within(card).getByTestId('machine-rate-open'));
        expect(screen.getByTestId('machine-rate-step-name')).toHaveTextContent('महिंद्रा 575');
        expect(screen.getByTestId('machine-rate-amount')).toHaveValue(900);
        expect(screen.getByTestId('machine-rate-basis-PerHour')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.change(screen.getByTestId('machine-rate-amount'), { target: { value: '1000' } });
        await act(async () => { fireEvent.click(screen.getByTestId('machine-rate-save')); });
        await waitFor(async () => expect(await rateRows()).toHaveLength(1));
        expect((await rateRows())[0].payload).toMatchObject({ rateLineId: MACHINE_A, farmId: FARM_A, kind: 'Work', amount: 1000, basis: 'PerHour' });
    });

    it('a stopped rate says so', async () => {
        h.answer = answer({ rates: [serverRate(FARM_A), serverRate(FARM_A, { id: '00000000-0000-4000-8000-00000000c002', version: 2, retired: true })] });
        render(<Page farmId={FARM_A} />);
        const card = await screen.findByTestId(`machine-${MACHINE_A}`);
        await waitFor(() => expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('दर बंद केला आहे'));
    });

    it('English mode is English only (his machine name aside)', async () => {
        h.language = 'en';
        h.answer = answer({ rates: [serverRate(FARM_A)] });
        render(<Page farmId={FARM_A} />);
        const card = await screen.findByTestId(`machine-${MACHINE_A}`);
        await waitFor(() => expect(within(card).getByTestId('machine-rate-line')).toHaveTextContent('Rate: ₹ 900 per hour'));
        await waitFor(() => expect(within(card).getByTestId('machine-rate-open')).toHaveTextContent('Change rate'));
        fireEvent.click(within(card).getByTestId('machine-rate-open'));
        const step = screen.getByTestId('machine-rate-step');
        expect(step).toHaveTextContent("This machine's rate");
        expect((step.textContent ?? '').replace('महिंद्रा 575', '')).not.toMatch(DEVANAGARI);
    });
});
