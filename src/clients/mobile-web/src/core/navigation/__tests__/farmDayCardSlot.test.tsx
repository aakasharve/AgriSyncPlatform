/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. What the real router hands Home's day card, checked
 * on the element it returns (the same kind of check `reflectViewWiring.test.tsx` makes):
 *   - the OPEN farm only (its id, its records, its crops, its people — never another farm's);
 *   - money only for a seat that may see it (the cost card's own gate); the plan count only where the plan door shows it;
 *   - demo mode passes through (no card on sample records);
 *   - its "आढावा उघडा" opens आढावा, on the card's day when it names one (a one-shot note the page reads when it mounts).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import type { FarmDayCardHostProps } from '../../../features/farmDays/FarmDayCard';
import { farmDayCardFor } from '../farmDayCardSlot';
import { clearReflectDay, peekReflectDay } from '../../../features/reflect/reflectOpening';

afterEach(() => clearReflectDay());

const HISTORY = [{ id: 'L1', date: '2026-11-26' }];
const CROPS = [{ id: 'grape', name: 'द्राक्ष', plots: [] }];
const PEOPLE = [{ id: 'me', name: 'प्रकाश' }, { id: 'ramesh', name: 'रमेश' }];

const ctxFor = (over: Partial<AppRouterContext> = {}) => ({
    activeFarmId: 'farm-b', farmRole: 'PrimaryOwner', maySeeMoney: true, mayOpenPlanner: true, isDemoMode: false,
    history: HISTORY, crops: CROPS, farmPeople: PEOPLE, meUserId: 'u-me',
    farmerProfile: { activeOperatorId: 'me', operators: [{ id: 'someone-else' }] },
    setMainView: vi.fn(),
    ...over,
}) as unknown as AppRouterContext;

const propsOf = (ctx: AppRouterContext) => (farmDayCardFor(ctx) as React.ReactElement<FarmDayCardHostProps>).props;

describe('Home day card — what the router hands it', () => {
    it('the open farm\'s own id, records, crops and people, and who he is', () => {
        const p = propsOf(ctxFor());
        expect(p.farmId).toBe('farm-b');
        expect(p.role).toBe('PrimaryOwner');
        expect(p.history).toBe(HISTORY);
        expect(p.crops).toBe(CROPS);
        expect(p.people).toBe(PEOPLE);
        expect(p.activeOperatorId).toBe('me');
        expect(p.userId).toBe('u-me');
        expect(p.maySeeMoney).toBe(true);
        expect(p.seesFarmPlan).toBe(true);
        expect(p.demo).toBe(false);
    });

    it('no farm people list (a preview): the profile\'s people', () => {
        expect(propsOf(ctxFor({ farmPeople: undefined })).people).toEqual([{ id: 'someone-else' }]);
    });

    it('money follows the cost card\'s gate: a seat the server gave no money sees none; before its answer only the primary owner', () => {
        expect(propsOf(ctxFor({ maySeeMoney: false })).maySeeMoney).toBe(false);
        expect(propsOf(ctxFor({ farmRole: 'SecondaryOwner', maySeeMoney: undefined })).maySeeMoney).toBe(false);
        expect(propsOf(ctxFor({ farmRole: 'PrimaryOwner', maySeeMoney: undefined })).maySeeMoney).toBe(true);
        expect(propsOf(ctxFor({ mayOpenPlanner: false })).seesFarmPlan).toBe(false);
    });

    it('demo mode passes through', () => {
        expect(propsOf(ctxFor({ isDemoMode: true })).demo).toBe(true);
    });

    it('"आढावा उघडा" opens आढावा on the card\'s day; with no day, on today', () => {
        const ctx = ctxFor();
        propsOf(ctx).onOpenOverview('2026-11-26');
        expect(peekReflectDay()).toBe('2026-11-26');
        expect(ctx.setMainView).toHaveBeenCalledWith('reflect');
        clearReflectDay();
        propsOf(ctx).onOpenOverview(null);
        expect(peekReflectDay()).toBeNull();
        expect(ctx.setMainView).toHaveBeenCalledTimes(2);
    });
});
