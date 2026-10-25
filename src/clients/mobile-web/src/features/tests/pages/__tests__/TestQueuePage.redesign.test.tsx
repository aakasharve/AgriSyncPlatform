// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — चाचण्या on the approved look, over the
 * real tests.
 *
 * What must hold:
 *   - no English left on the page or its two sheets (the fixture's server words — test and stage names — are
 *     Marathi here, so ANY Latin letter in the text, a placeholder or an aria-label is a leftover);
 *   - the real states land in their groups, in order: वेळ उलटून गेली → करायची आहे → नमुना घेतला → निकाल आला
 *     (folded until opened), a waived test is never listed; the four real filters still filter, and a filter
 *     that hides everything says so instead of the "no tests" sentence;
 *   - each card's button still calls the real thing: `/collect`, `captureAttachment` + `/report`, and the
 *     test's own page (`/tests/{id}` + 'test-detail');
 *   - review B001: the server's suggestions (`recommendationId`, the SERVER's `createdAtUtc`) are really
 *     stored — in a real IndexedDB table, which rejects a row without its key the way the phone does;
 *   - review B002: "माहिती ताजी केली" only after a server call answered; no crop cycle → said, nothing asked;
 *     some cycles failed → the time AND an "older copy" line; "no tests" only when the server said so;
 *   - review B003: 403 / 400 TestInvalidState / 400 TestAttachmentInvalid / anything else each say their
 *     own Marathi line;
 *   - review B004: a double tap on "हो, घेतला" sends ONE `/collect`;
 *   - `?action=` opens a sheet once, only for the named test, and only when its state fits;
 *   - मागे, "सांगा" and the role-gated "लवकरच" are drawn only when they can do something (P5).
 *
 * The REAL `testsClient` runs against a fake server (`fetch` stubbed) that answers in the server's own JSON
 * shapes (`TestInstanceDto`, `TestRecommendationDto`, `{ error }` bodies, an empty 403). The phone's database
 * is a stub except `testRecommendations`, which is a real Dexie table on fake-indexeddb. Both sheets are real.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string; status: number };

const farm = { role: 'Owner' };
vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({
        currentFarmId: 'farm-1',
        currentFarm: { farmId: 'farm-1', role: farm.role },
        meContext: { me: { displayName: 'सुरेश' } },
    }),
}));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({ getAuthSession: () => null }));

/** The phone's suggestions table, for real: primary key `id`, as in `dexie/versions` (`'id, testInstanceId'`). */
const recDb = new Dexie('tests-page-recommendations-proof');
recDb.version(1).stores({ testRecommendations: 'id, testInstanceId' });
const recTable = recDb.table('testRecommendations');

const store: { rows: Row[]; cycles: { id: string }[] } = { rows: [], cycles: [] };
const upsert = (row: Row) => { store.rows = [...store.rows.filter(r => r.id !== row.id), row]; };
let putGate: Promise<void> | null = null;
const db = {
    testInstances: {
        where: () => ({ equals: () => ({ toArray: async () => store.rows }) }),
        bulkPut: vi.fn(async (rows: Row[]) => { rows.forEach(upsert); }),
        put: vi.fn(async (row: Row) => { if (putGate) await putGate; upsert(row); }),
    },
    testProtocols: { toArray: async () => [] },
    testRecommendations: recTable,
    plots: {
        where: () => ({ equals: () => ({ toArray: async () => [{ id: 'plot-1', farmId: 'farm-1', payload: { name: 'विहिरीजवळचा' } }] }) }),
    },
    cropCycles: { where: () => ({ equals: () => ({ toArray: async () => store.cycles }) }) },
};
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({ getDatabase: () => db }));

const capture = vi.hoisted(() => ({ captureAttachment: vi.fn() }));
vi.mock('../../../../application/use-cases/CaptureAttachment', () => capture);

// ---------------------------------------------------------------- the fake server

