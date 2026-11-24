// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - the day cards: one snapshot per kind of work (five), the dose rule (DoseNeverWithoutUnitAndSource), an
 * unchecked reference that is readable and marked (UncheckedReference_ReadableAndMarked), shown days through the one helper, and no empty card.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { DayCardDeck, positionText } from '../DayCardDeck';
import { cardsOfTask, deckForShownDay, deckForTask, doseHasUnit, doseLines, firstShownDay, lastShownDay, tasksOnShownDay } from '../dayCardsModel';
import { parseDayCardsDetail, shownDayOfStored, type DayCardsDetail } from '../dayCardsTypes';
import { dayCardWords } from '../dayCardWords';

const base = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({
        taskKey: 't', name: 'काम', kind: 'work', basis: 'stated', stageIndex: 0, order: 0,
        timing: { timer: 'day', fromDay: 9, toDay: 9, repeat: 'once' }, ...over,
    });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

const SRC = [{ document: 'चाचणी पुस्तिका', page: '३' }];

const KINDS: Record<string, ScheduleTaskContent> = {
    irrigation: base({ taskKey: 'i', name: 'पाणी द्या', kind: 'irrigation', why: 'नव्या फुटव्यांना पाणी लागतं', sources: SRC, dose: '२०,४०० लिटर प्रति दिवस' }),
    nutrition: base({ taskKey: 'n', name: 'नत्र (खत) द्या', kind: 'nutrition', steps: ['एकरी ३२ किलो नत्र', 'हप्त्यांत द्या'], sources: SRC, products: [{ name: 'युरिया', doseAsWritten: '७०', unit: 'किलो', perWhat: 'एकर' }] }),
    spray: base({ taskKey: 's', name: 'बुरशीनाशक फवारणी', kind: 'spray', sources: SRC, steps: ['नीट मिसळा'], reEntryHours: 24, preHarvestDays: 30, warnings: ['हातमोजे घाला'], products: [{ name: 'चाचणी औषध', doseAsWritten: '२', unit: 'ग्रॅम', perWhat: 'लिटर' }] }),
    work: base({ taskKey: 'w', name: 'फळछाटणी', kind: 'work', steps: ['काड्या ५-६ डोळ्यांवर छाटा'], sources: SRC }),
    observe: base({ taskKey: 'o', name: 'मणी पाहणी', kind: 'observe', sources: SRC, look: { where: 'वेलीवर', sign: 'मण्यांचा आकार', ifThen: [{ if: 'मणी लहान', then: 'पाणी वाढवा' }] }, ask: { question: 'मणी पाहिले का?', answers: [{ answer: 'yes', changes: 'ठीक' }, { answer: 'no', changes: 'आज पाहा' }] } }),
};

const detailOf = (tasks: ScheduleTaskContent[], over: Partial<DayCardsDetail> = {}): DayCardsDetail => ({
    templateId: '11111111-1111-4111-8111-111111111111', chainId: null, version: 1, contentHash: 'h', kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'चाचणी संस्था' },
    check: { state: 'Checked', isChecked: true, checkedBy: 'तपासनीस', checkedAtUtc: null },
    stages: [{ index: 0, name: 'छाटणी', from: shownDayOfStored(0)!, to: shownDayOfStored(40)!, startSign: null, endSign: null }],
    tasks: tasks.map(task => ({ task, contentHash: 'x', shown: { from: shownDayOfStored(task.timing.fromDay), to: shownDayOfStored(task.timing.toDay), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: over.check?.isChecked ?? true })),
    challenges: [], skipped: 0, ...over,
});

const render = (detail: DayCardsDetail, key: string, language: 'mr' | 'en' = 'mr'): string => {
    const parts = deckForTask(detail, key);
    if (!parts) throw new Error('no deck');
    return renderToStaticMarkup(<DayCardDeck parts={parts} detail={detail} words={dayCardWords(language)} />);
};

describe('one snapshot per kind of work', () => {
    for (const [kind, task] of Object.entries(KINDS)) {
        it(`${kind}: the cards of the work are drawn as approved`, () => {
            expect(render(detailOf([task]), task.taskKey)).toMatchSnapshot();
        });
    }
});

