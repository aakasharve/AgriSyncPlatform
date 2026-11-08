// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; founder 2026-10-26 "Marathi mode shows Marathi only, English mode English
 * only"; D-59 no "AI" wording; no emoji) - the words of the plan section, one language at a time: every string of the word tables, and the
 * rendered planner page in both languages (what he typed or was named stays as entered; the log's own crop selector and recorder are
 * not these screens' words and are left out of the scan).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PLAN_DOOR_WORDS } from '../../logs/components/entry/entryWords';
import { PlanWorkPage } from '../components/PlanWorkPage';
import { plannedWorkWords } from '../plannedWorkWords';

vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const AI_WORDING = /\bA\.?I\.?\b|artificial|कृत्रिम|एआय/i;

/** Every string a word table can say, functions called with sample values. */
function strings(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'function') strings((node as (...a: unknown[]) => unknown)(3, 10), out);
    else if (Array.isArray(node)) node.forEach(n => strings(n, out));
    else if (node && typeof node === 'object') Object.values(node).forEach(n => strings(n, out));
    return out;
}

describe('the word tables', () => {
    it('Marathi words: no Latin letter (a few brand-free exceptions: none), no emoji, no "AI" wording', () => {
        for (const s of [...strings(plannedWorkWords('mr')), ...strings(PLAN_DOOR_WORDS.mr)]) {
            expect(s, s).not.toMatch(LATIN);
            expect(s, s).not.toMatch(EMOJI);
            expect(s, s).not.toMatch(AI_WORDING);
        }
    });

    it('English words: no Devanagari letter, no emoji, no "AI" wording', () => {
        for (const s of [...strings(plannedWorkWords('en')), ...strings(PLAN_DOOR_WORDS.en)]) {
            expect(s, s).not.toMatch(DEVANAGARI);
            expect(s, s).not.toMatch(EMOJI);
            expect(s, s).not.toMatch(AI_WORDING);
        }
    });

    it('both languages say every key (the shapes are the same type, so none is missing), and any other language reads Marathi', () => {
        expect(Object.keys(plannedWorkWords('en')).sort()).toEqual(Object.keys(plannedWorkWords('mr')).sort());
        expect(plannedWorkWords('hi')).toBe(plannedWorkWords('mr'));
        expect(plannedWorkWords(undefined)).toBe(plannedWorkWords('mr'));
    });

    it('the founder\'s named words are kept exactly, and the preview\'s are ported as they are', () => {
        const w = plannedWorkWords('mr');
        expect([w.what, w.where, w.when, w.who, w.details, w.assign]).toEqual(['काम काय', 'कुठे', 'कधी', 'कोणाला', 'तपशील', 'काम सोपवा']);
        expect([w.status.Assigned, w.status.Seen, w.status.Accepted, w.status.Done]).toEqual(['सोपवलं', 'पाहिलं', 'स्वीकारलं', 'झालं']);
        expect(w.payMode).toEqual({ Cash: 'रोखीने', Daily: 'रोजंदारी', Contract: 'ठेक्याने', Later: 'नंतर ठरवू' });
        expect(w.noDate).toBe('तारीख ठरलेली नाही');
        expect(w.looseWhen).toEqual({ Week: 'या आठवड्यात', Month: 'या महिन्यात', Anytime: 'जमेल तेव्हा' });
        expect(w.accept).toBe('ठीक आहे, करतो');
        expect(w.lateTag).toBe('उशीर झाला');
        expect(w.submitAssign).toBe('काम सोपवा');
        expect(w.submitRemind).toBe('आठवण ठेवा');
        expect(w.nobody).toBe('फक्त आठवण (कोणालाही नाही)');
        expect(PLAN_DOOR_WORDS.mr.plan).toBe('कामांची जबाबदारी सोपवा / कामांचे नियोजन करा');
        expect(PLAN_DOOR_WORDS.mr.mine).toBe('तुमच्यावर सोपवलेली कामे');
        expect(PLAN_DOOR_WORDS.mr.openCount(4)).toBe('4 कामे चालू');
    });

    it('the preview\'s speak / spoken / exampleSaid / mainPage / remindViaLog and "काम झालं — सांगा" are not here', () => {
        const all = strings(plannedWorkWords('mr')).join('\n');
        for (const gone of ['बोलून सांगा', 'नमुना', 'उदाहरण वाक्य', 'मुख्य पान', 'काम सांगताना सांगा', 'काम झालं — सांगा']) {
            expect(all).not.toContain(gone);
        }
    });
});

