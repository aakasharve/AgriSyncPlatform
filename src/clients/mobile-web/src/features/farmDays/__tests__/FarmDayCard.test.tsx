// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2 (CTO rulings, 27 Nov). The day card on Home:
 *   - only from the farm's creation date as the phone holds it (no date known → no card), only for an owner or co-owner seat;
 *   - once per stage per farm per phone; "बंद करा" or acting on it closes it for good; a phone past those days sees only the
 *     CURRENT stage's card, never a backlog; from day 21 nothing;
 *   - every line only with its evidence; money only for a seat that may see it; no price, no trial, no days left, no plan;
 *   - Marathi mode Marathi only (Devanagari digits), English mode English only.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { DailyLog, FarmOperator } from '../../../types';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { addDaysToKey } from '../farmDayStage';

const h = vi.hoisted(() => ({
    prefs: {} as Record<string, unknown>,
    startKey: null as string | null,
    startAskedFor: [] as (string | null | undefined)[],
    english: false,
    tasks: [] as { status: string }[],
    approvals: null as number | null,
    ledgerAsked: 0,
    ledger: { entries: [] as unknown[], gaps: [] as unknown[], complete: true },
    openReview: [] as unknown[],
}));
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [v, setV] = R.useState<T>(() => (key in h.prefs ? (h.prefs[key] as T) : fallback));
            const [k, setK] = R.useState(key);
            if (k !== key) { setK(key); setV(key in h.prefs ? (h.prefs[key] as T) : fallback); }
            return [v, (n: T) => { h.prefs[key] = n; setV(n); }, true] as const;
        },
    };
});
vi.mock('../useFarmStartKey', () => ({
    useFarmStartKey: (farmId: string | null | undefined) => { h.startAskedFor.push(farmId); return farmId ? h.startKey : null; },
}));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => (h.english ? { language: 'en' } : undefined),
}));
vi.mock('../../plannedWork/data/usePlannedWork', () => ({ usePlannedWork: () => ({ items: h.tasks, loaded: true }) }));
vi.mock('../../approval/useApprovalQueue', () => ({ useApprovalQueue: () => ({ count: h.approvals }) }));
vi.mock('../../approval/openApprovalReview', () => ({ openApprovalReview: (...a: unknown[]) => { h.openReview.push(a); } }));
vi.mock('../../reflect/overview/useMoneyLedger', () => ({ useMoneyLedger: () => { h.ledgerAsked += 1; return h.ledger; } }));

import { FarmDayCardHost, farmDayCardKey } from '../FarmDayCard';

const TODAY = getDateKey();
const daysAgo = (n: number) => addDaysToKey(TODAY, -n);
const SEL = { selection: [{ farmId: 'f1', cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['G1'] }] };
let n = 0;
const work = (date: string, over: Partial<DailyLog> = {}): DailyLog => ({
    id: `L${++n}`, date, context: SEL, dayOutcome: 'WORK_RECORDED',
    cropActivities: [{ id: 'a1', title: 'Weeding', status: 'completed' }], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.CONFIRMED }, meta: { createdByOperatorId: 'me' },
    ...over,
} as unknown as DailyLog);
const ME = { id: 'me', name: 'प्रकाश', role: 'PRIMARY_OWNER', capabilities: [], isVerifier: true } as FarmOperator;
const RAMESH = { id: 'ramesh', name: 'रमेश', role: 'MUKADAM', capabilities: [], isVerifier: false } as FarmOperator;

beforeEach(() => {
    h.prefs = {};
    h.startKey = null;
    h.startAskedFor = [];
    h.english = false;
    h.tasks = [];
    h.approvals = null;
    h.ledgerAsked = 0;
    h.ledger = { entries: [], gaps: [], complete: true };
    h.openReview = [];
});
afterEach(cleanup);

type Props = React.ComponentProps<typeof FarmDayCardHost>;
const mount = async (over: Partial<Props> = {}) => {
    const props: Props = {
        farmId: 'f1', role: 'PrimaryOwner', history: [], crops: [], people: [ME],
        activeOperatorId: 'me', userId: 'u-me', maySeeMoney: true, seesFarmPlan: true,
        onOpenOverview: vi.fn(),
        ...over,
    };
    let view: ReturnType<typeof render> | undefined;
    await act(async () => { view = render(<FarmDayCardHost {...props} />); });
    return { props, rerender: (next: Partial<Props>) => view!.rerender(<FarmDayCardHost {...props} {...next} />) };
};
const card = () => screen.queryByTestId('farm-day-card');
const text = () => card()?.textContent ?? '';

