/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 * Operator role normalization + role → capability mapping.
 */

import { OperatorCapability, type FarmOperator } from '../../../../types';

export function mapOperatorRole(rawRole?: string): FarmOperator['role'] {
    const normalized = (rawRole ?? '').trim().toUpperCase();
    switch (normalized) {
        case 'PRIMARYOWNER':
        case 'PRIMARY_OWNER':
            return 'PRIMARY_OWNER';
        case 'SECONDARYOWNER':
        case 'SECONDARY_OWNER':
            return 'SECONDARY_OWNER';
        case 'MUKADAM':
            return 'MUKADAM';
        default:
            // The server sends a literal "WORKER" placeholder when it cannot see
            // the member's membership, so a synced WORKER is not a known role.
            return 'UNKNOWN';
    }
}

export function capabilitiesForRole(role: FarmOperator['role']): OperatorCapability[] {
    switch (role) {
        case 'PRIMARY_OWNER':
            return Object.values(OperatorCapability) as OperatorCapability[];
        case 'SECONDARY_OWNER':
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
                OperatorCapability.APPROVE_LOGS,
                OperatorCapability.MANAGE_PEOPLE,
            ];
        case 'MUKADAM':
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
            ];
        case 'WORKER':
        case 'UNKNOWN':
        default:
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
            ];
    }
}
