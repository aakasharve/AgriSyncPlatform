// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - लक्ष द्या (IT5) shows every number in
 * Devanagari digits (the page is Marathi only): the four group headers with their counts, the strip's count line and its badge,
 * the step rows' "N दिवस उशीर", and the wrong-mix card's numbered advice. The whole page and the strip are rendered with data that
 * makes every one of those numbers appear, and the scan fails on any Latin digit.
 *
 * Fix round (review M1): the page is rendered as the farm's PRIMARY account holder too, with people waiting to join, work the server kept
 * for him and a late reminder, so the cards only he sees are scanned. The earlier named exceptions (reminder due text, the board's
 * plot card "N कामं बाकी", the "... पर्यंतची माहिती" stamp) are fixed and gone.
 *
 * What the scan lets through, named: the masked phone suffix ("...4321") on a join request is an identifier that the team page's
 * own card prints (shared card, other screen); the cited English source title. Names as stored (plot, farm, person) carry no digit here.
 * The bottom-bar badge is chrome outside the page and is not rendered here.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedTask } from '../../../types';
import { latinDigitFindings } from '../../../shared/test/latinDigits';

const board = vi.hoisted(() => ({ cards: [] as unknown[], meta: {} as Record<string, unknown> }));
const seat = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const fetchLabourPermissions = vi.hoisted(() => vi.fn());
const fetchKeptWork = vi.hoisted(() => vi.fn());
const listInvitations = vi.hoisted(() => vi.fn());

vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => ({ tableName: 'shramsafal', lastSyncAt: '2026-11-09T03:30:00.000Z', version: 1 }) },
        appMeta: { get: async (key: string) => (key in board.meta ? { key, value: board.meta[key] } : undefined) },
    }),
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({ mutationQueue: { enqueue: vi.fn(async () => 'ok'), enqueueRepeatable: vi.fn(async () => 'ok') } }));
vi.mock('../../../core/session/FarmContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: 'f1', currentFarm: seat.current }),
}));
vi.mock('../../profile/data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../profile/data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
}));
vi.mock('../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../invitations/personalInvitationClient')>()),
    listInvitations: (...a: unknown[]) => listInvitations(...a),
}));
vi.mock('../../relationships/keptWorkClient', () => ({ fetchKeptWork: (...a: unknown[]) => fetchKeptWork(...a) }));

import AttentionPage from '../pages/AttentionPage';
import MixAlertCard from '../components/MixAlertCard';
import { AttentionStrip } from '../components/AttentionStrip';
import { attentionSummaryMr, buildAttentionModel, INPUT_MIX_RULE_CODE } from '../attentionItems';
import { SCHEDULED_WORK_META_KEY, clearRescheduledForTests, stepDueTextMr } from '../scheduledWork';
import { clearSeenSignalsForTests } from '../seenSignals';
import type { MixRule } from '../../../domain/inputs/mixVerdict';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const SIGNAL = '6f1d8f2e-4c1a-4a52-9d0e-1b2c3d4e5f60';

/** A TEST-ONLY reviewed rule (the real ones are unreviewed, D-96); its advice has no digit of its own. */
const REVIEWED_RULE: MixRule = {
    id: 'T-R1', verdict: 'never', a: { tag: 'calcium-source' }, b: { tag: 'phosphate-source' }, appliesTo: ['fertigation', 'spray'],
    why: { mr: 'दोघं मिळून घट्ट साका बनतो.', en: 'Together they form a hard deposit.' },
    nowDo: { mr: 'टाकी आणि फिल्टरमध्ये साका दिसतो का ते पाहा.', en: 'Check the tank and filter for a deposit.' },
    nextTime: { mr: 'पुढच्या वेळी वेगळ्या टाकीतून द्या.', en: 'Next time use a separate tank.' },
    sources: [{ title: 'Test source title', publisher: 'Test publisher', url: 'https://example.test/source', retrievedOn: '2026-11-06' }],
    reviewedBy: 'Test Agronomist', reviewedOn: '2026-11-08',
};

