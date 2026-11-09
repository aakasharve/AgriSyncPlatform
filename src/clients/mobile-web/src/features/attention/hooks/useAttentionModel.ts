/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — the लक्ष द्या list for the farm on
 * screen, from the server's board (`useAttentionBoard`) and this phone's to-do store (the SAME store करायची कामे
 * reads, so a reminder ticked on any surface clears from all of them). The page, the bottom-bar count and the
 * आढावा strip all call this — one list, three views of it.
 */
import { useEffect, useMemo, useReducer } from 'react';
import type { CropProfile, PlannedTask } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import { buildTodoList, tickableIds } from '../../reflect/overview/todoModel';
import { buildAttentionModel, type AttentionModel } from '../attentionItems';
import { onRescheduledChange } from '../scheduledWork';
import { useAttentionBoard } from './useAttentionBoard';

export interface AttentionModelState extends AttentionModel {
    board: ReturnType<typeof useAttentionBoard>;
    todayKey: string;
}

export function useAttentionModel(tasks: readonly PlannedTask[] | undefined, crops: readonly CropProfile[] | undefined): AttentionModelState {
    const board = useAttentionBoard();
    const farmId = useOptionalFarmContext()?.currentFarmId ?? null;
    const todayKey = getDateKey();
    // a "पुढे ठरवा" the server confirmed hides its step on every surface at once
    const [rescheduleTick, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onRescheduledChange(bump), []);

    const todos = useMemo(() => {
        if (!tasks?.length) return { late: [], today: [] };
        const list = buildTodoList({
            tasks,
            storeIds: tickableIds(tasks),
            crops: crops ?? [],
            scope: { viewCrops: [], viewPlots: {} },
            wholeFarm: true,
            todayKey,
        });
        return { late: list.late, today: list.today };
    }, [tasks, crops, todayKey]);

    const model = useMemo(
        () => buildAttentionModel({ cards: board.cards, scheduledWork: board.scheduledWork, todos, farmId, todayKey }),
        // rescheduleTick: re-read the locally confirmed moves
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [board.cards, board.scheduledWork, todos, farmId, todayKey, rescheduleTick],
    );

    return { ...model, board, todayKey };
}
