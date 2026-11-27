/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2 (CTO rulings, 27 Nov). What each day card may say,
 * from the open farm's records only. Every line needs its evidence on the phone (P4): no zero line, no invented count, no
 * guessed money, no price. A card with nothing true to say is not drawn.
 *   - D3: only with records on two different days; it opens the latest earlier day ("काल" only when that day IS yesterday).
 *   - D7: the last 7 days — days with work, days with हजेरी, the spending recorded, the work still open.
 *   - D14: only with a team — the days the team recorded work, and what waits for his approval.
 *   - D18: his own summary since the farm's first day. No price, no days left, no plan.
 */
import { describe, it, expect } from 'vitest';
import type { DailyLog } from '../../../types';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import { buildDayCard, type DayCardInput } from '../farmDaySummary';

const TODAY = '2026-11-27';
const SEL = { selection: [{ farmId: 'f1', cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['G1'] }] };
let n = 0;
const log = (date: string, over: Partial<DailyLog> = {}): DailyLog => ({
    id: `L${++n}`, date, context: SEL, dayOutcome: 'WORK_RECORDED',
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.CONFIRMED },
    meta: { createdByOperatorId: 'me' },
    ...over,
} as unknown as DailyLog);
const weeding = { id: 'a1', title: 'Weeding', status: 'completed' } as DailyLog['cropActivities'][number];
const people = (count: number) => ({ id: `lab-${count}`, type: 'HIRED', count }) as DailyLog['labour'][number];
const work = (date: string, over: Partial<DailyLog> = {}) => log(date, { cropActivities: [weeding], ...over });
const byTeam = (date: string) => work(date, { meta: { createdByOperatorId: 'ramesh' } } as Partial<DailyLog>);
const deleted = { deletion: { deletedAt: 'x' } } as unknown as Partial<DailyLog>;

const base = (over: Partial<DayCardInput>): DayCardInput => ({
    stage: 'd7', todayKey: TODAY, startKey: '2026-11-18',
    history: [], selfIds: new Set(['me', 'u-me']), hasTeam: false,
    openTasks: null, approvals: null, spend: null,
    ...over,
});
const kinds = (card: ReturnType<typeof buildDayCard>) => card?.lines.map(l => `${l.kind}:${l.n}`);

describe('D3 — "काल काय केलं ते पाहा"', () => {
    it('only with records on two different days', () => {
        expect(buildDayCard(base({ stage: 'd3', history: [] }))).toBeNull();
        expect(buildDayCard(base({ stage: 'd3', history: [work('2026-11-26'), work('2026-11-26')] }))).toBeNull();
        expect(buildDayCard(base({ stage: 'd3', history: [work(TODAY)] }))).toBeNull();
        // A deleted record is not a record; a future-dated one is not a day he had yet.
        expect(buildDayCard(base({ stage: 'd3', history: [work(TODAY), work('2026-11-26', deleted)] }))).toBeNull();
        expect(buildDayCard(base({ stage: 'd3', history: [work(TODAY), work('2026-11-29')] }))).toBeNull();
    });

    it('opens the latest earlier day; it says "yesterday" only when that day IS yesterday', () => {
        const y = buildDayCard(base({ stage: 'd3', history: [work('2026-11-24'), work('2026-11-26'), work(TODAY)] }));
        expect(y).toMatchObject({ stage: 'd3', action: 'reflectDay', target: { dateKey: '2026-11-26', yesterday: true }, lines: [] });
        const earlier = buildDayCard(base({ stage: 'd3', history: [work('2026-11-24'), work(TODAY)] }));
        expect(earlier).toMatchObject({ action: 'reflectDay', target: { dateKey: '2026-11-24', yesterday: false } });
        // Two earlier days and nothing today counts too.
        expect(buildDayCard(base({ stage: 'd3', history: [work('2026-11-23'), work('2026-11-25')] })))
            .toMatchObject({ target: { dateKey: '2026-11-25', yesterday: false } });
    });
});