describe('DoseNeverWithoutUnitAndSource', () => {
    it('shows a dose that has its unit and its source', () => {
        expect(doseLines(KINDS.spray)).toEqual([{ name: 'चाचणी औषध', text: '२ ग्रॅम', perWhat: 'लिटर', water: null, withheld: false }]);
    });

    it('withholds a dose with no source, and says so, never printing the bare number', () => {
        const noSource = base({ taskKey: 'p', kind: 'spray', products: [{ name: 'औषध', doseAsWritten: '२', unit: 'ग्रॅम' }], sources: [] });
        const lines = doseLines(noSource);
        expect(lines[0].text).toBeNull();
        expect(lines[0].withheld).toBe(true);
        const html = render(detailOf([noSource]), 'p');
        expect(html).toContain('dose-withheld');
        expect(html).not.toContain('dose-text');
        expect(html).not.toMatch(/>२ ग्रॅम|>२</);
    });

    it('withholds a dose with no unit, even with a source', () => {
        const noUnit = base({ taskKey: 'u', kind: 'spray', products: [{ name: 'औषध', doseAsWritten: '२' }], sources: SRC });
        expect(doseLines(noUnit)[0]).toMatchObject({ text: null, withheld: true });
        const html = render(detailOf([noUnit]), 'u');
        expect(html).toContain('dose-withheld');
        expect(html).not.toContain('dose-text');
    });

    it('reads a unit out of the written words ("३०-४० मिली", "40 ppm") and not out of a bare number', () => {
        expect(doseHasUnit('३०–४० मिली', null)).toBe(true);
        expect(doseHasUnit('GA3 40 ppm', null)).toBe(true);
        expect(doseHasUnit('२', null)).toBe(false);
        expect(doseHasUnit('२', 'ग्रॅम')).toBe(true);
        expect(doseHasUnit(null, null)).toBe(false);
    });

    it('a task-level dose with a unit and a source is shown; without a source it is withheld', () => {
        expect(doseLines(KINDS.irrigation)[0]).toMatchObject({ text: '२०,४०० लिटर प्रति दिवस', withheld: false });
        const bare = base({ taskKey: 'b', kind: 'irrigation', dose: '२०,४०० लिटर प्रति दिवस', sources: [] });
        expect(doseLines(bare)[0]).toMatchObject({ text: null, withheld: true });
    });
});

describe('UncheckedReference_ReadableAndMarked', () => {
    const unchecked = (): DayCardsDetail => detailOf([KINDS.spray], { check: { state: 'NotChecked', isChecked: false, checkedBy: null, checkedAtUtc: null } });

    it('is readable (the work, its steps and its dose are drawn) and marked as not checked', () => {
        const html = render(unchecked(), 's');
        expect(html).toContain('बुरशीनाशक फवारणी');
        expect(html).toContain('नीट मिसळा');
        expect(html).toContain('unchecked-mark');
        expect(html).toContain('unchecked-line');
        expect(html).toContain('मात्रा अजून तपासलेली नाही');
        expect(html).not.toContain('तपासलेली मात्रा');
    });

    it('says nobody has checked it on the checked-by line, and names the checker only for a checked version', () => {
        expect(render(unchecked(), 's')).toContain('अजून कुणी तपासलेलं नाही');
        const checked = render(detailOf([KINDS.spray]), 's');
        expect(checked).toContain('तपासनीस');
        expect(checked).toContain('तपासलेली मात्रा');
        expect(checked).not.toContain('unchecked-mark');
    });

    it('the three lines (made by, source, checked by) are separate', () => {
        const html = render(detailOf([KINDS.spray]), 's');
        expect(html).toContain('data-testid="line-made-by"');
        expect(html).toContain('data-testid="line-source"');
        expect(html).toContain('data-testid="line-checked-by"');
        expect(html).toContain('चाचणी पुस्तिका · ३');
    });

    it('a doseChecked flag the server did not send as true is read as not checked', () => {
        const parsed = parseDayCardsDetail({
            templateId: 'a', contentHash: 'h', name: 'n', kind: 'reference', check: { state: 'NotChecked', isChecked: true }, stages: [], challenges: [],
            tasks: [{ taskKey: 's', contentHash: 'x', task: { ...KINDS.spray }, shown: {} }],
        });
        expect(parsed?.tasks[0].doseChecked).toBe(false);
    });

    it('an own schedule is not called unchecked', () => {
        const own = detailOf([KINDS.work], { kind: 'own', check: { state: 'Own', isChecked: false, checkedBy: null, checkedAtUtc: null }, madeBy: { ownerType: null, label: null } });
        const html = render(own, 'w');
        expect(html).not.toContain('unchecked-mark');
        expect(html).toContain('तुमचं स्वतःचं वेळापत्रक');
    });
});

