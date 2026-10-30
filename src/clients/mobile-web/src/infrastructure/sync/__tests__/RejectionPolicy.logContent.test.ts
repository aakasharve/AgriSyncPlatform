/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1, review N12 / N1) — the server's refusals of an edit to
 * what Sathi understood. Each is a three-segment code whose LAST segment the existing policy already knows, so a
 * queued `revise_log_content` the server refuses is PARKED where the farmer sees it (REJECTED_USER_REVIEW,
 * `ConflictResolutionService`) — never retried for ever, never dropped — in this client and in every APK already in
 * the field, with no client change.
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection } from '../RejectionPolicy';

describe('refusals of revise_log_content', () => {
    it('a record saved at the हजेरी door (labour only, B002) is PERMANENT — kept visibly for the farmer', () => {
        expect(categorizeRejection({
            errorCode: 'ShramSafal.LabourDoorLog.InvalidCommand',
            errorMessage: 'This record was saved at the attendance door and holds labour only; its other details cannot be changed. Nothing was saved.',
        })).toBe('PERMANENT');
    });

    it('a document the server cannot store is PERMANENT (the same bytes get the same answer)', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.LogContent.InvalidCommand', errorMessage: 'x' })).toBe('PERMANENT');
    });

    it('an edit that kept losing the race for its version is shown, not dropped', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.LogContent.Conflict', errorMessage: 'x' })).toBe('PERMANENT');
    });
});
