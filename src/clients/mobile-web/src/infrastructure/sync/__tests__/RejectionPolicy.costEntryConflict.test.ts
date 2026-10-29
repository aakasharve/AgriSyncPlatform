/**
 * spec: pre-launch-repair L2b (R-1) — a money entry id the server holds on ANOTHER farm or for another person
 * comes back as `ShramSafal.CostEntry.Conflict`. It must be shown to the farmer and never retried: re-sending
 * the same id cannot change the answer. The code's LAST segment is `Conflict`, so it lands on the existing
 * PERMANENT `CONFLICT` entry — which is also why APKs already in the field park it with no client change.
 * (A repeat of an id the server holds for the same farm and person is not a rejection: the server answers it
 * with the stored entry, so the row is simply applied.)
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection } from '../RejectionPolicy';
import { COST_ENTRY_ID_CONFLICT_CODE } from '../../../features/sync/conflict/ConflictResolutionService';

describe('the cost-entry id conflict', () => {
    it('is the server\'s three-segment code', () => {
        expect(COST_ENTRY_ID_CONFLICT_CODE).toBe('ShramSafal.CostEntry.Conflict');
    });

    it('is PERMANENT — parked for the farmer, never auto-retried', () => {
        expect(categorizeRejection({ errorCode: COST_ENTRY_ID_CONFLICT_CODE, errorMessage: 'This money entry id is already recorded elsewhere.' }))
            .toBe('PERMANENT');
    });

    it('a generic store error stays RETRYABLE (unchanged) — only the typed conflict is final', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.SyncMutationStoreError', errorMessage: 'A database constraint rejected this mutation.' }))
            .toBe('RETRYABLE');
    });
});
