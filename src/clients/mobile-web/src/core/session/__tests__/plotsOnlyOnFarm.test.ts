/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * F03 — does this seat cover CHOSEN PLOTS ONLY on this farm? The stored answer (the server's last pull) is the authority and
 * `/me/context` is only the stand-in before this phone's first pull, the same order `seeMoneyDoor` already uses.
 */
import { describe, expect, it } from 'vitest';
import { plotsOnlyOnFarm } from '../storedFarmScope';

const stored = (...rows: Array<{ farmId: string; plotScope: string }>) =>
    ({ receivedAtUtc: '2026-11-22T00:00:00Z', scopes: rows }) as never;

describe('plotsOnlyOnFarm', () => {
    it('is true when the stored scope for the farm is ChosenPlots', () => {
        expect(plotsOnlyOnFarm(stored({ farmId: 'f1', plotScope: 'ChosenPlots' }), 'f1', null)).toBe(true);
    });

    it('is false for AllPlots and OwnWork', () => {
        expect(plotsOnlyOnFarm(stored({ farmId: 'f1', plotScope: 'AllPlots' }), 'f1', null)).toBe(false);
        expect(plotsOnlyOnFarm(stored({ farmId: 'f1', plotScope: 'OwnWork' }), 'f1', null)).toBe(false);
    });

    it('reads only the named farm', () => {
        const s = stored({ farmId: 'f2', plotScope: 'ChosenPlots' }, { farmId: 'f1', plotScope: 'AllPlots' });
        expect(plotsOnlyOnFarm(s, 'f1', null)).toBe(false);
        expect(plotsOnlyOnFarm(s, 'f2', null)).toBe(true);
    });

    it('falls back to /me/context when the stored answer has nothing for this farm', () => {
        expect(plotsOnlyOnFarm(null, 'f1', { plotScope: 'ChosenPlots' })).toBe(true);
        expect(plotsOnlyOnFarm(stored({ farmId: 'other', plotScope: 'AllPlots' }), 'f1', { plotScope: 'ChosenPlots' })).toBe(true);
        expect(plotsOnlyOnFarm(null, 'f1', { plotScope: 'AllPlots' })).toBe(false);
        expect(plotsOnlyOnFarm(null, 'f1', { plotScope: 'OwnWork' })).toBe(false);
    });

    it('the stored answer wins over /me/context when both exist', () => {
        expect(plotsOnlyOnFarm(stored({ farmId: 'f1', plotScope: 'AllPlots' }), 'f1', { plotScope: 'ChosenPlots' })).toBe(false);
        expect(plotsOnlyOnFarm(stored({ farmId: 'f1', plotScope: 'ChosenPlots' }), 'f1', { plotScope: 'AllPlots' })).toBe(true);
    });

    it('is false when nothing is known (an older server, no farm, no context)', () => {
        expect(plotsOnlyOnFarm(null, null, null)).toBe(false);
        expect(plotsOnlyOnFarm(null, undefined, undefined)).toBe(false);
        expect(plotsOnlyOnFarm(null, 'f1', { plotScope: null })).toBe(false);
        expect(plotsOnlyOnFarm(null, 'f1', {})).toBe(false);
    });
});
