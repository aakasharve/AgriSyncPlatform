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
            return 'WORKER';
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
        default:
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
            ];
    }
}
