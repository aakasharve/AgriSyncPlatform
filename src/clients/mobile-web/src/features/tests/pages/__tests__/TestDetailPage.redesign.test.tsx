// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — one test's own page, in the चाचण्या look.
 *
 * What must hold:
 *   - no English left (the fixture's server words — test, stage, parameter codes, the suggestion — are Marathi
 *     here, so ANY Latin letter in the text, a placeholder or an aria-label is a leftover);
 *   - each recorded result says which side of its range it is (ठीक / कमी / जास्त);
 *   - a reported test says the app does not show its numbers and points to the lab report — never "no
 *     results recorded yet", and never "not yet" (nothing will ever bring them to the phone);
 *   - "योजनेत घाला" still calls the real `addRecommendationToPlan`, with the FARM's day (IST) + the offset.
 *     The clock is 20:00 UTC = 01:30 the next morning in IST, so a UTC date would be a day early and fail;
 *   - a refused "योजनेत घाला" says no-permission (403) or try-again, in Marathi (review B003);
 *   - the bar's मागे calls `onBack`; a test that cannot be found says so in Marathi.
 *
 * The phone's database and two client calls are mocked; `TestsApiError` is the client's real class. The
 * shared `AttachmentList` is stubbed: it is not part of this change (its upload-state badge is still
 * English — reported, not fixed here).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const store: { row: Row | undefined; recs: Row[] } = { row: undefined, recs: [] };
const db = {
    testInstances: { get: vi.fn(async () => store.row), put: vi.fn(async () => undefined) },
    testProtocols: { get: vi.fn(async () => undefined) },
    testRecommendations: { where: () => ({ equals: () => ({ toArray: async () => store.recs }) }) },
    plots: { get: vi.fn(async (id: string) => (id === 'plot-1' ? { id, farmId: 'farm-1', payload: { name: 'विहिरीजवळचा' } } : undefined)) },
};
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({ getDatabase: () => db }));

const client = vi.hoisted(() => ({ getTestInstanceById: vi.fn(), addRecommendationToPlan: vi.fn() }));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({ getAuthSession: () => null }));
vi.mock('../../data/testsClient', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../data/testsClient')>()),
    ...client,
}));

vi.mock('../../../attachments/components/AttachmentList', () => ({
    default: ({ linkedEntityId }: { linkedEntityId: string }) => <div data-testid="attachment-list" data-entity={linkedEntityId} />,
}));

import TestDetailPage from '../TestDetailPage';
import { TestsApiError } from '../../data/testsClient';

const REPORTED: Row = {
    id: 't-rep', testProtocolId: 'proto-1', testProtocolName: 'माती परीक्षण', protocolKind: 0,
    cropCycleId: 'cycle-1', farmId: 'farm-1', plotId: 'plot-1', stageName: 'फुलोरा',
    plannedDueDate: '2026-10-20', status: 2, reportedAtUtc: '2026-10-23T05:00:00Z',
    attachmentIds: [], modifiedAtUtc: '2026-10-23T05:00:00Z', createdAtUtc: '2026-10-01T00:00:00Z',
    results: [
        { parameterCode: 'नत्र', parameterValue: '140', unit: 'किलो', referenceRangeLow: 200, referenceRangeHigh: 300 },
        { parameterCode: 'स्फुरद', parameterValue: '250', unit: 'किलो', referenceRangeLow: 200, referenceRangeHigh: 300 },
        { parameterCode: 'पालाश', parameterValue: '400', unit: 'किलो', referenceRangeLow: 200, referenceRangeHigh: 300 },
        { parameterCode: 'सामू', parameterValue: '7.2', unit: '' },
    ],
};
const REC: Row = {
    id: 'rec-1', testInstanceId: 't-rep', ruleCode: 'N_LOW', titleEn: 'Apply urea', titleMr: 'युरिया द्या',
    suggestedActivityName: 'युरिया', suggestedOffsetDays: 3, createdAtUtc: '2026-10-23T05:00:00Z',
};

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

