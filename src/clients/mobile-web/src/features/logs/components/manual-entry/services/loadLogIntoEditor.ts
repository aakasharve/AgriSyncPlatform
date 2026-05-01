/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    IrrigationEvent, LabourEvent, MachineryEvent, InputEvent, DailyLog
} from '../../../../../types';
import { isCompletedIrrigationEvent } from '../../../services/irrigationCompletion';

export interface LinkedDetailMaps {
    labourMap: Record<string, LabourEvent>;
    irrigationMap: Record<string, IrrigationEvent>;
    machineryMap: Record<string, MachineryEvent>;
    inputMap: Record<string, InputEvent[]>;
}

/**
 * Build the linked-detail maps (labour/irrigation/machinery/inputs keyed by
 * linkedActivityId) for a given DailyLog. Pure function — no React state.
 *
 * Behavior is byte-for-byte identical to the inline logic in handleLogSelect
 * before the decomposition.
 */
export function buildLinkedDetailMaps(log: DailyLog): LinkedDetailMaps {
    const newLabourMap: Record<string, LabourEvent> = {};
    const newIrrigationMap: Record<string, IrrigationEvent> = {};
    const newMachineryMap: Record<string, MachineryEvent> = {};
    const newInputMap: Record<string, InputEvent[]> = {};

    log.labour?.forEach(l => { if (l.linkedActivityId) newLabourMap[l.linkedActivityId] = l; });
    log.irrigation?.filter(isCompletedIrrigationEvent).forEach(i => { if (i.linkedActivityId) newIrrigationMap[i.linkedActivityId] = i; });
    log.machinery?.forEach(m => { if (m.linkedActivityId) newMachineryMap[m.linkedActivityId] = m; });
    log.inputs?.forEach(inp => {
        if (inp.linkedActivityId) {
            if (!newInputMap[inp.linkedActivityId]) newInputMap[inp.linkedActivityId] = [];
            newInputMap[inp.linkedActivityId].push(inp);
        }
    });

    return {
        labourMap: newLabourMap,
        irrigationMap: newIrrigationMap,
        machineryMap: newMachineryMap,
        inputMap: newInputMap,
    };
}
