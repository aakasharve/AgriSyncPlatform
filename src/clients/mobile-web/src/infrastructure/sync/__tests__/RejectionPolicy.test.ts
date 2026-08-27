/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY — RejectionPolicy
 * categorization tests.
 */

import { describe, it, expect } from 'vitest';
import { categorizeRejection, getPermanentRejectionCodes } from '../RejectionPolicy';

describe('RejectionPolicy.categorizeRejection', () => {
    it('returns PERMANENT for each canonical permanent code', () => {
        for (const code of getPermanentRejectionCodes()) {
            expect(categorizeRejection({ errorCode: code })).toBe('PERMANENT');
        }
    });

    it('matches permanent codes case-insensitively', () => {
        expect(categorizeRejection({ errorCode: 'client_too_old' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'Mutation_Type_Unknown' })).toBe('PERMANENT');
    });

    it('strips Category. prefix on the error code', () => {
        expect(categorizeRejection({ errorCode: 'Validation.INVALID_COMMAND' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'Authorization.FORBIDDEN' })).toBe('PERMANENT');
    });

    it('returns RETRYABLE when both errorCode and errorMessage are empty', () => {
        expect(categorizeRejection({})).toBe('RETRYABLE');
        expect(categorizeRejection({ errorCode: '', errorMessage: '' })).toBe('RETRYABLE');
        expect(categorizeRejection({ errorCode: null, errorMessage: null })).toBe('RETRYABLE');
    });

    it('returns RETRYABLE for unknown error codes', () => {
        expect(categorizeRejection({ errorCode: 'TRANSIENT_TIMEOUT' })).toBe('RETRYABLE');
        expect(categorizeRejection({ errorCode: 'NO_RESULT' })).toBe('RETRYABLE');
        expect(categorizeRejection({ errorCode: 'INTERNAL_SERVER_ERROR' })).toBe('RETRYABLE');
    });

    it('falls back to message substring scan when errorCode is unknown', () => {
        expect(categorizeRejection({
            errorCode: 'GENERIC_FAILURE',
            errorMessage: 'Server rejected: CLIENT_TOO_OLD — please update.',
        })).toBe('PERMANENT');

        expect(categorizeRejection({
            errorCode: undefined,
            errorMessage: 'Validation FORBIDDEN: missing tenant header.',
        })).toBe('PERMANENT');
    });

    it('returns RETRYABLE when message has no permanent-code substring', () => {
        expect(categorizeRejection({
            errorMessage: 'Connection reset by peer',
        })).toBe('RETRYABLE');

        expect(categorizeRejection({
            errorMessage: 'fetch failed: aborted',
        })).toBe('RETRYABLE');
    });

    it('treats whitespace-only error code as missing', () => {
        expect(categorizeRejection({ errorCode: '   ', errorMessage: '   ' })).toBe('RETRYABLE');
    });
});

// ---------------------------------------------------------------------------
// The wire codes ShramSafal actually sends — the O-4 regression.
// ---------------------------------------------------------------------------
//
// NOTE WHY THESE ARE NOT COVERED BY THE FIRST TEST IN THIS FILE. That one
// iterates `getPermanentRejectionCodes()` and asserts each is PERMANENT, which
// is true by construction for anything in the list — it can never fail for a
// code that IS listed, and says nothing at all about a code that is NOT. Every
// case below therefore hard-codes the exact `code` + `message` pair read off
// the server, so deleting the matching entry from `PERMANENT_REJECTION_CODES`
// turns the case red. That is the only version of this test worth having.
//
// Pairs verified against `ShramSafal.Domain/Common/ShramSafalErrors.cs` and the
// literal codes in `PushSyncBatchHandler.cs` (read-only for the frontend).
const SERVER_WIRE_REFUSALS: ReadonlyArray<readonly [string, string]> = [
    // Role / authorisation.
    ['ShramSafal.VerificationTransitionNotAllowedForRole', 'Transition not allowed for role.'],
    ['ShramSafal.TestRoleNotAllowed', 'Role is not allowed to perform this action on a test.'],
    ['ShramSafal.ComplianceSignalRoleNotAllowed', 'Role is not allowed to perform this action on a compliance signal.'],
    ['ShramSafal.JobCardRoleNotAllowed', 'Role is not allowed to perform this action on a job card.'],
    // Command shape.
    ['ShramSafal.InvalidCommand', 'Request is invalid.'],
    ['ShramSafal.InvalidVerificationReason', 'Reason is required for disputed verification.'],
    ['ShramSafal.InvalidVerificationStatus', 'decision must be one of confirm, verify, dispute, request_correction.'],
    ['ShramSafal.ComplianceSignalNoteRequired', 'A resolution note of at least 3 characters is required.'],
];

