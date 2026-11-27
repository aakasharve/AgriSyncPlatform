/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The day card the router hands Home (`renderLogView` →
 * `LogEntryFlow` → `WorkHome`), from the router's snapshot only, so the route render stays hook-free:
 *   - the OPEN farm's id, records, crops and people (`useAppData`'s read layer, FIX-2) — never another farm's;
 *   - money only for a seat that may see it (the money card's own gate, `mayShowFarmMoney`); the plan count only where the
 *     plan door shows the farm's count (`mayOpenPlanner`);
 *   - "आढावा उघडा" opens आढावा, on the card's day when it names one (`reflectOpening`, read once by the page).
 */
import React from 'react';
import { FarmDayCardHost } from '../../features/farmDays/FarmDayCard';
import { mayShowFarmMoney } from '../../features/labour/homeAttendanceDoor';
import { requestReflectDay } from '../../features/reflect/reflectOpening';
import type { AppRouterContext } from './routeContext';

export function farmDayCardFor(ctx: AppRouterContext): React.ReactNode {
    const openOverview = (dateKey: string | null) => {
        if (dateKey) requestReflectDay(dateKey);
        ctx.setMainView('reflect');
    };
    return (
        <FarmDayCardHost
            farmId={ctx.activeFarmId ?? null}
            role={ctx.farmRole ?? null}
            history={ctx.history ?? []}
            crops={ctx.crops ?? []}
            // A snapshot built without the people (a preview, a partial test context) has no team: nothing is guessed.
            people={ctx.farmPeople ?? ctx.farmerProfile?.operators ?? []}
            activeOperatorId={ctx.farmerProfile?.activeOperatorId}
            userId={ctx.meUserId ?? null}
            maySeeMoney={mayShowFarmMoney(ctx.farmRole, ctx.maySeeMoney)}
            seesFarmPlan={ctx.mayOpenPlanner === true}
            demo={ctx.isDemoMode}
            onOpenOverview={openOverview}
        />
    );
}
