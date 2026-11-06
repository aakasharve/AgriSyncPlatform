/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H15 / T3, H16)
 *
 * The लक्ष द्या route hands its page REAL doors: "← मागे" goes back where he came from (home as the fallback);
 * a card's button opens the tab or route the action names; the late to-dos are the app's planned-task store,
 * ticked through the same `handleUpdateTask` करायची कामे uses; the person's hidden tabs travel with it.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderAttentionRoute } from '../simpleRoutes';
import { resetSpeakStoreForTests, speakState } from '../../speak/speakStore';
import type { AttentionPageProps } from '../../../features/attention/pages/AttentionPage';
import type { PlannedTask } from '../../../types';

const TASKS = [{ id: 't1', title: 'फवारणी' }] as PlannedTask[];

const ctxFor = (currentRoute = 'attention') => ({
    currentRoute,
    setCurrentRoute: vi.fn(), setMainView: vi.fn(), goBackOr: vi.fn(), handleUpdateTask: vi.fn(), setReflectFocusPlotId: vi.fn(),
    plannedTasks: TASKS, crops: [{ id: 'grape', plots: [{ id: 'g1' }] }], hiddenViews: ['compare'],
    status: 'idle', draftLog: null, handleReset: vi.fn(), setLogScope: vi.fn(), setMode: vi.fn(), farmRole: 'Mukadam',
}) as unknown as AppRouterContext;

const pageOf = (ctx: AppRouterContext) =>
    (renderAttentionRoute(ctx) as React.ReactElement<{ children: React.ReactElement<AttentionPageProps> }>).props.children.props;

describe('the लक्ष द्या route', () => {
    it('renders nothing on another route', () => {
        expect(renderAttentionRoute(ctxFor('main'))).toBeNull();
    });

    it('"← मागे" goes back where he came from, home as the fallback', () => {
        const ctx = ctxFor();
        pageOf(ctx).onBack!();
        expect(ctx.goBackOr).toHaveBeenCalledWith('main');
    });

    it('each card target opens a real place', () => {
        const ctx = ctxFor();
        const page = pageOf(ctx);
        const card = {} as never;
        page.onGo!({ kind: 'view', view: 'compare' }, card);
        expect(ctx.setMainView).toHaveBeenLastCalledWith('compare');
        expect(ctx.setCurrentRoute).toHaveBeenLastCalledWith('main');
        page.onGo!({ kind: 'tests' }, card);
        expect(ctx.setCurrentRoute).toHaveBeenLastCalledWith('tests');
        page.onGo!({ kind: 'route', route: 'schedule' }, card);
        expect(ctx.setCurrentRoute).toHaveBeenLastCalledWith('schedule');
        // a plain tab opens with no plot asked for
        expect(ctx.setReflectFocusPlotId).not.toHaveBeenCalled();
    });

    it('"तुकडा पहा" opens the overview narrowed to THAT plot (I14-V2F-03)', () => {
        const ctx = ctxFor();
        pageOf(ctx).onGo!({ kind: 'view', view: 'reflect', plotId: 'plot-7' }, {} as never);
        expect(ctx.setReflectFocusPlotId).toHaveBeenCalledWith('plot-7');
        expect(ctx.setMainView).toHaveBeenLastCalledWith('reflect');
        expect(ctx.setCurrentRoute).toHaveBeenLastCalledWith('main');
    });

    it('late to-dos come from the task store and a tick goes through the same update करायची कामे uses', () => {
        const ctx = ctxFor();
        const page = pageOf(ctx);
        expect(page.tasks).toBe(TASKS);
        const done = { ...TASKS[0], status: 'done' } as PlannedTask;
        page.onUpdateTask!(done);
        expect(ctx.handleUpdateTask).toHaveBeenCalledWith('t1', done);
        page.onOpenTodos!();
        expect(ctx.setMainView).toHaveBeenLastCalledWith('reflect');
        expect(ctx.setCurrentRoute).toHaveBeenLastCalledWith('main');
    });

    it('the person\'s hidden tabs travel with it (a worker: no तुलना button)', () => {
        expect(pageOf(ctxFor()).hiddenViews).toEqual(['compare']);
    });

    // spec: plr-d10 (I22, founder D-1 / D-22)
    it('"काम नोंदवा" opens THE ONE mic on THAT step plot (no pickers) and comes back to लक्ष द्या (MIC-1)', () => {
        resetSpeakStoreForTests();
        const ctx = ctxFor();
        pageOf(ctx).onRecordWork!({ plotId: 'g1' } as never);
        expect(speakState().request).toMatchObject({
            purpose: 'attention',
            context: { place: { cropId: 'grape', plotId: 'g1' } },
            returnTo: { route: 'attention' },
        });
        // the page is not left: the mic opens over it
        expect(ctx.setCurrentRoute).not.toHaveBeenCalled();
        // a plot this phone does not hold: the mic asks for the crop and plot
        pageOf(ctx).onRecordWork!({ plotId: 'elsewhere' } as never);
        expect(speakState().request?.context.place).toBeUndefined();
        resetSpeakStoreForTests();
    });

    it('"पुढे ठरवा" follows "कामाचं नियोजन करणे" (PlanWork, founder D-73), never the label', () => {
        // a plain मुकादम: no PlanWork from the server → no button
        const plain = { ...(ctxFor() as unknown as Record<string, unknown>), mayPlanWork: false } as unknown as AppRouterContext;
        expect(pageOf(plain).canReschedule).toBe(false);
        // the same मुकादम seat once the owner gave PlanWork → the button
        const planner = { ...(ctxFor() as unknown as Record<string, unknown>), mayPlanWork: true } as unknown as AppRouterContext;
        expect(pageOf(planner).canReschedule).toBe(true);
        // an older context with no answer: the primary owner only (he holds every authority, D-26)
        expect(pageOf(ctxFor()).canReschedule).toBe(false);
        const owner = { ...(ctxFor() as unknown as Record<string, unknown>), farmRole: 'PrimaryOwner' } as unknown as AppRouterContext;
        expect(pageOf(owner).canReschedule).toBe(true);
    });
});