type Reply = { status: number; body?: unknown };
const server = {
    queue: vi.fn(async (_cycleId: string): Promise<Reply> => ({ status: 200, body: [] })),
    collect: vi.fn(async (_id: string): Promise<Reply> => ({ status: 500 })),
    report: vi.fn(async (_id: string, _body: unknown): Promise<Reply> => ({ status: 500 })),
};
const fakeFetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    const u = new URL(url);
    let m: RegExpMatchArray | null;
    let reply: Reply;
    if ((m = u.pathname.match(/\/shramsafal\/test-instances\/([^/]+)\/collect$/))) reply = await server.collect(m[1]);
    else if ((m = u.pathname.match(/\/shramsafal\/test-instances\/([^/]+)\/report$/))) reply = await server.report(m[1], JSON.parse(String(init?.body ?? '{}')));
    else if (u.pathname.endsWith('/shramsafal/test-instances')) reply = await server.queue(u.searchParams.get('cropCycleId') ?? '');
    else reply = { status: 404, body: { error: 'ShramSafal.NotRouted' } };
    return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => {
            if (reply.body === undefined) throw new SyntaxError('Unexpected end of JSON input'); // e.g. 403 Forbid()
            return reply.body;
        },
    };
});
const collectCalls = () => fakeFetch.mock.calls.filter(([url]) => String(url).endsWith('/collect')).length;

import TestQueuePage from '../TestQueuePage';

const base = {
    testProtocolId: 'proto-1', cropCycleId: 'cycle-1', farmId: 'farm-1', plotId: 'plot-1', stageName: 'फुलोरा',
    attachmentIds: [], results: [], protocolKind: 0, testProtocolName: 'माती परीक्षण',
    modifiedAtUtc: '2026-10-01T00:00:00.000Z', createdAtUtc: '2026-10-01T00:00:00.000Z',
};
const row = (id: string, status: number, extra: Record<string, unknown> = {}): Row => ({ ...base, id, status, plannedDueDate: '2026-10-20', ...extra });
const FIXTURE: Row[] = [
    row('t-due', 0, { plannedDueDate: '2026-10-30', protocolKind: 1, testProtocolName: undefined }),
    row('t-over', 3, { plannedDueDate: '2026-10-01' }),
    row('t-coll', 1, { collectedAtUtc: '2026-10-21T05:00:00Z' }),
    row('t-rep', 2, { reportedAtUtc: '2026-10-23T05:00:00Z', results: [{ parameterCode: 'नत्र', parameterValue: '140', unit: 'किलो' }] }),
    row('t-waived', 4),
];

/** `TestInstanceDto` as the server serialises it (camelCase; string enums). */
const apiInstance = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    testInstanceId: id, testProtocolId: 'proto-1', testProtocolName: 'माती परीक्षण', protocolKind: 'Soil',
    cropCycleId: 'cycle-1', farmId: 'farm-1', plotId: 'plot-1', stageName: 'फुलोरा', plannedDueDate: '2026-10-30',
    status, collectedByUserId: null, collectedAtUtc: null, reportedByUserId: null, reportedAtUtc: null,
    attachmentCount: 0, resultCount: 0, modifiedAtUtc: '2026-10-25T06:00:00Z', ...extra,
});

/** `TestRecommendationDto` as the server serialises it — `recommendationId`, and the SERVER's time. */
const SERVER_REC = {
    recommendationId: '6f1c2b9e-0a4d-4c55-9f61-2d7e3a9b1c01',
    testInstanceId: 't-coll',
    ruleCode: 'soil.n.low.apply-urea',
    titleEn: 'Nitrogen low — schedule urea',
    titleMr: 'नायट्रोजन कमी — युरिया नियोजन करा',
    suggestedActivityName: 'Urea application',
    suggestedOffsetDays: 3,
    createdAtUtc: '2026-10-25T05:59:58.123Z',
};

/** Every Latin letter a farmer could read: text, placeholders, labels, alt text. */
function latinLeftovers(): string[] {
    const found: string[] = [...((document.body.textContent ?? '').match(/[A-Za-z]+/g) ?? [])];
    document.body.querySelectorAll('[placeholder],[aria-label],[alt],[title]').forEach(el => {
        ['placeholder', 'aria-label', 'alt', 'title'].forEach(a => {
            const v = el.getAttribute(a);
            if (v && /[A-Za-z]/.test(v)) found.push(`${a}=${v}`);
        });
    });
    return found;
}

