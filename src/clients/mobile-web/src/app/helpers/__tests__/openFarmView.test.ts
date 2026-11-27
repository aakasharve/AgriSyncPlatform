/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 (founder 27 Nov, "yes it matters") - the open-farm read layer, in the shape of the FIX-1 browser drive: one person who is
 * मुकादम on farm A (a crop, टोमॅटो, with 6 plots) and owner of farm B (1 plot, which he added on the phone under that same crop). The
 * phone keeps ONE crop list for him; every screen reads it through this layer, which keeps only the open farm's plots, crops, entries
 * and people. A plot's farm comes from the downloaded plots table, else its waiting `create_plot`, else the phone's own mark; a plot
 * of no known farm is never shown on a farm it may not belong to.
 */
import { describe, expect, it } from 'vitest';
import type { CropProfile, DailyLog, FarmOperator, Plot } from '../../../types';
import type { PlotFarmIndex } from '../../../features/sync/plots/plotFarmIndex';
import { cropsOnFarm, farmOfLog, farmOfPlot, logsOnFarm, openFarmOf, peopleOnFarm } from '../openFarmView';

const A = 'farm-a';
const B = 'farm-b';

const plot = (id: string, over: Partial<Plot> = {}): Plot => ({
    id, name: id.toUpperCase(), baseline: { totalArea: 1, unit: 'Acre' },
    schedule: { id: `sch_${id}`, plotId: id, templateId: 't', referenceType: 'PLANTING', referenceDate: '2026-10-01', stageOverrides: [], expectationOverrides: [] },
    ...over,
} as Plot);
const crop = (id: string, plots: Plot[], over: Partial<CropProfile> = {}): CropProfile => ({
    id, name: id, iconName: 'Sprout', color: 'bg-emerald-500', plots, supportedTasks: [], workflow: [], ...over,
});

const A_PLOTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
/** The drive: टोमॅटो holds A's 6 plots and the plot he added on B. */
const TOMATO = crop('crop_tomato', [...A_PLOTS.map(id => plot(id)), plot('b1')]);

const index = (entries: Record<string, string>, farms: string[] = [A, B], owners: Record<string, string> = {}): PlotFarmIndex => ({
    plotFarm: new Map(Object.entries(entries)),
    farmIds: new Set(farms),
    farmOwner: new Map(Object.entries(owners)),
});
const DRIVE = index({ ...Object.fromEntries(A_PLOTS.map(id => [id, A])), b1: B }, [A, B], { [A]: 'u-owner-a', [B]: 'u-me' });

const plotIds = (crops: CropProfile[]) => crops.map(c => `${c.id}:${c.plots.map(p => p.id).join(',')}`);

describe('crops and plots: only the open farm', () => {
    it('farm A shows टोमॅटो with its 6 plots; farm B shows टोमॅटो with its 1 plot - and the switch flips them', () => {
        expect(plotIds(cropsOnFarm([TOMATO], openFarmOf(A, DRIVE), DRIVE))).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
        expect(plotIds(cropsOnFarm([TOMATO], openFarmOf(B, DRIVE), DRIVE))).toEqual(['crop_tomato:b1']);
        expect(plotIds(cropsOnFarm([TOMATO], openFarmOf(A, DRIVE), DRIVE))).toEqual(['crop_tomato:a1,a2,a3,a4,a5,a6']);
    });

    it('the stored crop is never changed by a view (the other farm\'s plots stay in it)', () => {
        cropsOnFarm([TOMATO], openFarmOf(B, DRIVE), DRIVE);
        expect(TOMATO.plots.map(p => p.id)).toEqual([...A_PLOTS, 'b1']);
    });

    it('a crop with no plot on the open farm is not on it at all (the hub\'s पिकं count)', () => {
        const onion = crop('crop_onion', [plot('a7')]);
        const idx = index({ ...Object.fromEntries(A_PLOTS.map(id => [id, A])), a7: A, b1: B });
        expect(cropsOnFarm([TOMATO, onion], openFarmOf(B, idx), idx).map(c => c.id)).toEqual(['crop_tomato']);
        expect(cropsOnFarm([TOMATO, onion], openFarmOf(A, idx), idx).map(c => c.id)).toEqual(['crop_tomato', 'crop_onion']);
    });

    it('a plot\'s farm: the downloaded table first, then the waiting create_plot or the phone record, then the plot\'s own mark', () => {
        const idx = index({ p1: A });
        expect(farmOfPlot({ id: 'p1', farmId: B }, idx)).toBe(A);
        expect(farmOfPlot({ id: 'p2', farmId: B }, idx)).toBe(B);
        expect(farmOfPlot({ id: 'p3' }, idx)).toBeNull();
    });

    it('a plot of no known farm is shown to a one-farm person, and on neither farm of a two-farm phone', () => {
        const lost = crop('crop_grape', [plot('old-p')]);
        const one = index({}, [A]);
        expect(plotIds(cropsOnFarm([lost], openFarmOf(A, one), one))).toEqual(['crop_grape:old-p']);
        expect(cropsOnFarm([lost], openFarmOf(A, DRIVE), DRIVE)).toEqual([]);
        expect(cropsOnFarm([lost], openFarmOf(B, DRIVE), DRIVE)).toEqual([]);
    });

    it('a crop made on this phone (no plots yet) shows on the farm it was made on only; an old one with no farm only on a one-farm phone', () => {
        const madeOnB = crop('c_new', [], { farmId: B });
        const old = crop('c_old', []);
        expect(cropsOnFarm([madeOnB, old], openFarmOf(B, DRIVE), DRIVE).map(c => c.id)).toEqual(['c_new']);
        expect(cropsOnFarm([madeOnB, old], openFarmOf(A, DRIVE), DRIVE).map(c => c.id)).toEqual([]);
        const one = index({}, [B]);
        expect(cropsOnFarm([madeOnB, old], openFarmOf(B, one), one).map(c => c.id)).toEqual(['c_new', 'c_old']);
    });

    it('the seats the server lists count as farms too: a second seat with nothing downloaded yet already makes a two-farm phone', () => {
        const lost = crop('crop_grape', [plot('old-p')]);
        const onlyA = index({}, [A]);
        expect(openFarmOf(A, onlyA, [A]).oneFarm).toBe(true);
        expect(openFarmOf(A, onlyA, [A, B]).oneFarm).toBe(false);
        expect(cropsOnFarm([lost], openFarmOf(A, onlyA, [A, B]), onlyA)).toEqual([]);
    });

    it('a one-farm person gets the very same list back (nothing filtered, nothing copied)', () => {
        const one = index(Object.fromEntries(A_PLOTS.map(id => [id, A])), [A]);
        const crops = [crop('crop_tomato', A_PLOTS.map(id => plot(id)))];
        expect(cropsOnFarm(crops, openFarmOf(A, one), one)).toBe(crops);
    });

    it('no open farm known yet: the list as it is (today)', () => {
        const crops = [TOMATO];
        expect(cropsOnFarm(crops, openFarmOf(null, DRIVE), DRIVE)).toBe(crops);
    });
});

