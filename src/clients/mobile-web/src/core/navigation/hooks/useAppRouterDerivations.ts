/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppRouter.tsx.
 *
 * Computes every memo + derived value AppRouter consumed inline. Lifted
 * verbatim so behavior stays identical; the dependency arrays match the
 * original site so React's reconciler sees the same recompute schedule.
 */

import React from 'react';
import type { CropProfile, DailyLog, FarmerProfile } from '../../../types';
import { financeSelectors } from '../../../features/finance/financeSelectors';
import { computeDayState } from '../../../shared/utils/dayState';
import { getDateKey } from '../../domain/services/DateKeyService';

interface DerivationsInput {
    farmerProfile: FarmerProfile;
    crops: CropProfile[];
    history: DailyLog[];
    plannedTasks: ReturnType<typeof Object> extends never ? never : unknown[];
    selectedCropIds: readonly string[];
    selectedPlotIds: readonly string[];
}

export interface AppRouterDerivations {
    ownerDisplayName: string;
    operatorNameById: Map<string, string>;
    todayDateKey: string;
    yesterdayDate: string;
    scopeCropIds?: string[];
    scopePlotIds?: string[];
    todayLogs: DailyLog[];
    todayDayState: ReturnType<typeof computeDayState>;
    yesterdayDayState: ReturnType<typeof computeDayState>;
    costSnapshot: { today: number; cropSoFar: number; unverifiedToday: number };
    yesterdayCost: number;
    getLogContextSnapshot: (
        log: DailyLog,
    ) => { cropName: string; plotName: string; plotId?: string };
}

export function useAppRouterDerivations({
    farmerProfile,
    crops,
    history,
    plannedTasks,
    selectedCropIds,
    selectedPlotIds,
}: DerivationsInput): AppRouterDerivations {
    const ownerOperator = farmerProfile.operators.find(op => op.role === 'PRIMARY_OWNER');
    const ownerDisplayName = React.useMemo(() => {
        const ownerName = ownerOperator?.name?.trim();
        if (ownerName && ownerName.toLowerCase() !== 'owner') {
            return ownerName;
        }
        return farmerProfile.name || 'Owner';
    }, [ownerOperator, farmerProfile.name]);

    const operatorNameById = React.useMemo(() => {
        const map = new Map<string, string>();
        farmerProfile.operators.forEach(operator => {
            map.set(operator.id, operator.name);
        });
        return map;
    }, [farmerProfile.operators]);

    const todayDateKey = getDateKey();
    const yesterdayDate = React.useMemo(() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        return getDateKey(date);
    }, []);

    // Memoised because both are spread into NEW arrays on every render, and
    // three useMemos below take them as dependencies — so every render
    // recomputed all three day-state derivations for values that had not
    // changed. Pre-existing (the lint warnings predate this file being
    // touched here) and fixed rather than suppressed: the rule is right.
    const scopeCropIds = React.useMemo(
        () => (selectedCropIds.length > 0 ? [...selectedCropIds] : undefined),
        [selectedCropIds],
    );
    const scopePlotIds = React.useMemo(
        () => (selectedPlotIds.length > 0 ? [...selectedPlotIds] : undefined),
        [selectedPlotIds],
    );

    const todayLogs = React.useMemo(
        () => history
            // `date` is REQUIRED by the DailyLog type, so this used to read
            // `log.date.includes(...)` unguarded. A single stored log that
            // violates that contract — an older shape, a partial write, a
            // failed save — then threw "Cannot read properties of undefined
            // (reading 'includes')" from a router derivation, which is above
            // every screen: the ENTIRE APP became an error boundary because of
            // one bad row.
            //
            // A malformed record must be survivable, not fatal. It is dropped
            // from today rather than guessed into it — a log with no date
            // cannot be claimed to be today’s — and it is NAMED in the console
            // so the bad row is findable instead of silently swallowed.
            .filter((log) => {
                if (typeof log?.date !== 'string' || log.date.length === 0) {
                    console.warn(
                        '[todayLogs] a stored log has no date and was excluded from today.',
                        { logId: (log as { id?: unknown })?.id },
                    );
                    return false;
                }
                return true;
            })
            .filter(log => (log.date.includes('T') ? log.date.split('T')[0] : log.date) === todayDateKey)
            .sort((a, b) => new Date(b.meta?.createdAtISO || b.date).getTime() - new Date(a.meta?.createdAtISO || a.date).getTime()),
        [history, todayDateKey],
    );

    const todayDayState = React.useMemo(() => computeDayState({
        logs: history,
        crops,
        tasks: plannedTasks as never,
        date: todayDateKey,
        selectedCropIds: scopeCropIds,
        selectedPlotIds: scopePlotIds,
    }), [history, crops, plannedTasks, todayDateKey, scopeCropIds, scopePlotIds]);

    const yesterdayDayState = React.useMemo(() => computeDayState({
        logs: history,
        crops,
        tasks: plannedTasks as never,
        date: yesterdayDate,
        selectedCropIds: scopeCropIds,
        selectedPlotIds: scopePlotIds,
    }), [history, crops, plannedTasks, yesterdayDate, scopeCropIds, scopePlotIds]);

    const baseFinanceFilters = React.useMemo(
        () => ({
            cropId: scopeCropIds?.[0],
            plotId: scopePlotIds?.[0],
        }),
        [scopeCropIds, scopePlotIds],
    );

    const costSnapshot = React.useMemo(() => {
        const today = financeSelectors.getTotalCost({
            ...baseFinanceFilters,
            fromDate: todayDateKey,
            toDate: todayDateKey,
        });
        const cropSoFar = financeSelectors.getTotalCost(baseFinanceFilters);
        const unverifiedToday = financeSelectors
            .getBreakdown({
                ...baseFinanceFilters,
                fromDate: todayDateKey,
                toDate: todayDateKey,
            })
            .lines.filter(line => line.trustStatus === 'Unverified').length;
        return { today, cropSoFar, unverifiedToday };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseFinanceFilters, todayDateKey, history.length]);

    const yesterdayCost = React.useMemo(
        () => financeSelectors.getTotalCost({
            ...baseFinanceFilters,
            fromDate: yesterdayDate,
            toDate: yesterdayDate,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [baseFinanceFilters, yesterdayDate, history.length],
    );

    const getLogContextSnapshot = (log: DailyLog) => {
        const selection = log.context.selection[0];
        const crop = crops.find(item => item.id === selection?.cropId);
        const plotId = selection?.selectedPlotIds?.[0];
        const plotFromCatalog = crop?.plots.find(plot => plot.id === plotId);

        return {
            cropName: selection?.cropName || crop?.name || 'General Farm',
            plotName: selection?.selectedPlotNames?.[0] || plotFromCatalog?.name || 'General Farm',
            plotId,
        };
    };

    return {
        ownerDisplayName,
        operatorNameById,
        todayDateKey,
        yesterdayDate,
        scopeCropIds,
        scopePlotIds,
        todayLogs,
        todayDayState,
        yesterdayDayState,
        costSnapshot,
        yesterdayCost,
        getLogContextSnapshot,
    };
}