describe('when a day card shows at all', () => {
    it('the phone does not know the farm\'s creation date: no card (never a guess)', async () => {
        h.startKey = null;
        await mount({ history: [work(daysAgo(1)), work(TODAY)] });
        expect(card()).toBeNull();
        expect(h.startAskedFor).toContain('f1');
    });

    it('days 0-2: no card; from day 21: no card (D21 is nothing in the pilot)', async () => {
        for (const day of [0, 2, 21, 45]) {
            h.startKey = daysAgo(day);
            await mount({ history: [work(daysAgo(1)), work(TODAY)], people: [ME, RAMESH] });
            expect(card(), `day ${day}`).toBeNull();
            cleanup();
        }
    });

    it('only an owner or a co-owner seat; a worker, a मुकादम, an adviser or an unknown role sees none', async () => {
        h.startKey = daysAgo(3);
        const history = [work(daysAgo(1)), work(TODAY)];
        await mount({ role: 'SecondaryOwner', history });
        expect(card()).toHaveAttribute('data-stage', 'd3');
        cleanup();
        for (const role of ['Worker', 'Mukadam', 'Agronomist', null]) {
            await mount({ role, history });
            expect(card(), String(role)).toBeNull();
            cleanup();
        }
    });

    it('demo mode (sample records): no card', async () => {
        h.startKey = daysAgo(3);
        await mount({ demo: true, history: [work(daysAgo(1)), work(TODAY)] });
        expect(card()).toBeNull();
    });
});

describe('D3 — "काल काय केलं ते पाहा"', () => {
    it('opens आढावा on yesterday, and never comes back once answered', async () => {
        h.startKey = daysAgo(3);
        const { props } = await mount({ history: [work(daysAgo(1)), work(TODAY)] });
        expect(card()).toHaveAttribute('data-stage', 'd3');
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('काल काय केलं ते पाहा');
        expect(screen.getByTestId('farm-day-card-open')).toHaveTextContent('आढावा उघडा');
        expect(screen.getByTestId('farm-day-card-close')).toHaveTextContent('बंद करा');
        expect(text()).not.toMatch(/[A-Za-z]/);
        fireEvent.click(screen.getByTestId('farm-day-card-open'));
        expect(props.onOpenOverview).toHaveBeenCalledWith(daysAgo(1));
        expect(card()).toBeNull();
        expect(h.prefs[farmDayCardKey('f1')]).toEqual(['d3']);
        cleanup();
        await mount({ history: [work(daysAgo(1)), work(TODAY)] });
        expect(card()).toBeNull();
    });

    it('records on one day only: no card', async () => {
        h.startKey = daysAgo(4);
        await mount({ history: [work(TODAY), work(TODAY)] });
        expect(card()).toBeNull();
    });

    it('"बंद करा" closes it for good and opens nothing', async () => {
        h.startKey = daysAgo(5);
        const { props } = await mount({ history: [work(daysAgo(3)), work(TODAY)] });
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('मागच्या नोंदी पाहा');
        fireEvent.click(screen.getByTestId('farm-day-card-close'));
        expect(card()).toBeNull();
        expect(props.onOpenOverview).not.toHaveBeenCalled();
        expect(h.prefs[farmDayCardKey('f1')]).toEqual(['d3']);
    });
});

describe('a phone past those days: only the CURRENT stage, never a backlog', () => {
    it('day 9 with D3 never answered: the D7 card, and only it', async () => {
        h.startKey = daysAgo(9);
        h.tasks = [{ status: 'Planned' }];
        await mount({ history: [work(daysAgo(1)), work(TODAY)] });
        expect(screen.getAllByTestId('farm-day-card')).toHaveLength(1);
        expect(card()).toHaveAttribute('data-stage', 'd7');
    });

    it('each farm keeps its own answered stages (one farm at a time)', async () => {
        h.startKey = daysAgo(3);
        h.prefs[farmDayCardKey('f1')] = ['d3'];
        const history = [work(daysAgo(1)), work(TODAY)];
        const { rerender } = await mount({ farmId: 'f1', history });
        expect(card()).toBeNull();
        await act(async () => { rerender({ farmId: 'f2', history }); });
        expect(card()).toHaveAttribute('data-stage', 'd3');
    });
});