const FARM = 'farm-1';
const ME = '22222222-2222-4222-8222-222222222222';
const ASSIGNEE = '11111111-1111-4111-8111-111111111112';
const PLOT = '44444444-4444-4444-8444-444444444441';
const CROPS = [{ id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [{ id: PLOT, name: 'S1' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;
const dto = (n: number, over: Partial<PlannedWorkDto>): PlannedWorkDto => ({
    id: `33333333-3333-4333-8333-33333333330${n}`, farmId: FARM, title: 'फवारणी', scope: 'Plot', plannedDate: '2026-11-05', looseWhen: null, plannedTime: null,
    assigneeUserId: ASSIGNEE, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Assigned',
    source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-04', linkedDailyLogIds: [], createdByUserId: ME,
    createdAtUtc: '2026-11-04T06:00:00.000Z', modifiedAtUtc: '2026-11-04T06:00:00.000Z', plots: [{ plotId: PLOT, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});
const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear()]);
    await reconcileSyncPull(pull([
        dto(1, { status: 'Accepted', crewText: 'Team', expectedHeadcount: 10, payMode: 'Contract', quantityText: 'x', note: 'n' }),
        dto(2, { plannedDate: null, looseWhen: 'Anytime', assigneeUserId: null, status: 'Open' }),
        dto(3, { plannedDate: '2026-11-20', status: 'Seen' }),
        dto(4, { status: 'Cancelled' }),
    ]));
});
afterEach(cleanup);

const names = (language: 'mr' | 'en') => (language === 'mr'
    ? [{ userId: ASSIGNEE, displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots' as const, plotIds: [] }]
    : [{ userId: ASSIGNEE, displayName: 'Shankar', role: 'Mukadam', plotScope: 'AllPlots' as const, plotIds: [] }]);

describe('the rendered planner page', () => {
    for (const language of ['mr', 'en'] as const) {
        it(`${language}: the form and every kind of card read in ${language === 'mr' ? 'Marathi' : 'English'} only (the log's own selector and recorder aside)`, async () => {
            render(<PlanWorkPage farmId={FARM} userId={ME} language={language} crops={CROPS} farmerProfile={PROFILE} mayPlan mayAssign
                today={new Date(2026, 10, 8)} onBack={() => undefined} onOpenConflicts={() => undefined}
                loadAssigneeList={async () => ({ assignees: names(language), source: 'cache', receivedAtUtc: 'x' })} />);
            await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(4));
            await screen.findByTestId(`plan-assign-${ASSIGNEE}`);
            // the form with the crew fields open
            screen.getByTestId(`plan-assign-${ASSIGNEE}`).click();
            await screen.findByTestId('plan-crew-fields');
            const root = screen.getByTestId('plan-work').cloneNode(true) as HTMLElement;
            root.querySelectorAll('[data-testid="plan-where"], [data-testid="plan-mic"]').forEach(n => n.remove());
            const text = (root.textContent ?? '').replace(/[0-9]+/g, '');
            // what he entered stays as entered: the crew text and a note typed in the other script are not our words
            const own = text.replace(/Team|\bx\b|\bn\b|\bS\b/g, '');
            if (language === 'mr') expect(own).not.toMatch(LATIN);
            else expect(own).not.toMatch(DEVANAGARI);
            expect(text).not.toMatch(EMOJI);
            expect(text).not.toMatch(AI_WORDING);
            expect(root.querySelector('[data-testid^="plan-"]')).not.toBeNull();
        });
    }
});
