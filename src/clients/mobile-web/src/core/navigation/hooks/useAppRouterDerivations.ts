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

    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    const scopeCropIds = selectedCropIds.length > 0 ? [...selectedCropIds] : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    const scopePlotIds = selectedPlotIds.length > 0 ? [...selectedPlotIds] : undefined;

    const todayLogs = React.useMemo(
        () => history
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