const cardIdsIn = (groupTestId: string) =>
    within(screen.getByTestId(groupTestId)).queryAllByTestId(/^test-card-/).map(el => el.getAttribute('data-testid'));
const allCardIds = () => screen.queryAllByTestId(/^test-card-/).map(el => el.getAttribute('data-testid'));
const openPage = async (props: React.ComponentProps<typeof TestQueuePage> = {}) => {
    const view = render(<TestQueuePage {...props} />);
    await screen.findByTestId('tests-filter-All');
    return view;
};
/** Fill the one free row and attach a report, ready to save. */
const fillResultSheet = async () => {
    fireEvent.change(screen.getByTestId('record-code-0'), { target: { value: 'नत्र' } });
    fireEvent.change(screen.getByTestId('record-value-0'), { target: { value: '140' } });
    fireEvent.change(screen.getByTestId('record-unit-0'), { target: { value: 'किलो' } });
    await act(async () => { fireEvent.click(screen.getByTestId('record-attach')); });
};

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T06:00:00Z')); // 11:30 in the morning, 25 Oct, IST
    vi.stubGlobal('fetch', fakeFetch);
    store.rows = FIXTURE.map(r => ({ ...r }));
    store.cycles = [];
    farm.role = 'Owner';
    putGate = null;
    server.queue.mockImplementation(async () => ({ status: 200, body: [] }));
    server.collect.mockImplementation(async () => ({ status: 500 }));
    server.report.mockImplementation(async () => ({ status: 500 }));
    capture.captureAttachment.mockResolvedValue({ id: 'att-1' });
    await recTable.clear();
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
});