describe('D7 — the last 7 days, each line only with its evidence', () => {
    beforeEach(() => { h.startKey = daysAgo(8); });

    it('days with work, हजेरी days, the spending, the open work — Devanagari digits, no price', async () => {
        h.tasks = [{ status: 'Planned' }, { status: 'Done' }, { status: 'InProgress' }];
        h.ledger = { entries: [{ id: 'e1', dateKey: daysAgo(2), direction: 'Expense', category: 'Labour', amount: 4500 }], gaps: [], complete: true };
        const people = [{ id: 'lab-8', type: 'HIRED', count: 8 }] as unknown as DailyLog['labour'];
        await mount({ history: [work(TODAY, { labour: people }), work(daysAgo(2)), work(daysAgo(10))] });
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('मागच्या ७ दिवसांत तुमच्या शेतावर');
        expect(screen.getByTestId('farm-day-line-workDays')).toHaveTextContent('२ दिवस कामाची नोंद झाली');
        expect(screen.getByTestId('farm-day-line-attendanceDays')).toHaveTextContent('१ दिवसाची हजेरी नोंदली');
        expect(screen.getByTestId('farm-day-line-spend')).toHaveTextContent('₹ ४,५०० खर्च नोंदला');
        expect(screen.getByTestId('farm-day-line-openTasks')).toHaveTextContent('२ कामे बाकी आहेत');
        expect(text()).not.toMatch(/[A-Za-z]/);
        expect(text()).not.toMatch(/२९९|चाचणी|मुदत|दिवस बाकी|प्लॅन|सदस्यता|विनामूल्य/);
    });

    it('a seat that may not see money: no spending line, and the ledger is never read', async () => {
        h.ledger = { entries: [{ id: 'e1', dateKey: TODAY, direction: 'Expense', category: 'Labour', amount: 4500 }], gaps: [], complete: true };
        await mount({ maySeeMoney: false, history: [work(TODAY)] });
        expect(screen.queryByTestId('farm-day-line-spend')).toBeNull();
        expect(h.ledgerAsked).toBe(0);
        expect(screen.getByTestId('farm-day-line-workDays')).toBeInTheDocument();
    });

    it('a partial money figure is not shown as if whole', async () => {
        h.ledger = { entries: [{ id: 'e1', dateKey: TODAY, direction: 'Expense', category: 'Labour', amount: 4500 }], gaps: [{ dateKey: TODAY, direction: 'Expense' }], complete: true };
        await mount({ history: [work(TODAY)] });
        expect(screen.queryByTestId('farm-day-line-spend')).toBeNull();
    });

    it('the open-work line only where the plan door shows the farm\'s count', async () => {
        h.tasks = [{ status: 'Planned' }];
        await mount({ seesFarmPlan: false, history: [work(TODAY)] });
        expect(screen.queryByTestId('farm-day-line-openTasks')).toBeNull();
    });

    it('nothing true to say: no card (never a card of zeros)', async () => {
        await mount({ history: [] });
        expect(card()).toBeNull();
    });
});

describe('D14 — the team, only when there is one', () => {
    beforeEach(() => { h.startKey = daysAgo(15); });

    it('no team on this farm: no card', async () => {
        h.approvals = 3;
        await mount({ people: [ME], history: [work(TODAY, { meta: { createdByOperatorId: 'ramesh' } } as Partial<DailyLog>)] });
        expect(card()).toBeNull();
    });

    it('the team\'s days and what waits for his approval; "नोंदी तपासा" opens the one approval sheet', async () => {
        h.approvals = 2;
        const { props } = await mount({ people: [ME, RAMESH], history: [work(TODAY, { meta: { createdByOperatorId: 'ramesh' } } as Partial<DailyLog>), work(daysAgo(1))] });
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('मागच्या ७ दिवसांत तुमची टीम');
        expect(screen.getByTestId('farm-day-line-teamDays')).toHaveTextContent('टीमने १ दिवस काम नोंदवलं');
        expect(screen.getByTestId('farm-day-line-approvals')).toHaveTextContent('२ नोंदी तुमच्या मंजुरीची वाट पाहत आहेत');
        fireEvent.click(screen.getByTestId('farm-day-card-open'));
        expect(screen.queryByTestId('farm-day-card')).toBeNull();
        expect(h.openReview).toHaveLength(1);
        expect(props.onOpenOverview).not.toHaveBeenCalled();
        expect(h.prefs[farmDayCardKey('f1')]).toEqual(['d14']);
    });
});

describe('D18 — his own summary since the start; no price, no days left, no plan', () => {
    it('since the farm\'s first day', async () => {
        h.startKey = daysAgo(19);
        h.ledger = { entries: [{ id: 'e1', dateKey: daysAgo(12), direction: 'Expense', category: 'Input', amount: 12000 }], gaps: [], complete: true };
        await mount({ history: [work(daysAgo(18)), work(daysAgo(12)), work(TODAY)] });
        expect(card()).toHaveAttribute('data-stage', 'd18');
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('सुरुवातीपासून तुमच्या शेतावर');
        expect(screen.getByTestId('farm-day-line-workDays')).toHaveTextContent('३ दिवस कामाची नोंद झाली');
        expect(screen.getByTestId('farm-day-line-spend')).toHaveTextContent('₹ १२,००० खर्च नोंदला');
        expect(text()).not.toMatch(/२९९|चाचणी|मुदत|दिवस बाकी|प्लॅन|सदस्यता|विनामूल्य|किंमत|शुल्क/);
    });
});

describe('English mode: English only', () => {
    it('the D7 card', async () => {
        h.english = true;
        h.startKey = daysAgo(7);
        h.tasks = [{ status: 'Planned' }];
        await mount({ history: [work(TODAY)] });
        expect(screen.getByTestId('farm-day-card-title')).toHaveTextContent('On your farm in the last 7 days');
        expect(screen.getByTestId('farm-day-line-workDays')).toHaveTextContent('Work recorded on 1 day');
        expect(screen.getByTestId('farm-day-line-openTasks')).toHaveTextContent('1 task still open');
        expect(screen.getByTestId('farm-day-card-open')).toHaveTextContent('Open the overview');
        expect(screen.getByTestId('farm-day-card-close')).toHaveTextContent('Close');
        expect(text()).not.toMatch(/[ऀ-ॿ]/);
        expect(text()).not.toMatch(/trial|price|days left|plan\b/i);
    });
});
