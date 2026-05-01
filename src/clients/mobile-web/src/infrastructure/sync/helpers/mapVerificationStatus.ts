/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 * Maps server-side verification status strings to LogVerificationStatus.
 */

import { LogVerificationStatus } from '../../../types';

export function mapVerificationStatus(status?: string): LogVerificationStatus {
    if (!status) {
        return LogVerificationStatus.DRAFT;
    }

    const normalized = status
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();

    switch (normalized) {
        case 'draft':
        case 'pending':
            return LogVerificationStatus.DRAFT;
        case 'confirmed':
        case 'auto_approved':
            return LogVerificationStatus.CONFIRMED;
        case 'approved':
        case 'verified':
            return LogVerificationStatus.VERIFIED;
        case 'rejected':
        case 'disputed':
            return LogVerificationStatus.DISPUTED;
        case 'correction_pending':
            return LogVerificationStatus.CORRECTION_PENDING;
        default:
            return LogVerificationStatus.DRAFT;
    }
}