describe('चाचण्या — grouped by the real state', () => {
    it('puts each test in its group, in order, folds the results, and never lists a waived test', async () => {
        await openPage();

        expect(cardIdsIn('tests-overdue')).toEqual(['test-card-t-over']);
        expect(cardIdsIn('tests-due')).toEqual(['test-card-t-due']);
        expect(cardIdsIn('tests-collected')).toEqual(['test-card-t-coll']);
        expect(within(screen.getByTestId('tests-overdue')).getByText('वेळ उलटून गेली', { selector: 'h2' })).toBeInTheDocument();
        expect(within(screen.getByTestId('tests-due')).getByText('करायची आहे', { selector: 'h2' })).toBeInTheDocument();
        expect(within(screen.getByTestId('tests-collected')).getByText('नमुना घेतला', { selector: 'h2' })).toBeInTheDocument();

        const order = ['tests-overdue', 'tests-due', 'tests-collected', 'tests-reported'].map(id => screen.getByTestId(id));
        for (let i = 1; i < order.length; i++) {
            expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }

        // Results are folded (they were a collapsed band), with their real count.
        expect(cardIdsIn('tests-reported')).toEqual([]);
        expect(screen.getByTestId('tests-reported-toggle')).toHaveTextContent('निकाल आला');
        expect(screen.getByTestId('tests-reported-toggle')).toHaveTextContent('1');
        fireEvent.click(screen.getByTestId('tests-reported-toggle'));
        expect(cardIdsIn('tests-reported')).toEqual(['test-card-t-rep']);

        expect(screen.queryByTestId('test-card-t-waived')).toBeNull();
    });

    it('each card says what, where and when from the real record — no invented day', async () => {
        await openPage();

        const over = screen.getByTestId('test-card-t-over');
        expect(over).toHaveTextContent('माती परीक्षण');
        expect(over).toHaveTextContent('विहिरीजवळचा · फुलोरा');
        expect(screen.getByTestId('test-when-t-over')).toHaveTextContent('ठरलेली तारीख 1 ऑक्टो · 24 दिवस उशीर');

        // No protocol name from the server → the kind, in Marathi.
        expect(screen.getByTestId('test-card-t-due')).toHaveTextContent('पाण्याची तपासणी');
        expect(screen.getByTestId('test-when-t-due')).toHaveTextContent('ठरलेली तारीख 30 ऑक्टो');
        expect(screen.getByTestId('test-when-t-due')).not.toHaveTextContent('उशीर');

        expect(screen.getByTestId('test-when-t-coll')).toHaveTextContent('नमुना घेतला 21 ऑक्टो');

        fireEvent.click(screen.getByTestId('tests-reported-toggle'));
        expect(screen.getByTestId('test-when-t-rep')).toHaveTextContent('निकाल आला 23 ऑक्टो');
        expect(screen.getByTestId('test-result-t-rep')).toHaveTextContent('नत्र 140 किलो');
    });

    it('the four real filters still filter; the निकाल आला filter shows results open', async () => {
        await openPage();

        fireEvent.click(screen.getByTestId('tests-filter-Overdue'));
        expect(allCardIds()).toEqual(['test-card-t-over']);

        fireEvent.click(screen.getByTestId('tests-filter-Due'));
        expect(allCardIds()).toEqual(['test-card-t-due']);

        fireEvent.click(screen.getByTestId('tests-filter-Reported'));
        expect(screen.queryByTestId('tests-reported-toggle')).toBeNull();
        expect(cardIdsIn('tests-reported')).toEqual(['test-card-t-rep']);

        fireEvent.click(screen.getByTestId('tests-filter-All'));
        expect(allCardIds()).toHaveLength(3); // results folded again
    });

    it('?filter= still picks the filter on arrival', async () => {
        window.history.replaceState({}, '', '/tests?filter=Reported');
        await openPage();
        expect(screen.getByTestId('tests-filter-Reported')).toHaveAttribute('aria-pressed', 'true');
        expect(cardIdsIn('tests-reported')).toEqual(['test-card-t-rep']);
    });

    it('a filter that hides every test says so — never the "no tests" sentence', async () => {
        store.rows = [row('t-due', 0)];
        await openPage();
        fireEvent.click(screen.getByTestId('tests-filter-Overdue'));
        expect(screen.getByTestId('tests-empty-filter')).toHaveTextContent('या निवडीत एकही चाचणी नाही');
        expect(screen.queryByText('आज कोणत्याही चाचण्या नाहीत')).toBeNull();
    });

    it('?plotId= scopes the list and says to which plot', async () => {
        store.rows = [row('t-a', 0), row('t-b', 0, { plotId: 'plot-2' })];
        window.history.replaceState({}, '', '/tests?plotId=plot-1');
        await openPage();
        expect(allCardIds()).toEqual(['test-card-t-a']);
        await waitFor(() => expect(screen.getByTestId('tests-scope')).toHaveTextContent('फक्त या प्लॉटच्या चाचण्या — विहिरीजवळचा'));
    });
});

describe('चाचण्या — no English left', () => {
    it('the page, every group open, with मागे, सांगा and the role line', async () => {
        farm.role = 'Agronomist';
        store.cycles = [{ id: 'cycle-1' }];
        await openPage({ onBack: vi.fn(), onTell: vi.fn() });
        await screen.findByTestId('tests-refreshed');
        fireEvent.click(screen.getByTestId('tests-reported-toggle'));

        expect(screen.getByTestId('page-title')).toHaveTextContent('चाचण्या');
        expect(screen.getByText('माती, पाणी आणि पानांच्या तपासण्या — काय करायचं, कोणता नमुना घेतला, काय निकाल आला.')).toBeInTheDocument();
        expect(screen.getByTestId('tests-refreshed')).toHaveTextContent('माहिती ताजी केली: सकाळी 11:30');
        expect(latinLeftovers()).toEqual([]);
    });

    it('the confirm sheet and the result sheet, including the saved panel', async () => {
        server.report.mockImplementation(async () => ({ status: 200, body: { testInstanceId: 't-coll', status: 'Reported', recommendations: [SERVER_REC] } }));
        await openPage();

        fireEvent.click(screen.getByTestId('test-action-t-over'));
        expect(screen.getByTestId('collect-sheet')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByTestId('collect-cancel'));

        fireEvent.click(screen.getByTestId('test-action-t-coll'));
        expect(screen.getByTestId('record-sheet')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);

        await fillResultSheet();
        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        await screen.findByTestId('record-success');
        expect(latinLeftovers()).toEqual([]); // the server's English title is not shown beside the Marathi one
    });
});

