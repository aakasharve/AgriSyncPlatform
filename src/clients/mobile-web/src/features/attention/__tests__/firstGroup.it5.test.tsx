// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1; founders D-92, D-96; P4, P7, P9) - the "आधी हे पाहा" group on
 * लक्ष द्या: a wrong mix in one tank, above everything else, with what to do and a पाहिलं that queues the acknowledgement.
 *
 * The red path needs a REVIEWED rule, and none exists in production (D-96), so the advice is proven with a test-only reviewed rule
 * handed to the card. The default (no reviewed rule) is proven too: no advice is invented.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedTask } from '../../../types';

const board = vi.hoisted(() => ({ cards: [] as unknown[], meta: {} as Record<string, unknown> }));
const enqueue = vi.hoisted(() => vi.fn());

vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => ({ tableName: 'shramsafal', lastSyncAt: '2026-11-09T03:30:00.000Z', version: 1 }) },
        appMeta: { get: async (key: string) => (key in board.meta ? { key, value: board.meta[key] } : undefined) },
    }),
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({ mutationQueue: { enqueue: (...args: unknown[]) => enqueue(...args), enqueueRepeatable: (...args: unknown[]) => enqueue(...args) } }));
// lane IT5 fix 1 (F2): "पाहिलं" is drawn for a seat that holds ConfirmRecords (the server refuses everyone else)
vi.mock('../../../core/session/FarmContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: 'f1', currentFarm: { role: 'CoOwner', authorities: [{ name: 'ConfirmRecords' }] } }),
}));

import AttentionPage from '../pages/AttentionPage';
import MixAlertCard from '../components/MixAlertCard';
import { AttentionStrip } from '../components/AttentionStrip';
import { useAttentionModel } from '../hooks/useAttentionModel';
import { attentionSummaryEn, attentionSummaryMr, buildAttentionModel, INPUT_MIX_RULE_CODE, mostUrgentLineMr } from '../attentionItems';
import { mixAdviceOf } from '../mixAdvice';
import { acknowledgeRequestId } from '../data/acknowledgeMixAlert';
import { clearSeenSignalsForTests } from '../seenSignals';
import { clearRescheduledForTests } from '../scheduledWork';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { MixRule } from '../../../domain/inputs/mixVerdict';
import { mutationLabel } from '../../sync/components/syncDrawerWords';

const TODAY = '2026-11-09';
const SIGNAL = '6f1d8f2e-4c1a-4a52-9d0e-1b2c3d4e5f60';

/** A TEST-ONLY reviewed rule (the real ones are unreviewed, D-96). */
const REVIEWED_RULE: MixRule = {
    id: 'T-R1',
    verdict: 'never',
    a: { tag: 'calcium-source' },
    b: { tag: 'phosphate-source' },
    appliesTo: ['fertigation', 'spray'],
    why: { mr: 'दोघं मिळून घट्ट साका बनतो.', en: 'Together they form a hard deposit.' },
    nowDo: { mr: 'टाकी आणि फिल्टरमध्ये साका दिसतो का ते पाहा.', en: 'Check the tank and filter for a deposit.' },
    nextTime: { mr: 'पुढच्या वेळी वेगळ्या टाकीतून द्या.', en: 'Next time use a separate tank.' },
    sources: [{ title: 'Test source title', publisher: 'Test publisher', url: 'https://example.test/source', retrievedOn: '2026-11-06' }],
    reviewedBy: 'Test Agronomist',
    reviewedOn: '2026-11-08',
};

