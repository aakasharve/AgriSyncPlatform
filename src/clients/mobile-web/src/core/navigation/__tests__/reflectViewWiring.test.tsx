// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — T2, H16)
 *
 * What the REAL app hands पूर्ण शेतीचा आढावा (`renderReflectView`), checked on the element it returns — the same
 * kind of check `compareTabProps` and `renderAttentionRoute` have (I14 verifier I14-V2F-02). Without these
 * props "आठवण जोडा" and "बोलून सांगा" vanish from करायची कामे while every page-level test stays green:
 *   - "आठवण जोडा" saves through the app's task store (`handleSaveTask`), not the English "Add New Task" sheet;
 *   - "बोलून सांगा" opens the voice log flow through the one door (`openLogFlow.ts`);
 *   - a tick goes through `handleUpdateTask` (the same store लक्ष द्या ticks);
 *   - लक्ष द्या's "तुकडा पहा" plot reaches the page, and reading it clears it.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import type { ReflectPageProps } from '../../../features/reflect/ReflectPageProps';
import type { PlannedTask } from '../../../types';
import { renderReflectView } from '../mainView';

// Lane RF (review B001) — the signed-in session, as the auth store reports it.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../infrastructure/storage/AuthTokenStore')>()),
    getSessionUserId: () => session.userId,
}));

const TASKS = [{ id: 't1', title: 'फवारणी', status: 'pending' }] as PlannedTask[];

const ctxFor = (over: Partial<AppRouterContext> = {}) => ({
    currentRoute: 'main', mainView: 'reflect',
    todayLogs: [], crops: [], history: [], operatorNameById: new Map(), getLogContextSnapshot: () => undefined,
    ledgerDefaults: undefined, plannedTasks: TASKS,
    handleUpdateTask: vi.fn(), handleSaveTask: vi.fn(), setShowTaskCreationSheet: vi.fn(),
    status: 'idle', draftLog: null, handleReset: vi.fn(), setLogScope: vi.fn(), setMode: vi.fn(), setMainView: vi.fn(),
    setStatus: vi.fn(), setDraftLog: vi.fn(), handleEditLog: vi.fn(), handleUpdateNote: vi.fn(), handleVerifyLog: vi.fn(),
    farmerProfile: { operators: [], activeOperatorId: undefined }, setCurrentRoute: vi.fn(),
    reflectFocusRequest: null, setReflectFocusRequest: vi.fn(),
    reflectFocusPlotId: null, setReflectFocusPlotId: vi.fn(),
    ...over,
}) as unknown as AppRouterContext;

const pageProps = (ctx: AppRouterContext) => (renderReflectView(ctx) as React.ReactElement<ReflectPageProps>).props;

describe('renderReflectView — the real doors करायची कामे is given', () => {
    it('renders nothing off the overview tab', () => {
        expect(renderReflectView(ctxFor({ mainView: 'log' } as Partial<AppRouterContext>))).toBeNull();
        expect(renderReflectView(ctxFor({ currentRoute: 'attention' } as Partial<AppRouterContext>))).toBeNull();
    });

    it('"आठवण जोडा" saves into the app\'s task store; the English sheet is not opened', () => {
        const ctx = ctxFor();
        const props = pageProps(ctx);
        expect(props.onSaveTask).toBe(ctx.handleSaveTask);
        expect(props.onAddTask).toBeUndefined();
        expect(props.tasks).toBe(TASKS);
        const task = { id: 'n1', title: 'खत आणायचं' } as PlannedTask;
        props.onSaveTask!(task);
        expect(ctx.handleSaveTask).toHaveBeenCalledWith(task);
        expect(ctx.setShowTaskCreationSheet).not.toHaveBeenCalled();
    });

    it('"बोलून सांगा" opens the voice log flow (voice, the log tab)', () => {
        const ctx = ctxFor();
        pageProps(ctx).onTellTodo!();
        expect(ctx.setMode).toHaveBeenCalledWith('voice');
        expect(ctx.setMainView).toHaveBeenCalledWith('log');
    });

    it('"बोलून सांगा" with a parsed draft waiting shows that draft and changes nothing', () => {
        const ctx = ctxFor({ draftLog: { summary: 'x' } } as unknown as Partial<AppRouterContext>);
        pageProps(ctx).onTellTodo!();
        expect(ctx.setMainView).toHaveBeenCalledWith('log');
        expect(ctx.setMode).not.toHaveBeenCalled();
        expect(ctx.handleReset).not.toHaveBeenCalled();
    });

    it('a tick goes through the same update लक्ष द्या uses', () => {
        const ctx = ctxFor();
        const done = { ...TASKS[0], status: 'done' } as PlannedTask;
        pageProps(ctx).onUpdateTask!(done);
        expect(ctx.handleUpdateTask).toHaveBeenCalledWith('t1', done);
    });

    it('लक्ष द्या\'s plot reaches the page, and reading it clears it', () => {
        const ctx = ctxFor({ reflectFocusPlotId: 'g2' });
        const props = pageProps(ctx);
        expect(props.focusPlotId).toBe('g2');
        props.onFocusPlotConsumed!();
        expect(ctx.setReflectFocusPlotId).toHaveBeenCalledWith(null);
        expect(pageProps(ctxFor()).focusPlotId).toBeNull();
    });

    it("lane RF (review B001): 'he said it' is the SIGNED-IN user, never the profile's active operator (the owner on a worker's phone)", () => {
        session.userId = 'worker-1';
        // a worker's phone after its first sync: the profile's active operator is the PRIMARY OWNER's id
        const props = pageProps(ctxFor({ farmerProfile: { operators: [{ id: 'owner-1', name: 'मालक' }], activeOperatorId: 'owner-1' }, farmRole: 'Worker' } as unknown as Partial<AppRouterContext>));
        expect(props.sessionUserId).toBe('worker-1');
        expect(JSON.stringify({ sessionUserId: props.sessionUserId, farmRole: props.farmRole })).not.toContain('owner-1');
        expect(props.farmRole).toBe('Worker');
        session.userId = null;
        expect(pageProps(ctxFor()).sessionUserId).toBeNull(); // nobody signed in: nobody is "you"
    });
});