describe('चाचण्या — the actions still call the real thing', () => {
    it('नमुना घेतला → POST /collect, and the card moves to नमुना घेतला with the server\'s answer', async () => {
        server.collect.mockImplementation(async (id: string) => ({
            status: 200, body: apiInstance(id, 'Collected', { protocolKind: 'Soil', testProtocolName: null, collectedAtUtc: '2026-10-25T06:00:00Z' }),
        }));
        await openPage();

        fireEvent.click(screen.getByTestId('test-action-t-due'));
        expect(screen.getByTestId('collect-by')).toHaveTextContent('कोणी घेतला: सुरेश');
        await act(async () => { fireEvent.click(screen.getByTestId('collect-confirm')); });

        expect(server.collect).toHaveBeenCalledWith('t-due');
        expect(db.testInstances.put).toHaveBeenCalledWith(expect.objectContaining({ id: 't-due', status: 1 }));
        await waitFor(() => expect(screen.queryByTestId('collect-sheet')).toBeNull());
        expect(cardIdsIn('tests-collected')).toContain('test-card-t-due');
        expect(screen.getByTestId('test-when-t-due')).toHaveTextContent('नमुना घेतला 25 ऑक्टो');
    });

    it('निकाल नोंदवा → captureAttachment + POST /report; save stays off until a value AND a report', async () => {
        server.report.mockImplementation(async () => ({ status: 200, body: { testInstanceId: 't-coll', status: 'Reported', recommendations: [SERVER_REC] } }));
        await openPage();

        fireEvent.click(screen.getByTestId('test-action-t-coll'));
        expect(screen.getByTestId('record-save')).toBeDisabled();
        expect(screen.getByTestId('record-needs-report')).toBeInTheDocument();

        fireEvent.change(screen.getByTestId('record-code-0'), { target: { value: 'नत्र' } });
        fireEvent.change(screen.getByTestId('record-value-0'), { target: { value: '140' } });
        fireEvent.change(screen.getByTestId('record-unit-0'), { target: { value: 'किलो' } });
        expect(screen.getByTestId('record-save')).toBeDisabled(); // no report yet

        await act(async () => { fireEvent.click(screen.getByTestId('record-attach')); });
        expect(capture.captureAttachment).toHaveBeenCalledWith({
            source: 'file', farmId: 'farm-1', linkedEntityId: 't-coll', linkedEntityType: 'TestInstance',
        });
        expect(screen.getByTestId('record-attach')).toHaveTextContent('रिपोर्ट जोडला (1)');
        expect(screen.getByTestId('record-save')).toBeEnabled();

        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        expect(server.report).toHaveBeenCalledWith('t-coll', {
            results: [{ parameterCode: 'नत्र', parameterValue: '140', unit: 'किलो' }],
            attachmentIds: ['att-1'],
            clientCommandId: null,
        });
        expect(await screen.findByTestId('record-success')).toHaveTextContent('नायट्रोजन कमी — युरिया नियोजन करा');

        await act(async () => { fireEvent.click(screen.getByTestId('record-done')); });
        await waitFor(() => expect(screen.queryByTestId('record-sheet')).toBeNull());
    });

    it('निकाल पहा → the test\'s own page (/tests/{id} + test-detail)', async () => {
        const onNavigate = vi.fn();
        await openPage({ onNavigate });
        fireEvent.click(screen.getByTestId('tests-reported-toggle'));
        fireEvent.click(screen.getByTestId('test-action-t-rep'));
        expect(window.location.pathname).toBe('/tests/t-rep');
        expect(onNavigate).toHaveBeenCalledWith('test-detail');
    });
});