const openPage = async (onBack = vi.fn(), mayPlanWork = true) => {
    render(<TestDetailPage testInstanceId="t-rep" onBack={onBack} mayPlanWork={mayPlanWork} />);
    await act(async () => { await Promise.resolve(); });
    return onBack;
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 20:00 UTC on 25 Oct = 01:30 on 26 Oct in IST: the farm's day is the 26th, UTC's is still the 25th.
    vi.setSystemTime(new Date('2026-10-25T20:00:00Z'));
    store.row = { ...REPORTED };
    store.recs = [{ ...REC }];
    client.getTestInstanceById.mockResolvedValue({ ...REPORTED });
    client.addRecommendationToPlan.mockResolvedValue(undefined);
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('one test — no English left', () => {
    it('header, results, lab report and suggestions are all Marathi', async () => {
        await openPage();
        await screen.findByTestId('test-detail-head');
        expect(screen.getByTestId('page-title')).toHaveTextContent('चाचणी');
        expect(screen.getByTestId('test-detail-head')).toHaveTextContent('माती परीक्षण');
        expect(screen.getByTestId('test-detail-head')).toHaveTextContent('विहिरीजवळचा · फुलोरा');
        expect(screen.getByTestId('test-detail-head')).toHaveTextContent('निकाल आला 23 ऑक्टो');
        expect(screen.getByTestId('attachment-list')).toHaveAttribute('data-entity', 't-rep');
        expect(screen.getByTestId('test-rec-rec-1')).toHaveTextContent('युरिया द्या');
        expect(screen.getByTestId('test-rec-rec-1')).toHaveTextContent('3 दिवसांनी करायचं — 29 ऑक्टो');
        expect(latinLeftovers()).toEqual([]);
    });

    it('a test that cannot be found says so, with मागे', async () => {
        store.row = undefined;
        client.getTestInstanceById.mockRejectedValue(new Error('getTestInstanceById failed (404)'));
        const onBack = await openPage();
        expect(await screen.findByTestId('test-detail-missing')).toHaveTextContent('ही चाचणी सापडली नाही.');
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('one test — results said honestly', () => {
    it('each result says which side of its range it is; no range → no verdict', async () => {
        await openPage();
        const rows = await screen.findAllByTestId('test-result-row');
        expect(rows.map(r => r.textContent)).toEqual([
            'नत्र — 140 किलोयोग्य पातळी 200–300कमी',
            'स्फुरद — 250 किलोयोग्य पातळी 200–300ठीक',
            'पालाश — 400 किलोयोग्य पातळी 200–300जास्त',
            'सामू — 7.2',
        ]);
    });

    it('a reported test with no numbers on the phone says the app does not show them — not "no results yet", not "not yet"', async () => {
        store.row = { ...REPORTED, results: [] };
        client.getTestInstanceById.mockResolvedValue({ ...REPORTED, results: [] });
        await openPage();
        const line = await screen.findByTestId('test-detail-no-results');
        expect(line).toHaveTextContent('निकाल नोंदवला आहे. त्याचे आकडे हे ॲप दाखवत नाही — ते लॅबच्या रिपोर्टमध्ये पाहा.');
        expect(line).not.toHaveTextContent('अजून');
    });

    it('a test still waiting says the result has not come', async () => {
        const due = { ...REPORTED, status: 0, results: [], reportedAtUtc: undefined };
        store.row = due;
        client.getTestInstanceById.mockResolvedValue(due);
        await openPage();
        expect(await screen.findByTestId('test-detail-no-results')).toHaveTextContent('अजून निकाल आलेला नाही.');
    });

    it('no suggestions on the phone → no "no suggestions" claim, just no section', async () => {
        store.recs = [];
        await openPage();
        await screen.findByTestId('test-detail-head');
        expect(screen.queryByTestId('test-detail-recs')).toBeNull();
    });

    it('the server being unreachable keeps the phone\'s copy on screen', async () => {
        client.getTestInstanceById.mockRejectedValue(new Error('offline'));
        await openPage();
        expect(await screen.findByTestId('test-detail-head')).toHaveTextContent('माती परीक्षण');
    });
});

describe('one test — योजनेत घाला still calls the real client', () => {
    it('adds the suggestion on the farm\'s (IST) day + its offset, then says it is added', async () => {
        await openPage();
        await act(async () => { fireEvent.click(await screen.findByTestId('test-rec-add-rec-1')); });
        expect(client.addRecommendationToPlan).toHaveBeenCalledWith({
            cropCycleId: 'cycle-1',
            farmId: 'farm-1',
            activityName: 'युरिया',
            stage: 'फुलोरा',
            plannedDate: '2026-10-29', // 26 Oct (IST) + 3; the old UTC-date code gave 2026-10-28
            reason: 'From test recommendation N_LOW',
        });
        expect(screen.getByTestId('test-rec-planned-rec-1')).toHaveTextContent('योजनेत घातलं');
        expect(screen.queryByTestId('test-rec-add-rec-1')).toBeNull();
    });

    it('a refusal (403) says no permission, in Marathi', async () => {
        client.addRecommendationToPlan.mockRejectedValue(new TestsApiError('addRecommendationToPlan', 403));
        await openPage();
        await act(async () => { fireEvent.click(await screen.findByTestId('test-rec-add-rec-1')); });
        expect(screen.getByTestId('test-detail-error')).toHaveTextContent('ही नोंद करायची परवानगी तुम्हाला नाही.');
        expect(latinLeftovers()).toEqual([]);
    });

    it('any other failure is said in Marathi and the button stays', async () => {
        client.addRecommendationToPlan.mockRejectedValue(new TestsApiError('addRecommendationToPlan', 500));
        await openPage();
        await act(async () => { fireEvent.click(await screen.findByTestId('test-rec-add-rec-1')); });
        expect(screen.getByTestId('test-detail-error')).toHaveTextContent('योजनेत घालता आलं नाही. पुन्हा प्रयत्न करा.');
        expect(screen.getByTestId('test-rec-add-rec-1')).toBeEnabled();
        expect(latinLeftovers()).toEqual([]);
    });
});

// spec: plr-d10 lane L8b-1 fix round 1 (review L1; founder D-73) — "योजनेत घाला" plans work, which the server allows only
// to the primary owner and the people he gives "कामाचं नियोजन करणे" (PlanWork). A seat without it sees the suggestion but
// no button that cannot work (P5).
describe('one test — योजनेत घाला follows "कामाचं नियोजन करणे"', () => {
    it('a seat without PlanWork sees the suggestion and no button', async () => {
        await openPage(vi.fn(), false);
        expect(await screen.findByTestId('test-rec-rec-1')).toHaveTextContent('युरिया द्या');
        expect(screen.queryByTestId('test-rec-add-rec-1')).toBeNull();
        expect(screen.getByTestId('test-detail-recs').parentElement).not.toHaveTextContent('योजनेत घाला');
        expect(latinLeftovers()).toEqual([]);
    });

    it('a seat with PlanWork has the button', async () => {
        await openPage(vi.fn(), true);
        expect(await screen.findByTestId('test-rec-add-rec-1')).toHaveTextContent('योजनेत घाला');
    });
});
