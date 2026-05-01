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

describe('RejectionPolicy.getPermanentRejectionCodes', () => {
    it('returns at least the four codes the conflict UX hint copy references', () => {
        const codes = new Set(getPermanentRejectionCodes());
        expect(codes.has('CLIENT_TOO_OLD')).toBe(true);
        expect(codes.has('MUTATION_TYPE_UNKNOWN')).toBe(true);
        expect(codes.has('MUTATION_TYPE_UNIMPLEMENTED')).toBe(true);
        expect(codes.has('FORBIDDEN')).toBe(true);
    });
});
