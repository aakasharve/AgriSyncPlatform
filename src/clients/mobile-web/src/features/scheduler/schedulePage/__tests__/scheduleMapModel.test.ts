/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, picture S3) - the picture map as plain data: which plot follows which
 * schedule, which colour each schedule wears, how the rows are sorted and where the lines start and end. Pure: no React, no database.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { buildScheduleMap, layoutScheduleMap, MAP_GAP, MAP_PLOT_H, plotDayNumber } from '../scheduleMapModel';
import { resolvePlotSchedule } from '../resolveSchedule';
import { OUTSIDE_SCHEDULE_COLOURS, OWN_SCHEDULE_COLOUR, scheduleColour } from '../scheduleColours';
import type { PlotScheduleChoices } from '../usePlotScheduleChoices';
import type { ScheduleChoice } from '../scheduleSubscriptions';
import { P, T, TEMPLATES, farm } from './pictureMapFixtures';
import { REF, crop, plot } from './scheduleFixtures';

const TODAY = '2026-10-26'; // schedule day 9 from REF

const sub = (templateId: string, extra: Partial<ScheduleChoice> = {}): ScheduleChoice => ({ templateId, referenceDate: null, pending: false, origin: 'Outside', isMain: true, ...extra });
/** A plot's choice as `usePlotScheduleChoices` builds it: the main row, with every row attached in `followed`. */
const choiceOf = (...rows: ScheduleChoice[]): ScheduleChoice => ({ ...(rows.find(r => r.isMain) ?? rows[0]), followed: rows });
const choices = (entries: Array<[string, ScheduleChoice]>): PlotScheduleChoices => new Map(entries);
const cropName = (c: { name: string }) => c.name;

beforeAll(() => setScheduleTemplatesFromReferenceData(TEMPLATES));
afterEach(() => undefined);

describe('who follows what', () => {
    const model = () => buildScheduleMap({
        crops: farm(),
        todayKey: TODAY,
        cropName,
        choices: choices([
            [P.g1, choiceOf(sub(T.university, { subscriptionId: 's1', slot: 1 }))],
            [P.g2, choiceOf(sub(T.university, { subscriptionId: 's2', slot: 1 }))],
            [P.u1, choiceOf(sub(T.ownCane, { subscriptionId: 's4', origin: 'Own', slot: 0 }))],
        ]),
    });

    it('two plots into one schedule and a third into another; the plot that follows nothing is in the dashed group, not on the map', () => {
        const m = model();
        expect(m.schedules.map(s => [s.key, s.plotIds])).toEqual([[T.university, [P.g1, P.g2]], [T.ownCane, [P.u1]]]);
        expect(m.plots.map(p => p.plotId)).toEqual([P.g1, P.g2, P.u1]);
        expect(m.unscheduled.map(p => p.plotId)).toEqual([P.g3]);
        expect(m.edges.map(e => [e.plotId, e.key, e.main])).toEqual([[P.g1, T.university, true], [P.g2, T.university, true], [P.u1, T.ownCane, true]]);
    });

    it('one schedule = one colour: blue for the first outside schedule, GREEN for his own; every line of a schedule wears the schedule\'s colour', () => {
        const m = model();
        const colourOf = (key: string) => m.schedules.find(s => s.key === key)?.colour;
        expect(colourOf(T.university)).toBe('#1448E6');
        expect(colourOf(T.ownCane)).toBe(OWN_SCHEDULE_COLOUR);
        expect(OWN_SCHEDULE_COLOUR).toBe('#16A34A');
        expect(m.schedules.find(s => s.key === T.ownCane)?.own).toBe(true);
        expect(m.schedules.find(s => s.key === T.university)?.own).toBe(false);
    });

    it('the colours go blue, violet, teal for outside schedules (the founder\'s picture), and carry on past three without repeating the first three', () => {
        expect(OUTSIDE_SCHEDULE_COLOURS.slice(0, 3)).toEqual(['#1448E6', '#7C3AED', '#0E7490']);
        expect([0, 1, 2, 3, 4].map(i => scheduleColour(false, i))).toEqual([...OUTSIDE_SCHEDULE_COLOURS]);
        expect(scheduleColour(false, 5)).toBe('#1448E6'); // only after five
        expect(scheduleColour(true, 7)).toBe('#16A34A');
    });

    it('plots on one schedule sit together even when the farm lists them apart', () => {
        const grape = (id: string, name: string) => plot({ id, name, schedule: { ...plot().schedule, id: `s-${id}`, plotId: id } });
        const crops = [crop([grape('a', 'A'), grape('b', 'B'), grape('c', 'C')], { activeScheduleId: null })];
        const m = buildScheduleMap({
            crops, todayKey: TODAY, cropName,
            choices: choices([['a', choiceOf(sub(T.university))], ['b', choiceOf(sub(T.expert))], ['c', choiceOf(sub(T.university))]]),
        });
        expect(m.plots.map(p => p.plotId)).toEqual(['a', 'c', 'b']); // A and C (university) together, B (expert) after
        expect(m.schedules.map(s => s.key)).toEqual([T.university, T.expert]);
    });

    it('the day on a plot\'s card is the schedule\'s day (days since its day 0, less the recorded shifts) - the same number the page shows', () => {
        const m = model();
        expect(m.plots.find(p => p.plotId === P.g1)?.day).toBe(9);
        const resolved = resolvePlotSchedule(farm()[0], farm()[0].plots[0], TODAY, choiceOf(sub(T.university)));
        expect(resolved).not.toBeNull();
        expect(plotDayNumber(resolved!, [{ id: 's', plotId: P.g1, date: '2026-10-20', shiftDays: 2, reason: 'WEATHER' }] as never, TODAY)).toBe(7);
        expect(REF).toBe('2026-10-17');
    });

    it('nobody chose (the app\'s default for the crop) is NOT following: the plot goes to the dashed group, and a crop with no plot is only named', () => {
        const m = buildScheduleMap({ crops: [...farm(), crop([], { id: 'crop-3', name: 'Onion' })], todayKey: TODAY, cropName, choices: choices([]) });
        expect(m.plots).toEqual([]);
        expect(m.unscheduled.map(p => p.plotId)).toEqual([P.g1, P.g2, P.g3, P.u1]);
        expect(m.emptyCrops).toEqual([{ id: 'crop-3', name: 'Onion' }]);
    });
});