describe('shown days and no empty card', () => {
    it('a stored day 9 opens as the shown day 10 (stored + 1), through the one helper', () => {
        const d = detailOf([KINDS.work]);
        expect(tasksOnShownDay(d, 10).map(t => t.task.taskKey)).toEqual(['w']);
        expect(tasksOnShownDay(d, 9)).toEqual([]);
        expect(render(d, 'w')).toContain('दिवस १०');
    });

    it('a day before pruning is "N days before", never day 0 or a negative day', () => {
        const pre = base({ taskKey: 'pre', kind: 'irrigation', timing: { timer: 'day', fromDay: -5, toDay: -5, repeat: 'once' }, sources: SRC });
        const html = render(detailOf([pre]), 'pre');
        expect(html).toContain('छाटणीआधी ५ दिवस');
        expect(html).not.toMatch(/दिवस ०|दिवस -/);
    });

    it('days before the start day are reachable as "N days before", and the schedule steps from the first of them to its last day', () => {
        const pre = base({ taskKey: 'pre', kind: 'irrigation', timing: { timer: 'day', fromDay: -5, toDay: -5, repeat: 'once' }, sources: SRC });
        const d = detailOf([pre, KINDS.work]);
        expect(firstShownDay(d)).toBe(-4);
        expect(lastShownDay(d)).toBe(40 + 1);
        expect(positionText(-4, dayCardWords('mr'))).toBe('छाटणीआधी ५ दिवस');
        expect(positionText(0, dayCardWords('mr'))).toBe('छाटणीआधी १ दिवस');
        expect(positionText(1, dayCardWords('mr'))).toBe('दिवस १');
        expect(tasksOnShownDay(d, -4).map(t => t.task.taskKey)).toEqual(['pre']);
        const html = renderToStaticMarkup(<DayCardDeck parts={deckForShownDay(d, -4)} detail={d} words={dayCardWords('mr')} />);
        expect(html).toContain('छाटणीआधी ५ दिवस');
        expect(html).not.toMatch(/दिवस ०|दिवस -/);
    });

    it('every day of the schedule opens with at least a day card, and no card is blank', () => {
        const d = detailOf(Object.values(KINDS));
        for (let day = 1; day <= 60; day += 1) {
            const parts = deckForShownDay(d, day);
            expect(parts.length).toBeGreaterThan(0);
            expect(parts[0].type).toBe('day');
            const html = renderToStaticMarkup(<DayCardDeck parts={parts} detail={d} words={dayCardWords('mr')} />);
            const cards = html.split('data-testid="day-card"').slice(1);
            expect(cards.length).toBe(parts.length);
            for (const c of cards) expect(c.replace(/<[^>]*>/g, '').trim().length).toBeGreaterThan(0);
        }
    });

    it('a day with no work still says so in words', () => {
        const html = renderToStaticMarkup(<DayCardDeck parts={deckForShownDay(detailOf([KINDS.work]), 3)} detail={detailOf([KINDS.work])} words={dayCardWords('mr')} />);
        expect(html).toContain('आज ठरलेलं काम नाही');
    });

    it('a work with nothing but its name makes only its first and source cards', () => {
        const bare = base({ taskKey: 'bare', kind: 'work' });
        expect(cardsOfTask({ task: bare, contentHash: 'x', shown: { from: null, to: null, expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: false }).map(p => p.type)).toEqual(['hero', 'source']);
    });

    it('English mode prints its own words (its content stays as written)', () => {
        const html = render(detailOf([KINDS.spray], { check: { state: 'NotChecked', isChecked: false, checkedBy: null, checkedAtUtc: null } }), 's', 'en');
        expect(html).toContain('Spray');
        expect(html).toContain('Not checked');
        expect(html).toContain('Stay out of the plot for 24 hours after spraying');
        expect(html).not.toContain('मात्रा अजून तपासलेली नाही');
    });
});