describe('B001 — the server\'s suggestions are really kept on the phone', () => {
    it('stored under the server\'s recommendationId, with the server\'s createdAtUtc, in a real keyed table', async () => {
        server.report.mockImplementation(async () => ({ status: 200, body: { testInstanceId: 't-coll', status: 'Reported', recommendations: [SERVER_REC] } }));
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-coll'));
        await fillResultSheet();
        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        await screen.findByTestId('record-success');

        const stored = await recTable.toArray();
        expect(stored).toEqual([{
            id: SERVER_REC.recommendationId,
            testInstanceId: 't-coll',
            ruleCode: 'soil.n.low.apply-urea',
            titleEn: 'Nitrogen low — schedule urea',
            titleMr: 'नायट्रोजन कमी — युरिया नियोजन करा',
            suggestedActivityName: 'Urea application',
            suggestedOffsetDays: 3,
            createdAtUtc: '2026-10-25T05:59:58.123Z', // the server's, not this phone's 06:00
        }]);
        expect(screen.getByTestId('record-recs-where')).toBeInTheDocument();
        expect(screen.queryByTestId('record-recs-not-kept')).toBeNull();
    });

    it('a row that cannot be stored is logged with its context, and the panel does not point at a page that will not have it', async () => {
        server.report.mockImplementation(async () => ({ status: 200, body: { testInstanceId: 't-coll', status: 'Reported', recommendations: [SERVER_REC] } }));
        const refused = new Error('QuotaExceededError');
        vi.spyOn(recTable, 'bulkPut').mockRejectedValueOnce(refused);
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-coll'));
        await fillResultSheet();
        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        await screen.findByTestId('record-success');

        expect(logged).toHaveBeenCalledWith(
            expect.stringContaining('suggestions could not be kept on this phone'),
            { testInstanceId: 't-coll', recommendationIds: [SERVER_REC.recommendationId], error: refused },
        );
        expect(screen.getByTestId('record-recs-not-kept')).toHaveTextContent('हे सल्ले या फोनवर ठेवता आले नाहीत');
        expect(screen.queryByTestId('record-recs-where')).toBeNull();
    });
});

describe('B002 — a refresh time only when the server answered', () => {
    it('no crop cycle on the phone: nothing is asked, no time, and the page says why', async () => {
        await openPage();
        expect(await screen.findByTestId('tests-refresh-no-cycles')).toHaveTextContent('या फोनवर अजून या शेतातल्या पिकांची माहिती आलेली नाही');
        expect(screen.queryByTestId('tests-refreshed')).toBeNull();
        expect(fakeFetch).not.toHaveBeenCalled();
    });

    it('every cycle answered: the time, and no "older copy" line', async () => {
        store.cycles = [{ id: 'cycle-1' }, { id: 'cycle-2' }];
        await openPage();
        expect(await screen.findByTestId('tests-refreshed')).toHaveTextContent('माहिती ताजी केली: सकाळी 11:30');
        expect(screen.queryByTestId(/^tests-refresh-(partial|failed|no-cycles)$/)).toBeNull();
        expect(server.queue.mock.calls.map(c => c[0]).sort()).toEqual(['cycle-1', 'cycle-2']);
    });

    it('some cycles failed: the time AND a line that some plots are this phone\'s older copy', async () => {
        store.cycles = [{ id: 'cycle-1' }, { id: 'cycle-2' }];
        server.queue.mockImplementation(async (cycleId: string) => (cycleId === 'cycle-2' ? { status: 500 } : { status: 200, body: [] }));
        await openPage();
        expect(await screen.findByTestId('tests-refresh-partial')).toHaveTextContent('काही प्लॉटची माहिती आणता आली नाही — त्यांची या फोनवरची जुनी माहिती दाखवत आहोत.');
        expect(screen.getByTestId('tests-refreshed')).toHaveTextContent('माहिती ताजी केली: सकाळी 11:30');
    });

    it('every cycle failed: no time, and the page says it shows this phone\'s copy', async () => {
        store.cycles = [{ id: 'cycle-1' }];
        server.queue.mockImplementation(async () => ({ status: 500 }));
        await openPage();
        expect(await screen.findByTestId('tests-refresh-failed')).toHaveTextContent('या फोनवर साठवलेली दाखवत आहोत');
        expect(screen.queryByTestId('tests-refreshed')).toBeNull();
    });

    it('"no tests" only when the server said so: an empty phone that could not ask says it is the phone that is empty', async () => {
        store.rows = [];
        await openPage();
        expect(await screen.findByTestId('tests-empty-phone')).toHaveTextContent('या फोनवर एकही चाचणी नाही.');
        expect(screen.queryByText('आज कोणत्याही चाचण्या नाहीत')).toBeNull();
    });
});

