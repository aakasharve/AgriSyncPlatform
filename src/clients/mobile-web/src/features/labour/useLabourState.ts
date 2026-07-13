/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourState — the Labour feature's data hook. Mirrors the shape of
 * `features/profile/hooks/useFarmAdminState.ts`: screens consume one hook and
 * never touch data plumbing directly. Today it returns mock/in-memory data for
 * the local UAT shell; the real backend swaps in behind this same interface.
 */
import { LABOUR_MOCK, type LabourData } from './labourMock';

export interface UseLabourStateResult {
    data: LabourData;
    loading: boolean;
}

export const useLabourState = (): UseLabourStateResult => {
    // Mock phase: synchronous, no fetch. Real phase will load via a data client
    // in a cancellable useEffect (see useFarmAdminState for the pattern).
    return { data: LABOUR_MOCK, loading: false };
};
