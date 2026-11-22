// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * F03 (phone half, read-only security audit): a मुकादम who covers CHOSEN PLOTS only was still offered the "संपूर्ण शेत"
 * (whole farm) card in the entry flow. The card is drawn by `CropPlotStepper` by default, and the stepper is the one component
 * every entry caller (log entry, place picker, plan form, task done, compare) goes through. So the stepper hides the card for a
 * seat whose scope for the open farm is ChosenPlots. The owner (AllPlots) and an own-work seat are unchanged.
 *
 * The scope is what the SERVER last said (the stored scopes, kept by the pull); `/me/context` is only the stand-in before
 * this phone's first pull. The server half (refusing a whole-farm record from such a seat) waits for a server lane.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../../types';

const h = vi.hoisted(() => ({ stored: null as unknown, ctx: null as unknown }));

vi.mock('../../../../core/session/storedFarmScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../core/session/storedFarmScope')>()),
    useStoredAccessScopes: () => h.stored,
}));
vi.mock('../../../../core/session/FarmContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => h.ctx,
}));

import CropSelector from '../CropSelector';

const crop = (id: string, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', ['ऊस १', 'ऊस २']), crop('grape', 'द्राक्ष', 'Grape', ['सोनाका'])];

const FARM = 'farm-1';
const scopes = (...rows: Array<{ farmId: string; plotScope: string }>) => ({ receivedAtUtc: '2026-11-22T00:00:00Z', scopes: rows });
const ctx = (plotScope?: string | null, farmId: string | null = FARM) => ({ currentFarmId: farmId, currentFarm: farmId ? { farmId, plotScope } : null });

const Stepper: React.FC<{ look?: 'shared' | 'classic'; hideEntireFarm?: boolean }> = ({ look, hideEntireFarm }) => (
    <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={[]} selectedPlots={{}} onSelectionChange={() => undefined}
        stepper={{ look, hideEntireFarm }} />
);

beforeEach(() => { h.stored = null; h.ctx = null; });
afterEach(cleanup);

describe('the whole-farm card in the entry flow, by what the seat may do', () => {
    it.each([['shared', 'shared' as const], ['classic', 'classic' as const]])(
        'is NOT offered to a seat that covers chosen plots (%s look), and the crops are still there',
        (_n, look) => {
            h.stored = scopes({ farmId: FARM, plotScope: 'ChosenPlots' });
            h.ctx = ctx('ChosenPlots');
            render(<Stepper look={look} />);
            expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
            expect(screen.getByTestId('flow-crop-cane')).toBeTruthy();
            expect(screen.getByTestId('flow-crop-grape')).toBeTruthy();
        },
    );

    it.each([['shared', 'shared' as const], ['classic', 'classic' as const]])(
        'IS offered to the owner (AllPlots), %s look',
        (_n, look) => {
            h.stored = scopes({ farmId: FARM, plotScope: 'AllPlots' });
            h.ctx = ctx('AllPlots');
            render(<Stepper look={look} />);
            expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
        },
    );

    it('is unchanged for an own-work seat', () => {
        h.stored = scopes({ farmId: FARM, plotScope: 'OwnWork' });
        h.ctx = ctx('OwnWork');
        render(<Stepper />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('is unchanged where there is no farm context at all (a test, a preview, before sign-in)', () => {
        render(<Stepper />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('reads the scope of the OPEN farm: chosen plots on another farm change nothing here', () => {
        h.stored = scopes({ farmId: 'farm-2', plotScope: 'ChosenPlots' }, { farmId: FARM, plotScope: 'AllPlots' });
        h.ctx = ctx('AllPlots', FARM);
        render(<Stepper />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('and hides it on the open farm when THAT farm is the plot-limited one', () => {
        h.stored = scopes({ farmId: 'farm-2', plotScope: 'AllPlots' }, { farmId: FARM, plotScope: 'ChosenPlots' });
        h.ctx = ctx('ChosenPlots', FARM);
        render(<Stepper />);
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
    });

    it('before this phone has pulled any scope, /me/context stands in: chosen plots there hides the card', () => {
        h.stored = null;
        h.ctx = ctx('ChosenPlots');
        render(<Stepper />);
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
    });

    it('the stored answer wins over a stale /me/context (the pull is newer): stored AllPlots shows the card', () => {
        h.stored = scopes({ farmId: FARM, plotScope: 'AllPlots' });
        h.ctx = ctx('ChosenPlots');
        render(<Stepper />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('with neither a stored scope nor a /me/context scope (an older server) the card stays, as before', () => {
        h.stored = null;
        h.ctx = ctx(undefined);
        render(<Stepper />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('hiding the card does not flip the look: a plot-limited seat keeps the shared photo tiles, not compare\'s classic cards', () => {
        h.stored = scopes({ farmId: FARM, plotScope: 'ChosenPlots' });
        h.ctx = ctx('ChosenPlots');
        render(<Stepper />);
        // the shared look draws a photo tile (an <img> inside the tile); the classic look draws CropPhotoCard with a caption of plot names
        expect(screen.getByTestId('flow-crop-cane').textContent).toContain('२ प्लॉट');
    });

    it('compare\'s own hideEntireFarm still works for an owner', () => {
        h.stored = scopes({ farmId: FARM, plotScope: 'AllPlots' });
        h.ctx = ctx('AllPlots');
        render(<Stepper hideEntireFarm />);
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
    });
});
