// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-5; founder D-24d, D-3, TAP-1, P10) - the same door through the router's OWN plan-route
 * renderer, over the real store, the real approval queue and the real `openApprovalReview` (nothing of the approval module is replaced):
 *   - the owner's card "झालं · मंजुरी बाकी" has the door; tapping it puts the newest still-waiting linked record first
 *     (`takeApprovalFocus`) and sends the same open-review event the strip and हजेरी's तपासा send;
 *   - a seat the server says may NOT confirm (`canConfirm: false`) sees the plain state text and no door;
 *   - after the record is decided (the list no longer holds it) the door opens the sheet with no focus;
 *   - Confirmed / Disputed cards have no door; English mode shows English only.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { publishApprovalQueue, resetApprovalQueueForTests, takeApprovalFocus } from '../../approval/approvalQueue';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';
import type { LabourData, ReviewItem } from '../../labour/labourMock';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));

vi.mock('../components/PlanMic', () => ({ PlanMic: () => null }));
vi.mock('../data/plannedWorkAssignees', () => ({ loadAssignees: async () => ({ assignees: [], source: 'server', receivedAtUtc: 'x' }) }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import { renderPlanWorkRoute } from '../../../core/navigation/simpleRoutes';

const FARM = '55555555-5555-4555-8555-555555555551';
const OWNER = '22222222-2222-4222-8222-222222222222';
const WORKER = '11111111-1111-4111-8111-111111111111';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const LOG1 = '66666666-6666-4666-8666-666666666661';
const LOG2 = '66666666-6666-4666-8666-666666666662';
const T1 = '33333333-3333-4333-8333-333333333331';

const done = (word: 'Waiting' | 'Confirmed' | 'Disputed'): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'युरिया टाकणे', scope: 'MultiPlot', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null,
    assigneeUserId: WORKER, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null,
    status: 'Done', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [LOG1, LOG2], confirmationState: word,
    createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    doneAtUtc: '2026-11-08T08:00:00.000Z', doneByUserId: WORKER,
    plots: [
        { plotId: P1, status: 'Done', linkedDailyLogIds: [LOG1], confirmationState: word },
        { plotId: P2, status: 'Done', linkedDailyLogIds: [LOG2], confirmationState: word },
    ],
} as unknown as PlannedWorkDto);
const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

const card = (id: string): ReviewItem => ({
    id, who: `who-${id}`, initial: 'र', tone: 'or', detail: '2026-11-08', status: 'Draft', version: 1,
    plot: 'ऊस 1', plotScope: 'Plot', points: { count: 3, task: 'खत' },
});
/** The one list the server answered for the farm (records the reader may act on). */
const theList = (ids: string[], over: Partial<LabourData> = {}): LabourData => ({ ...EMPTY_LABOUR_DATA, review: ids.map(card), canConfirm: true, ...over });

const ctx = (over: Record<string, unknown> = {}) => ({
    currentRoute: 'plan-work', activeFarmId: FARM, meUserId: OWNER, crops: [], farmerProfile: { operators: [], activeOperatorId: '' },
    mayOpenPlanner: true, mayAssignWork: true, isPrimaryOwner: true, goBackOr: vi.fn(), setCurrentRoute: vi.fn(), setCompletingTask: vi.fn(), completingTask: null,
    onStartDone: undefined,
    ...over,
}) as unknown as AppRouterContext;

const openPlan = async (tasks: PlannedWorkDto[], c: AppRouterContext = ctx()) => {
    await reconcileSyncPull(pull(tasks));
    await act(async () => { render(<>{renderPlanWorkRoute(c)}</>); });
    await act(async () => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });
    return screen.findByTestId(`plan-${T1}`);
};

beforeEach(async () => {
    h.language = 'mr';
    resetApprovalQueueForTests();
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(() => { cleanup(); resetApprovalQueueForTests(); });

describe('the owner\'s card on the real plan page', () => {
    it('shows the door; tapping it calls the REAL openApprovalReview: the newest waiting linked record first, and the open-review event', async () => {
        // The server's list holds both records of the task (listed oldest-first here, as the sheet lists them): LOG2 is the newest done.
        publishApprovalQueue(FARM, theList([LOG1, LOG2]));
        const opened = vi.fn();
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        try {
            const el = await openPlan([done('Waiting')]);
            expect(within(el).getByTestId('plan-card-confirmation')).toHaveTextContent('झालं · मंजुरी बाकी');
            const door = within(el).getByTestId('plan-card-approval-door');
            expect(door).toHaveTextContent('मंजुरी बाकी — तपासा');

            await act(async () => { fireEvent.click(door); });

            expect(opened).toHaveBeenCalledTimes(1);
            expect(takeApprovalFocus()).toBe(LOG2);
            // The card itself never approved anything: no मंजूर / शंका control on it.
            expect(el.textContent).not.toMatch(/मंजूर|शंका/);
        } finally {
            window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        }
    });

    it('when the newest record is already decided the door goes to the one that still waits', async () => {
        publishApprovalQueue(FARM, theList([LOG1]));
        const el = await openPlan([done('Waiting')]);
        await act(async () => { fireEvent.click(within(el).getByTestId('plan-card-approval-door')); });
        expect(takeApprovalFocus()).toBe(LOG1);
    });

    it('when none of the task\'s records is in the list the door still opens the sheet, with no record first', async () => {
        publishApprovalQueue(FARM, theList(['77777777-7777-4777-8777-777777777771']));
        const opened = vi.fn();
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        try {
            const el = await openPlan([done('Waiting')]);
            await act(async () => { fireEvent.click(within(el).getByTestId('plan-card-approval-door')); });
            expect(opened).toHaveBeenCalledTimes(1);
            expect(takeApprovalFocus()).toBeNull();
        } finally {
            window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        }
    });

    it('a seat the server says may not confirm sees the plain state text and no door', async () => {
        publishApprovalQueue(FARM, theList([LOG1, LOG2], { canConfirm: false }));
        const el = await openPlan([done('Waiting')]);
        expect(within(el).getByTestId('plan-card-confirmation')).toHaveTextContent('झालं · मंजुरी बाकी');
        expect(within(el).queryByTestId('plan-card-approval-door')).toBeNull();
    });

    it('a Confirmed or a Disputed card has no door', async () => {
        for (const word of ['Confirmed', 'Disputed'] as const) {
            publishApprovalQueue(FARM, theList([LOG1, LOG2]));
            const el = await openPlan([done(word)]);
            expect(within(el).queryByTestId('plan-card-approval-door')).toBeNull();
            cleanup();
        }
    });

    it('English mode shows English only on the door', async () => {
        h.language = 'en';
        publishApprovalQueue(FARM, theList([LOG1, LOG2]));
        const el = await openPlan([done('Waiting')]);
        const door = within(el).getByTestId('plan-card-approval-door');
        expect(door).toHaveTextContent('Approval pending - review');
        expect(door.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