describe('B003 — each failure in its own Marathi line', () => {
    const tryCollect = async (reply: Reply) => {
        server.collect.mockImplementation(async () => reply);
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-due'));
        await act(async () => { fireEvent.click(screen.getByTestId('collect-confirm')); });
        return screen.findByTestId('collect-error');
    };

    it('403 (an empty Forbid) → no permission', async () => {
        expect(await tryCollect({ status: 403 })).toHaveTextContent('ही नोंद करायची परवानगी तुम्हाला नाही.');
        expect(latinLeftovers()).toEqual([]);
    });

    it('400 TestInvalidState → already moved on; closing the sheet really refreshes the list', async () => {
        store.cycles = [{ id: 'cycle-1' }];
        expect(await tryCollect({ status: 400, body: { error: 'ShramSafal.TestInvalidState', message: 'Test instance is not in a valid state for this action.' } }))
            .toHaveTextContent('ही चाचणी आधीच पुढच्या टप्प्यावर गेली आहे. हे बंद करा — यादी ताजी होईल.');
        await screen.findByTestId('tests-refreshed'); // the opening refresh has finished
        const asked = server.queue.mock.calls.length;
        await act(async () => { fireEvent.click(screen.getByTestId('collect-cancel')); });
        await waitFor(() => expect(server.queue.mock.calls.length).toBe(asked + 1));
    });

    it('anything else → try again (a 500, or a 400 that is not one of the known codes)', async () => {
        expect(await tryCollect({ status: 500 })).toHaveTextContent('नोंद झाली नाही. पुन्हा प्रयत्न करा.');
        cleanup();
        expect(await tryCollect({ status: 400, body: { error: 'ShramSafal.InvalidCommand' } })).toHaveTextContent('नोंद झाली नाही. पुन्हा प्रयत्न करा.');
    });

    it('a result: 400 TestAttachmentInvalid → the report has not reached the server yet; 403 → no permission', async () => {
        server.report.mockImplementation(async () => ({ status: 400, body: { error: 'ShramSafal.TestAttachmentInvalid' } }));
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-coll'));
        await fillResultSheet();
        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        expect(await screen.findByTestId('record-error')).toHaveTextContent('रिपोर्टची फाइल अजून सर्व्हरवर पोचलेली नाही. थोड्या वेळाने पुन्हा जतन करा.');
        expect(screen.getByTestId('record-save')).toBeEnabled(); // it can be tried again

        server.report.mockImplementation(async () => ({ status: 403 }));
        await act(async () => { fireEvent.click(screen.getByTestId('record-save')); });
        await waitFor(() => expect(screen.getByTestId('record-error')).toHaveTextContent('ही नोंद करायची परवानगी तुम्हाला नाही.'));
    });
});

describe('B004 — one tap, one /collect', () => {
    it('"हो, घेतला" stays off until the page has taken the answer; a second tap sends nothing', async () => {
        server.collect.mockImplementation(async (id: string) => ({ status: 200, body: apiInstance(id, 'Collected') }));
        let release!: () => void;
        putGate = new Promise<void>(r => { release = r; });
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-due'));

        await act(async () => { fireEvent.click(screen.getByTestId('collect-confirm')); });
        // /collect has answered; the page is still saving that answer on the phone.
        await waitFor(() => expect(db.testInstances.put).toHaveBeenCalledTimes(1));
        expect(collectCalls()).toBe(1);
        expect(screen.getByTestId('collect-confirm')).toBeDisabled();
        await act(async () => { fireEvent.click(screen.getByTestId('collect-confirm')); });
        expect(collectCalls()).toBe(1);

        await act(async () => { release(); });
        await waitFor(() => expect(screen.queryByTestId('collect-sheet')).toBeNull());
        expect(collectCalls()).toBe(1);
    });

    it('two taps in one go also send one', async () => {
        server.collect.mockImplementation(async (id: string) => ({ status: 200, body: apiInstance(id, 'Collected') }));
        await openPage();
        fireEvent.click(screen.getByTestId('test-action-t-due'));
        await act(async () => {
            const button = screen.getByTestId('collect-confirm');
            fireEvent.click(button);
            fireEvent.click(button);
        });
        await waitFor(() => expect(screen.queryByTestId('collect-sheet')).toBeNull());
        expect(collectCalls()).toBe(1);
    });
});