describe('RejectionPolicy — ShramSafal wire codes', () => {
    it('parks a Mukadam approval refused by the verification state machine (O-4)', () => {
        // The exact pair `VerifyLogHandler.cs:148` produces once O-4 let the
        // Mukadam past `ShramSafalAuthorizationEnforcer`. Before O-4 this
        // arrived as `ShramSafal.Forbidden` and parked correctly; the refusal
        // never changed, only the code did.
        expect(categorizeRejection({
            errorCode: 'ShramSafal.VerificationTransitionNotAllowedForRole',
            errorMessage: 'Transition not allowed for role.',
        })).toBe('PERMANENT');
    });

    it.each(SERVER_WIRE_REFUSALS)('parks %s', (errorCode, errorMessage) => {
        expect(categorizeRejection({ errorCode, errorMessage })).toBe('PERMANENT');
    });

    it('matches by NAME, not by letters that happen to appear in the prose', () => {
        // The same refusal with the code stripped stays RETRYABLE. If this
        // ever flips to PERMANENT, someone widened the substring scan and the
        // list above stopped being the thing that decides.
        expect(categorizeRejection({
            errorMessage: 'Transition not allowed for role.',
        })).toBe('RETRYABLE');
        expect(categorizeRejection({
            errorMessage: 'Role is not allowed to perform this action on a job card.',
        })).toBe('RETRYABLE');
    });

    it('leaves order-dependent and parent-shaped refusals RETRYABLE', () => {
        // Deliberate non-entries. A row whose verdict another queued mutation
        // (or the parent's own arrival) can still change must NOT be parked —
        // that would ask the farmer to resolve a conflict about to resolve
        // itself (`P9`). `*NotFound` belongs to `MutationDependency`.
        for (const [errorCode, errorMessage] of [
            ['ShramSafal.JobCardInvalidState', 'Job card is not in a valid state for this action.'],
            ['ShramSafal.TestInvalidState', 'Test instance is not in a valid state for this action.'],
            ['ShramSafal.JobCardActivityTypeMismatch', 'No task in the daily log matches an activity type on this job card.'],
            ['ShramSafal.PlotNotFound', 'Plot was not found.'],
            ['ShramSafal.JobCardNotFound', 'Job card was not found.'],
            ['ShramSafal.AiParsingFailed', 'Voice parsing failed.'],
        ] as ReadonlyArray<readonly [string, string]>) {
            expect(categorizeRejection({ errorCode, errorMessage })).toBe('RETRYABLE');
        }
    });
});

describe('RejectionPolicy.getPermanentRejectionCodes', () => {
    it('returns at least the four codes the conflict UX hint copy references', () => {
        const codes = new Set(getPermanentRejectionCodes());
        expect(codes.has('CLIENT_TOO_OLD')).toBe(true);
        expect(codes.has('MUTATION_TYPE_UNKNOWN')).toBe(true);
        expect(codes.has('MUTATION_TYPE_UNIMPLEMENTED')).toBe(true);
        expect(codes.has('FORBIDDEN')).toBe(true);
    });
});