const card = (id: string, extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => ({
    cardId: id, farmId: 'f1', farmName: 'आर्वे शेत', plotId: `plot-${id}`, plotName: 'प्लॉट १', rank: 0, computedAtUtc: '2026-11-09T03:30:00.000Z',
    titleEn: 'x', titleMr: `शीर्षक ${id}`, descriptionEn: 'x', descriptionMr: 'x', suggestedAction: 0, suggestedActionLabelEn: 'x', suggestedActionLabelMr: 'तुकडा पहा', ...extra,
});
const mixCard = (id = 'mix', extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => card(id, {
    titleMr: 'हे मिश्रण चुकीचं आहे',
    descriptionMr: `${REVIEWED_RULE.why.mr} ${REVIEWED_RULE.nextTime.mr} स्रोत: Test source title`,
    topSignalId: SIGNAL, topSignalRuleCode: INPUT_MIX_RULE_CODE, ...extra,
});
const task = (id: string, title: string, dueDate: string): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-11-01T05:00:00.000Z', dueDate,
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T06:00:00.000Z'));
    board.cards = [];
    board.meta = {};
    enqueue.mockReset();
    enqueue.mockResolvedValue('ok');
    clearSeenSignalsForTests();
    clearRescheduledForTests();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('लक्ष द्या - "आधी हे पाहा" (IT5 Task 1)', () => {
    it('MixCard_InFirstGroup_AboveLate: a wrong-mix card is in its own group, drawn before the late work', async () => {
        board.cards = [mixCard(), card('test')];
        render(<AttentionPage onGo={vi.fn()} tasks={[task('r-late', 'पंप दुरुस्ती', '2026-11-05')]} crops={[]} onUpdateTask={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-group-first')).toBeInTheDocument());

        const first = screen.getByTestId('attention-group-first');
        expect(first).toHaveTextContent('आधी हे पाहा (1)');
        expect(within(first).getByTestId('attention-card-mix')).toBeInTheDocument();
        expect(within(first).getByTestId('attention-first-badge')).toHaveTextContent('चुकीचं मिश्रण');
        // the other card is NOT in the first group, and the group sits above the late group in the page
        expect(within(first).queryByTestId('attention-card-test')).toBeNull();
        const groups = Array.from(document.querySelectorAll('[data-testid^="attention-group-"]')).map(e => e.getAttribute('data-testid'));
        expect(groups.indexOf('attention-group-first')).toBeGreaterThanOrEqual(0);
        expect(groups.indexOf('attention-group-first')).toBeLessThan(groups.indexOf('attention-group-late'));
        expect(groups.indexOf('attention-group-late')).toBeLessThan(groups.indexOf('attention-group-decide'));
        // and it is on the page once, not also under "निर्णय घ्यायचा"
        expect(screen.getAllByTestId('attention-card-mix')).toHaveLength(1);
        expect(screen.getByTestId('attention-card-test')).toBeInTheDocument();
    });

    it('WhatToDo_ExpandsNowDoAndNextTime: "काय करायचं" opens what to do now, next time and the source; the record stays as said', () => {
        render(<MixAlertCard card={mixCard()} rules={[REVIEWED_RULE]} />);
        expect(screen.queryByTestId('attention-first-advice-mix')).toBeNull();
        // the card body says why; the rest waits behind the button
        expect(screen.getByTestId('attention-first-why-mix')).toHaveTextContent(REVIEWED_RULE.why.mr);
        expect(screen.getByTestId('attention-first-why-mix')).not.toHaveTextContent('पुढच्या वेळी');

        fireEvent.click(screen.getByTestId('attention-first-what-mix'));
        const advice = screen.getByTestId('attention-first-advice-mix');
        expect(advice).toHaveTextContent('आता काय करायचं');
        expect(within(advice).getByTestId('attention-first-now')).toHaveTextContent(REVIEWED_RULE.nowDo.mr);
        expect(within(advice).getByTestId('attention-first-next')).toHaveTextContent(REVIEWED_RULE.nextTime.mr);
        expect(within(advice).getByTestId('attention-first-source')).toHaveTextContent('स्रोत: Test source title');
        expect(within(advice).getByTestId('attention-first-source')).toHaveTextContent('नोंद सांगितली तशीच राहील');

        fireEvent.click(screen.getByTestId('attention-first-what-mix'));
        expect(screen.queryByTestId('attention-first-advice-mix')).toBeNull();
    });

    it('with no reviewed rule for the card (production today, D-96) no advice is made up: the server\'s words stay and there is no "काय करायचं"', async () => {
        board.cards = [mixCard()];
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-card-mix')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-first-what-mix')).toBeNull();
        expect(screen.getByTestId('attention-first-why-mix')).toHaveTextContent(REVIEWED_RULE.nextTime.mr); // the server's full words
        expect(screen.getByTestId('attention-first-seen-mix')).toHaveTextContent('पाहिलं'); // seeing it is still possible (P9)
        expect(mixAdviceOf(mixCard().descriptionMr, [{ ...REVIEWED_RULE, reviewedBy: null }])).toBeNull(); // an unreviewed rule never advises
        expect(mixAdviceOf(mixCard().descriptionMr, [REVIEWED_RULE])?.sourceTitle).toBe('Test source title');
    });

    it('Seen_QueuesComplianceAcknowledge_WithTopSignalId_AndLeavesList: पाहिलं queues the acknowledgement of THAT signal and the card leaves every surface', async () => {
        board.cards = [mixCard(), card('test')];
        // the page, the आढावा strip and the bottom-bar count are three views of ONE list
        const BottomTotal: React.FC = () => <span data-testid="bottom-total">{useAttentionModel([], []).total}</span>;
        render(<><AttentionPage onGo={vi.fn()} /><AttentionStrip tasks={[]} crops={[]} onOpen={vi.fn()} /><BottomTotal /></>);
        await waitFor(() => expect(screen.getByTestId('attention-first-seen-mix')).toBeInTheDocument());
        expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('2');
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('2');

        fireEvent.click(screen.getByTestId('attention-first-seen-mix'));
        await waitFor(() => expect(screen.queryByTestId('attention-card-mix')).toBeNull());
        await waitFor(() => expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('1'));
        expect(screen.getByTestId('bottom-total')).toHaveTextContent('1');
        expect(screen.getByTestId('attention-strip-first')).not.toHaveTextContent('हे मिश्रण चुकीचं आहे');

        expect(enqueue).toHaveBeenCalledTimes(1);
        const [kind, payload, options] = enqueue.mock.calls[0] as [string, unknown, { clientRequestId: string }];
        expect(kind).toBe(SyncMutationName.ComplianceAcknowledge);
        expect(payload).toEqual({ signalId: SIGNAL }); // nothing about the record, the products or the dose (P7)
        expect(options.clientRequestId).toBe(acknowledgeRequestId(SIGNAL)); // the same tap again is the same request
        expect(validatePayload(SyncMutationName.ComplianceAcknowledge, payload)).toEqual({ ok: true });
        // the group is gone with its last card, and the other card is untouched
        expect(screen.queryByTestId('attention-group-first')).toBeNull();
        expect(screen.getByTestId('attention-card-test')).toBeInTheDocument();
    });

    it('a पाहिलं that could not be queued keeps the card and says so', async () => {
        enqueue.mockRejectedValue(new Error('disk full'));
        board.cards = [mixCard()];
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-first-seen-mix')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attention-first-seen-mix'));
        await waitFor(() => expect(screen.getByTestId('attention-first-seen-failed')).toBeInTheDocument());
        expect(screen.getByTestId('attention-card-mix')).toBeInTheDocument();
    });

    it('a board the server answered AFTER the tap that still lists the signal is the server\'s word: the card is back', async () => {
        board.cards = [mixCard('mix', { computedAtUtc: '2026-11-09T05:00:00.000Z' })];
        const model = (seen: Map<string, number>) => buildAttentionModel({
            cards: board.cards as AttentionCardCacheRecord[], scheduledWork: null, todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY, seenSignals: seen,
        });
        expect(model(new Map([[SIGNAL, Date.parse('2026-11-09T05:30:00.000Z')]])).first).toHaveLength(0); // the board is older than the tap
        expect(model(new Map([[SIGNAL, Date.parse('2026-11-09T04:30:00.000Z')]])).first).toHaveLength(1); // the board is newer than the tap
    });

    it('BottomBarCount_IncludesFirstGroup: the count the bottom bar and the strip show counts the wrong-mix cards too', async () => {
        const input = {
            cards: [mixCard(), mixCard('mix2', { topSignalId: '7a2e9a3f-5d2b-4b63-8e1f-2c3d4e5f6a71' }), card('test')],
            scheduledWork: null, todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY,
        };
        const model = buildAttentionModel(input);
        expect(model.first.map(i => i.id)).toEqual(['card-mix', 'card-mix2']);
        expect(model.total).toBe(3); // 2 first + 1 decide: exactly the items on the page
        expect(model.total).toBe(model.first.length + model.late.length + model.today.length + model.decide.length);
        expect(attentionSummaryMr(model.counts)).toBe('२ चुकीची मिश्रणं · १ निर्णय बाकी');
        expect(attentionSummaryEn(model.counts)).toBe('2 wrong mixes · 1 decision pending');
        expect(mostUrgentLineMr(model)).toBe('हे मिश्रण चुकीचं आहे'); // the strip leads with the wrong mix

        board.cards = input.cards;
        render(<AttentionStrip tasks={[]} crops={[]} onOpen={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('3'));
    });

    it('Seen_QueuesComplianceAcknowledge_WithTopSignalId_AndLeavesList (queue words): the queued acknowledge has a name in the sync sheet in both languages, not the bare wire name', () => {
        expect(mutationLabel(SyncMutationName.ComplianceAcknowledge, 'mr')).toBe('चुकीच्या मिश्रणाचं पाहिलं');
        expect(mutationLabel(SyncMutationName.ComplianceAcknowledge, 'en')).toBe('Wrong-mix alert seen');
        expect(mutationLabel(SyncMutationName.ComplianceAcknowledge, 'en')).not.toBe(SyncMutationName.ComplianceAcknowledge);
    });

    it('CardWithoutTopSignal_StaysInDecide: a card with no rule code (an older server) or another rule code is not a wrong-mix card', () => {
        const model = buildAttentionModel({
            cards: [card('old'), card('other', { topSignalId: SIGNAL, topSignalRuleCode: 'compliance.stage-health.critical' }), card('nullcode', { topSignalRuleCode: null })],
            scheduledWork: null, todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY,
        });
        expect(model.first).toHaveLength(0);
        expect(model.decide.map(i => i.id).sort()).toEqual(['card-nullcode', 'card-old', 'card-other']);
        expect(model.counts.firstAlerts).toBe(0);
        expect(attentionSummaryMr(model.counts)).toBe('३ निर्णय बाकी');
    });
});