describe('?action= — opens once, only the named test, only when it fits', () => {
    it('opens the named test once — closing it keeps it closed', async () => {
        window.history.replaceState({}, '', '/tests?action=collect&instanceId=t-due');
        await openPage();
        expect(await screen.findByTestId('collect-sheet')).toHaveTextContent('पाण्याची तपासणी');
        fireEvent.click(screen.getByTestId('collect-cancel'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByTestId('collect-sheet')).toBeNull();
    });

    it('a named test that is not on the phone opens NOTHING (not another test) and says so', async () => {
        window.history.replaceState({}, '', '/tests?action=collect&instanceId=t-not-here');
        await openPage();
        expect(await screen.findByTestId('tests-action-note')).toHaveTextContent('उघडायला सांगितलेली चाचणी या फोनवर सापडली नाही.');
        expect(screen.queryByTestId('collect-sheet')).toBeNull();
        expect(collectCalls()).toBe(0);
    });

    it('waits for the server before saying "not found": a test the refresh brings is opened', async () => {
        store.cycles = [{ id: 'cycle-1' }];
        server.queue.mockImplementation(async () => ({ status: 200, body: [apiInstance('t-new', 'Due')] }));
        window.history.replaceState({}, '', '/tests?action=collect&instanceId=t-new');
        await openPage();
        expect(await screen.findByTestId('collect-sheet')).toBeInTheDocument();
        expect(screen.queryByTestId('tests-action-note')).toBeNull();
    });

    it('a named test whose state no longer fits the action is not opened', async () => {
        window.history.replaceState({}, '', '/tests?action=collect&instanceId=t-coll');
        await openPage();
        expect(await screen.findByTestId('tests-action-note')).toHaveTextContent('आधीच पुढच्या टप्प्यावर गेली आहे');
        expect(screen.queryByTestId('collect-sheet')).toBeNull();
    });
});

describe('चाचण्या — no button without a handler (P5)', () => {
    it('without onBack / onTell: no मागे, no सांगा', async () => {
        await openPage();
        expect(screen.queryByTestId('page-back')).toBeNull();
        expect(screen.queryByTestId('test-tell')).toBeNull();
        expect(screen.queryByTestId('test-tell-note')).toBeNull();
    });

    it('with them: both drawn, and each calls its handler', async () => {
        const onBack = vi.fn();
        const onTell = vi.fn();
        await openPage({ onBack, onTell });
        fireEvent.click(screen.getByTestId('page-back'));
        fireEvent.click(screen.getByTestId('test-tell'));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onTell).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('test-tell')).toHaveTextContent('नमुना घेतला / निकाल आला — सांगा');
        expect(screen.getByTestId('test-tell-note')).toHaveTextContent('इथली चाचणी आपोआप बदलत नाही');
    });

    it('"+ New protocol" did nothing: it is a plain लवकरच line, and only for Agronomist / Consultant', async () => {
        await openPage();
        expect(screen.queryByTestId('soon')).toBeNull();
        cleanup();

        farm.role = 'Consultant';
        await openPage();
        expect(screen.getByTestId('soon')).toHaveTextContent('नवीन चाचणी-पद्धत बनवणे — लवकरच.');
        expect(screen.queryByRole('button', { name: /protocol|नवीन/i })).toBeNull();
    });
});