const log = (id: string, over: Partial<DailyLog> = {}): DailyLog => ({
    id, date: '2026-11-27', context: { selection: [] }, dayOutcome: null,
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], ...over,
} as DailyLog);
const onPlot = (plotId: string) => ({ selection: [{ cropId: 'crop_tomato', cropName: 'टोमॅटो', selectedPlotIds: [plotId], selectedPlotNames: [plotId] }] });

describe('entries: only the open farm', () => {
    const logs = [
        log('la', { meta: { createdAtISO: 'x', farmId: A, createdByOperatorId: 'u-worker-a' }, context: onPlot('a1') }),
        log('lb', { meta: { createdAtISO: 'x', farmId: B, createdByOperatorId: 'u-worker-b' }, context: onPlot('b1') }),
        // An older record of this phone with no farm written on it: its plot says A.
        log('la-old', { meta: { createdAtISO: 'x' }, context: onPlot('a2') }),
        // A farm-wide record with no farm and no plot: nobody can say whose it is.
        log('l-none', { meta: { createdAtISO: 'x' } }),
    ];

    it('each record\'s farm: the record\'s own, else its plot\'s', () => {
        expect(farmOfLog(logs[0], DRIVE)).toBe(A);
        expect(farmOfLog(logs[2], DRIVE)).toBe(A);
        expect(farmOfLog(logs[3], DRIVE)).toBeNull();
    });

    it('farm A shows A\'s records, farm B shows B\'s; a record of no known farm shows on neither of two farms', () => {
        expect(logsOnFarm(logs, openFarmOf(A, DRIVE), DRIVE).map(l => l.id)).toEqual(['la', 'la-old']);
        expect(logsOnFarm(logs, openFarmOf(B, DRIVE), DRIVE).map(l => l.id)).toEqual(['lb']);
    });

    it('a one-farm person sees every record as today (same list)', () => {
        const one = index({ a1: A, a2: A }, [A]);
        const own = [logs[0], logs[2], logs[3]];
        expect(logsOnFarm(own, openFarmOf(A, one), one)).toBe(own);
    });
});

describe('people: only the open farm', () => {
    const op = (id: string, name: string): FarmOperator => ({ id, name, role: 'WORKER', capabilities: [], isVerifier: false });
    const operators = [op('u-me', 'मी'), op('u-owner-a', 'अ मालक'), op('u-worker-a', 'अ कामगार'), op('u-worker-b', 'ब कामगार')];
    const logs = [
        log('la', { meta: { createdAtISO: 'x', farmId: A, createdByOperatorId: 'u-worker-a' } }),
        log('lb', { meta: { createdAtISO: 'x', farmId: B, createdByOperatorId: 'u-worker-b' } }),
    ];
    const me = new Set(['u-me']);

    it('farm A: himself, A\'s owner and the people behind A\'s records; farm B: himself and B\'s - and the switch flips them', () => {
        expect(peopleOnFarm(operators, openFarmOf(A, DRIVE), logs, DRIVE, me).map(o => o.id)).toEqual(['u-me', 'u-owner-a', 'u-worker-a']);
        expect(peopleOnFarm(operators, openFarmOf(B, DRIVE), logs, DRIVE, me).map(o => o.id)).toEqual(['u-me', 'u-worker-b']);
    });

    it('a one-farm person: the people list exactly as today', () => {
        const one = index({}, [A]);
        expect(peopleOnFarm(operators, openFarmOf(A, one), logs, one, me)).toBe(operators);
    });
});
