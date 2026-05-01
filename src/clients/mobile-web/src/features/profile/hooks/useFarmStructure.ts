/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — useFarmStructure hook.
 *
 * Read-only convenience around the crops + onUpdateCrops pair that the
 * orchestrator receives from AppRouter. Wraps the update callback to
 * preserve referential stability across renders. Future iterations can
 * swap the prop pair for a direct `dataSource.crops` read; section
 * components consume this hook's return shape, so that swap will be
 * mechanical.
 */

import { useCallback } from 'react';
import { CropProfile } from '../../../types';

export interface UseFarmStructureReturn {
    crops: CropProfile[];
    updateCrops: (next: CropProfile[]) => void;
}

export function useFarmStructure(
    crops: CropProfile[],
    onUpdateCrops: (c: CropProfile[]) => void,
): UseFarmStructureReturn {
    const updateCrops = useCallback(
        (next: CropProfile[]) => onUpdateCrops(next),
        [onUpdateCrops],
    );
    return { crops, updateCrops };
}