describe('a plot that follows several schedules (3 + 1)', () => {
    const grape = (id: string, name: string) => plot({ id, name, schedule: { ...plot().schedule, id: `s-${id}`, plotId: id } });
    const crops = () => [crop([grape('a', 'A'), grape('b', 'B')], { activeScheduleId: null })];

    it('draws one line to each; the SERVER\'S main one is the main line and decides where the plot sits', () => {
        const m = buildScheduleMap({
            crops: crops(), todayKey: TODAY, cropName,
            choices: choices([
                ['a', choiceOf(sub(T.university, { isMain: false, slot: 1 }), sub(T.expert, { isMain: true, slot: 2 }))],
                ['b', choiceOf(sub(T.university))],
            ]),
        });
        expect(m.plots.find(p => p.plotId === 'a')).toMatchObject({ mainKey: T.expert, keys: [T.expert, T.university] });
        expect(m.edges.filter(e => e.plotId === 'a').map(e => [e.key, e.main])).toEqual([[T.expert, true], [T.university, false]]);
        // the expert schedule holds A as its main plot; the university schedule holds B as its main plot and also has A's extra line
        expect(m.schedules.find(s => s.key === T.expert)).toMatchObject({ mainPlotIds: ['a'], plotIds: ['a'] });
        expect(m.schedules.find(s => s.key === T.university)).toMatchObject({ mainPlotIds: ['b'], plotIds: ['a', 'b'] });
    });
});

describe('where things sit (px)', () => {
    const farmModel = () => buildScheduleMap({
        crops: farm(), todayKey: TODAY, cropName,
        choices: choices([
            [P.g1, choiceOf(sub(T.university))],
            [P.g2, choiceOf(sub(T.university))],
            [P.u1, choiceOf(sub(T.ownCane, { origin: 'Own', slot: 0 }))],
        ]),
    });

    it('a schedule\'s card spans exactly the rows of its plots; the next card starts under it', () => {
        const layout = layoutScheduleMap(farmModel());
        const pitch = MAP_PLOT_H + MAP_GAP;
        expect(layout.plotTop).toEqual({ [P.g1]: 0, [P.g2]: pitch, [P.u1]: 2 * pitch });
        expect(layout.schedule[T.university]).toEqual({ top: 0, height: pitch + MAP_PLOT_H });
        expect(layout.schedule[T.ownCane]).toEqual({ top: 2 * pitch, height: MAP_PLOT_H });
        expect(layout.height).toBe(3 * pitch - MAP_GAP);
    });

    it('every line starts inside its plot\'s row and ends inside its schedule\'s card; two lines into one card end at different heights', () => {
        const m = farmModel();
        const layout = layoutScheduleMap(m);
        expect(layout.lines).toHaveLength(3);
        for (const l of layout.lines) {
            const top = layout.plotTop[l.plotId];
            expect(l.y1).toBeGreaterThan(top);
            expect(l.y1).toBeLessThan(top + MAP_PLOT_H);
            const card = layout.schedule[l.key];
            expect(l.y2).toBeGreaterThan(card.top);
            expect(l.y2).toBeLessThan(card.top + card.height);
        }
        const into = layout.lines.filter(l => l.key === T.university).map(l => l.y2);
        expect(new Set(into).size).toBe(2);
    });

    it('cards never overlap, even when a schedule is followed only as an extra place', () => {
        const grape = (id: string, name: string) => plot({ id, name, schedule: { ...plot().schedule, id: `s-${id}`, plotId: id } });
        const m = buildScheduleMap({
            crops: [crop([grape('a', 'A'), grape('b', 'B')], { activeScheduleId: null })], todayKey: TODAY, cropName,
            choices: choices([
                ['a', choiceOf(sub(T.university, { slot: 1 }), sub(T.expert, { isMain: false, slot: 2 }))],
                ['b', choiceOf(sub(T.university, { slot: 1 }), sub(T.expert, { isMain: false, slot: 2 }))],
            ]),
        });
        const layout = layoutScheduleMap(m);
        const cards = m.schedules.map(s => layout.schedule[s.key]).sort((x, y) => x.top - y.top);
        for (let i = 1; i < cards.length; i++) expect(cards[i].top).toBeGreaterThanOrEqual(cards[i - 1].top + cards[i - 1].height + MAP_GAP);
    });

    it('an empty map has no height', () => {
        expect(layoutScheduleMap({ plots: [], unscheduled: [], schedules: [], edges: [], emptyCrops: [] }).height).toBe(0);
    });
});
