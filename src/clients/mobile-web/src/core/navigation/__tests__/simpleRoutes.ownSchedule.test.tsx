// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 1; founder D-132 Q1 = 1 "entry only from planning", D-88 = 2; P5, P9)
 *
 * The two routes that carry the maker's door, checked the way `scheduler-close-day.test.tsx` checks its door: call the route render function and read the
 * props off the element.
 *   - the शेड्यूल route hands the page the seat's answer (`ctx.mayMakeOwnSchedule`, absent = false: fail closed) and a door that ONLY asks to go to planning
 *     (`makerHandoff`) - it writes nothing and queues nothing;
 *   - the planning route hands the page the same answer.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRouterContext } from '../routeContext';
import { renderPlanWorkRoute, renderScheduleRoute } from '../simpleRoutes';
import { takeOwnScheduleMakerRequest } from '../../../features/scheduler/ownSchedule/makerHandoff';

const ctxWith = (over: Partial<AppRouterContext> = {}) => ({
    currentRoute: 'schedule',
    setCurrentRoute: vi.fn(),
    goBackOr: vi.fn(),
    crops: [],
    history: [],
    plannedTasks: [],
    userResources: [],
    handleUpdateCrops: vi.fn(),
    setUserResources: vi.fn(),
    setShowTaskCreationSheet: vi.fn(),
    farmerProfile: { operators: [] },
    activeFarmId: 'farm-1',
    ...over,
}) as unknown as AppRouterContext;

type SchedulePageProps = { mayMakeOwnSchedule: boolean; onMakeOwnSchedule: (cropId: string) => void };
type PlanPageProps = { mayMakeOwnSchedule: boolean };
const propsOf = <P,>(node: React.ReactNode): P => (node as React.ReactElement<{ children: React.ReactElement<P> }>).props.children.props;

beforeEach(() => { takeOwnScheduleMakerRequest(); });
afterEach(() => { takeOwnScheduleMakerRequest(); });

describe('the शेड्यूल route', () => {
    it('Passes_the_seats_answer_and_a_door_that_only_asks_to_go_to_planning_on_that_crop', () => {
        const ctx = ctxWith({ mayMakeOwnSchedule: true });
        const props = propsOf<SchedulePageProps>(renderScheduleRoute(ctx));
        expect(props.mayMakeOwnSchedule).toBe(true);
        props.onMakeOwnSchedule('grape');
        expect(ctx.setCurrentRoute).toHaveBeenCalledWith('plan-work');
        expect(ctx.setCurrentRoute).toHaveBeenCalledTimes(1);
        expect(takeOwnScheduleMakerRequest()).toEqual({ cropId: 'grape' });
    });

    it('An_unknown_seat_(nothing_in_the_context)_is_hidden_fail_closed', () => {
        const props = propsOf<SchedulePageProps>(renderScheduleRoute(ctxWith()));
        expect(props.mayMakeOwnSchedule).toBe(false);
        const denied = propsOf<SchedulePageProps>(renderScheduleRoute(ctxWith({ mayMakeOwnSchedule: false })));
        expect(denied.mayMakeOwnSchedule).toBe(false);
    });
});

describe('the planning route', () => {
    it('Passes_the_seats_answer_to_the_planning_page', () => {
        expect(propsOf<PlanPageProps>(renderPlanWorkRoute(ctxWith({ currentRoute: 'plan-work', mayMakeOwnSchedule: true }))).mayMakeOwnSchedule).toBe(true);
        expect(propsOf<PlanPageProps>(renderPlanWorkRoute(ctxWith({ currentRoute: 'plan-work', mayMakeOwnSchedule: false }))).mayMakeOwnSchedule).toBe(false);
        expect(propsOf<PlanPageProps>(renderPlanWorkRoute(ctxWith({ currentRoute: 'plan-work' }))).mayMakeOwnSchedule).toBe(false);
    });
});