const card = (id: string, extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => ({
    cardId: id, farmId: 'f1', farmName: 'आर्वे शेत', plotId: `plot-${id}`, plotName: 'प्लॉट', rank: 0, computedAtUtc: '2026-11-09T03:30:00.000Z',
    titleEn: 'x', titleMr: `शीर्षक ${id}`, descriptionEn: 'x', descriptionMr: 'x', suggestedAction: 0, suggestedActionLabelEn: 'x', suggestedActionLabelMr: 'तुकडा पहा', ...extra,
});
const mixCard = (id: string, signal: string): AttentionCardCacheRecord => card(id, {
    titleMr: 'हे मिश्रण चुकीचं आहे',
    descriptionMr: `${REVIEWED_RULE.why.mr} ${REVIEWED_RULE.nextTime.mr} स्रोत: Test source title`,
    topSignalId: signal, topSignalRuleCode: INPUT_MIX_RULE_CODE,
});
const reminder = (id: string, title: string, dueDate: string): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-11-01T05:00:00.000Z', dueDate,
});
const step = (id: string, activityName: string, daysLate: number, isMissed = false) => ({
    plannedActivityId: id, farmId: 'f1', plotId: 'p1', plotName: 'प्लॉट', cropCycleId: 'cc1', activityName, stage: 'Flowering',
    plannedDate: '2026-11-01', daysLate, isMissed,
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T06:00:00.000Z'));
    board.cards = [mixCard('mix', SIGNAL), mixCard('mix2', '7a2e9a3f-5d2b-4b63-8e1f-2c3d4e5f6a71'), card('decide', { overdueTaskCount: 3, suggestedAction: 2 })];
    board.meta = {
        [SCHEDULED_WORK_META_KEY]: {
            asOfUtc: '2026-11-09T03:30:00.000Z',
            items: [step('s-late5', 'Foliar Spray', 5), step('s-late1', 'Drip Irrigation', 1), step('s-today', 'Pruning', 0), step('s-missed', 'Fertigation', 12, true)],
        },
    };
    clearSeenSignalsForTests();
    clearRescheduledForTests();
    // The farm's PRIMARY account holder: the cards only he sees (people waiting to join, work the server kept) are drawn too.
    seat.current = { farmId: 'f1', role: 'PrimaryOwner', authorities: [{ name: 'ConfirmRecords' }] };
    const person = (over: Record<string, unknown>) => ({
        userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted',
        isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], ...over,
    });
    fetchLabourPermissions.mockReset().mockResolvedValue([
        person({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true }),
        person({ userId: 'sunil', status: 'PendingApproval', displayName: 'सुनील', joinedVia: 'SelfJoin', phoneLast4: '4321' }),
        person({ userId: 'ramesh', status: 'PendingApproval', displayName: 'रमेश', joinedVia: 'SelfJoin', phoneLast4: '8765' }),
    ]);
    listInvitations.mockReset().mockResolvedValue([]);
    fetchKeptWork.mockReset().mockResolvedValue([
        { id: 'k1', kind: 'refused', what: SyncMutationName.AddCostEntry, why: 'ShramSafal.Forbidden', whoUserId: 'g', whoName: 'गोपाळ', atUtc: '2026-11-05T09:00:00Z', authorityEndedAtUtc: null },
        { id: 'k2', kind: 'arrived_late', what: 'AttendanceMark', why: 'TakeAttendance', whoUserId: 'g', whoName: 'गोपाळ', atUtc: '2026-11-06T09:00:00Z', authorityEndedAtUtc: '2026-11-05T10:00:00Z' },
        { id: 'k3', kind: 'cap_reached', what: 'RefusedSyncMutation', why: null, whoUserId: 'g', whoName: null, atUtc: '2026-11-06T10:00:00Z', authorityEndedAtUtc: null },
    ]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const TASKS = [reminder('r-late', 'पंप दुरुस्ती', '2026-11-05'), reminder('r-today', 'खत आणणे', '2026-11-09')];

/** The masked phone suffix a join request prints (an identifier, printed by the team page's shared card) - see the header. */
const PHONE_SUFFIX = ['4321', '8765'];

describe('IT-D2 - लक्ष द्या shows no Latin digit (Marathi only)', () => {
    it('the page: four group headers with counts, step rows, the wrong-mix cards with their advice open', async () => {
        render(<AttentionPage onGo={vi.fn()} tasks={TASKS} crops={[]} onUpdateTask={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-group-first')).toBeInTheDocument());
        await screen.findByTestId('attention-requests');
        await screen.findByTestId('kept-work');
        for (const id of ['first', 'late', 'today', 'decide']) expect(screen.getByTestId(`attention-group-${id}`)).toBeInTheDocument();
        // The numbers really are on the page: each header's count and a step's days late. (The advice opens only with a reviewed rule, none today: its own test below.)
        expect(screen.getByTestId('attention-group-first')).toHaveTextContent('आधी हे पाहा (२)');
        expect(screen.getByTestId('attention-group-late')).toHaveTextContent('वेळ निघून गेली (३)');
        expect(screen.getByTestId('attention-group-today')).toHaveTextContent('आज करायचे (२)');
        expect(screen.getByTestId('attention-group-decide')).toHaveTextContent('निर्णय घ्यायचा (२)');
        expect(screen.getByTestId('attention-step-s-late5')).toHaveTextContent('५ दिवस उशीर');
        expect(screen.getByTestId('attention-step-s-missed')).toHaveTextContent('१२ दिवस उशीर');
        // The primary holder's cards, the reminders, the board's plot card and the "as of" stamp are on the page and in the scan.
        expect(screen.getByTestId('attention-requests')).toHaveTextContent('२ जण आत येऊ इच्छितात');
        expect(screen.getByTestId('kept-work')).toHaveTextContent('तुमच्यासाठी ठेवलेलं काम (३)');
        expect(screen.getByTestId('attention-reminder-r-late')).toHaveTextContent('४ दिवस उशीर');
        expect(screen.getByTestId('attention-card-decide')).toHaveTextContent('३ कामं बाकी');
        expect(screen.getByTestId('attention-as-of').textContent).toMatch(/[०-९]/);
        expect(screen.getByTestId('attention-page').querySelectorAll('[data-testid^="attention-reminder-"]').length).toBe(2);
        expect(latinDigitFindings(screen.getByTestId('attention-page'), ['Test source title', ...PHONE_SUFFIX])).toEqual([]);
    });

    it('the strip: the count line and the total badge', async () => {
        render(<AttentionStrip tasks={TASKS} crops={[]} onOpen={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-strip-total')).toBeInTheDocument());
        expect(screen.getByTestId('attention-strip-summary')).toHaveTextContent('२ चुकीची मिश्रणं · २ कामे उशिराची · १ आठवण उशिराची · १ काम आज · १ आठवण आज · २ निर्णय बाकी');
        expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('९');
        expect(latinDigitFindings(screen.getByTestId('attention-strip'))).toEqual([]);
    });

    it('the strip when a late reminder is the most urgent item: its first line names the days in Devanagari digits', async () => {
        board.cards = [];
        board.meta = {};
        render(<AttentionStrip tasks={TASKS} crops={[]} onOpen={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-strip-first')).toBeInTheDocument());
        expect(screen.getByTestId('attention-strip-first')).toHaveTextContent('पंप दुरुस्ती — ४ दिवस उशीर');
        expect(latinDigitFindings(screen.getByTestId('attention-strip'))).toEqual([]);
    });

    it('the due words of a step, for every day count the board can hold', () => {
        for (const days of [0, 1, 2, 5, 9, 10, 31, 120]) expect(stepDueTextMr(days), String(days)).not.toMatch(/[0-9]/);
        expect(stepDueTextMr(0)).toBe('आज');
        expect(stepDueTextMr(1)).toBe('काल');
        expect(stepDueTextMr(120)).toBe('१२० दिवस उशीर');
    });

    it('the model carries the Devanagari words too (the strip reads them from here, not the page)', () => {
        const model = buildAttentionModel({
            cards: board.cards as AttentionCardCacheRecord[], scheduledWork: { items: (board.meta[SCHEDULED_WORK_META_KEY] as { items: never[] }).items, asOfUtc: '' },
            todos: { late: [], today: [] }, farmId: 'f1', todayKey: '2026-11-09',
        });
        expect(attentionSummaryMr(model.counts)).not.toMatch(/[0-9]/);
        for (const item of [...model.late, ...model.decide]) if (item.kind === 'step') expect(item.dueText).not.toMatch(/[0-9]/);
    });

    it('the wrong-mix card on its own, advice open', () => {
        render(<MixAlertCard card={mixCard('mix', SIGNAL)} rules={[REVIEWED_RULE]} />);
        fireEvent.click(screen.getByTestId('attention-first-what-mix'));
        expect(screen.getByTestId('attention-first-now')).toHaveTextContent('१. ');
        expect(screen.getByTestId('attention-first-next')).toHaveTextContent('२. ');
        expect(latinDigitFindings(screen.getByTestId('attention-card-mix'), ['Test source title'])).toEqual([]);
    });
});

describe('IT-D2 - display only: the board and the to-do tasks are never touched by the page', () => {
    it('rendering the page leaves the cards, the stored step list and the tasks exactly as they were', async () => {
        const before = structuredClone({ cards: board.cards, meta: board.meta, tasks: TASKS });
        render(<AttentionPage onGo={vi.fn()} tasks={TASKS} crops={[]} onUpdateTask={vi.fn()} />);
        await screen.findByTestId('kept-work');
        expect({ cards: board.cards, meta: board.meta, tasks: TASKS }).toEqual(before);
        expect(TASKS[0].dueDate).toBe('2026-11-05');
    });
});

describe('IT-D2 - the page for a seat that is not the primary holder', () => {
    it('a सहमालक sees no join-request or kept-work card, and the rest of the page is still free of Latin digits', async () => {
        seat.current = { farmId: 'f1', role: 'SecondaryOwner', authorities: [{ name: 'ConfirmRecords' }] };
        render(<AttentionPage onGo={vi.fn()} tasks={TASKS} crops={[]} onUpdateTask={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-group-first')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-requests')).toBeNull();
        expect(screen.queryByTestId('kept-work')).toBeNull();
        expect(latinDigitFindings(screen.getByTestId('attention-page'), ['Test source title'])).toEqual([]);
    });
});
