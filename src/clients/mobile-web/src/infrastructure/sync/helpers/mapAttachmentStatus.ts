/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 * Maps server-side attachment status strings to AttachmentRecord status.
 */

import type { AttachmentRecord } from '../../storage/DexieDatabase';

export function mapAttachmentStatus(status?: string): AttachmentRecord['status'] {
    if (!status) {
        return 'pending';
    }

    switch (status.trim().toLowerCase()) {
        case 'finalized':
        case 'uploaded':
            return 'uploaded';
        case 'uploading':
            return 'uploading';
        case 'failed':
            return 'failed';
        default:
            return 'pending';
    }
}