describe('D7 — the last 7 days, each line only with its evidence', () => {
    it('nothing recorded and nothing open: no card at all (never a card of zeros)', () => {
        expect(buildDayCard(base({ stage: 'd7', openTasks: 0, spend: { amount: null, hidden: false, partial: [] } }))).toBeNull();
    });

    it('counts days, not records; only the last 7 days; deleted records do not count', () => {
        const card = buildDayCard(base({
            stage: 'd7',
            history: [
                work(TODAY), work(TODAY), work('2026-11-25'), work('2026-11-21'),
                work('2026-11-20'), // 7 days before today: outside the last 7 days (21..27)
                work('2026-11-24', deleted),
                log('2026-11-23'), // a record with no work done in it
            ],
        }));
        expect(kinds(card)).toEqual(['workDays:3']);
        expect(card?.action).toBe('reflect');
    });

    it('हजेरी days are the days a head count was said (the हजेरी rule), never a sum of people', () => {
        const card = buildDayCard(base({ stage: 'd7', history: [work(TODAY, { labour: [people(8)] }), work('2026-11-26', { labour: [people(3)] }), work('2026-11-25')] }));
        expect(kinds(card)).toEqual(['workDays:3', 'attendanceDays:2']);
    });

    it('the spending line only with a complete figure he may see, above zero', () => {
        const w = [work(TODAY)];
        expect(kinds(buildDayCard(base({ history: w, spend: { amount: 4500, hidden: false, partial: [] } })))).toEqual(['workDays:1', 'spend:4500']);
        expect(kinds(buildDayCard(base({ history: w, spend: { amount: 4500, hidden: false, partial: ['notOnServer'] } })))).toEqual(['workDays:1']);
        expect(kinds(buildDayCard(base({ history: w, spend: { amount: null, hidden: true, partial: [] } })))).toEqual(['workDays:1']);
        expect(kinds(buildDayCard(base({ history: w, spend: { amount: 0, hidden: false, partial: [] } })))).toEqual(['workDays:1']);
        expect(kinds(buildDayCard(base({ history: w, spend: null })))).toEqual(['workDays:1']);
    });

    it('the work still open only when known and above zero', () => {
        expect(kinds(buildDayCard(base({ openTasks: 2 })))).toEqual(['openTasks:2']);
        expect(buildDayCard(base({ openTasks: 0 }))).toBeNull();
        expect(buildDayCard(base({ openTasks: null }))).toBeNull();
    });

    it('a farm younger than 7 days counts from its first day only', () => {
        const card = buildDayCard(base({ stage: 'd7', startKey: '2026-11-24', history: [work('2026-11-23'), work('2026-11-24')] }));
        expect(kinds(card)).toEqual(['workDays:1']);
    });
});

describe('D14 — the team, only when there is one', () => {
    const teamWork = [byTeam(TODAY), byTeam(TODAY), byTeam('2026-11-22'), work('2026-11-26')];

    it('no team on this farm: no card, whatever the records say', () => {
        expect(buildDayCard(base({ stage: 'd14', hasTeam: false, history: teamWork, approvals: 3 }))).toBeNull();
    });

    it('the days the TEAM recorded work (his own records are not the team\'s), and what waits for his approval', () => {
        const card = buildDayCard(base({ stage: 'd14', hasTeam: true, history: teamWork, approvals: 3 }));
        expect(kinds(card)).toEqual(['teamDays:2', 'approvals:3']);
        expect(card?.action).toBe('approvals');
    });

    it('a record with no known author is never counted as the team\'s', () => {
        const unknown = work(TODAY, { meta: {} } as Partial<DailyLog>);
        expect(buildDayCard(base({ stage: 'd14', hasTeam: true, history: [unknown] }))).toBeNull();
    });

    it('nothing waiting (or not known): no approval line, and the card opens the overview', () => {
        const card = buildDayCard(base({ stage: 'd14', hasTeam: true, history: teamWork, approvals: 0 }));
        expect(kinds(card)).toEqual(['teamDays:2']);
        expect(card?.action).toBe('reflect');
        expect(kinds(buildDayCard(base({ stage: 'd14', hasTeam: true, history: teamWork, approvals: null })))).toEqual(['teamDays:2']);
    });

    it('a team that recorded nothing and nothing waiting: no card', () => {
        expect(buildDayCard(base({ stage: 'd14', hasTeam: true, history: [work(TODAY)], approvals: 0 }))).toBeNull();
    });
});

describe('D18 — his own summary since the farm\'s first day; no price', () => {
    it('days with work, हजेरी days and the spending since the start; the team\'s days when there is a team', () => {
        const history = [
            work('2026-11-10'), // before the farm's first day: not this farm's story
            work('2026-11-18', { labour: [people(4)] }), work('2026-11-20'), work(TODAY), byTeam('2026-11-22'),
        ];
        const card = buildDayCard(base({ stage: 'd18', startKey: '2026-11-18', history, hasTeam: true, spend: { amount: 12000, hidden: false, partial: [] }, openTasks: 5 }));
        expect(kinds(card)).toEqual(['workDays:4', 'attendanceDays:1', 'spend:12000', 'teamDays:1']);
        expect(card?.action).toBe('reflect');
    });

    it('nothing recorded since the start: no card', () => {
        expect(buildDayCard(base({ stage: 'd18', history: [] }))).toBeNull();
    });
});
