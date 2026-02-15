/**
 * VerificationStateMachine — DFES V2
 *
 * 5-state model with role-gated transitions:
 *   DRAFT → CONFIRMED → VERIFIED
 *                    ↘ DISPUTED → CORRECTION_PENDING → CONFIRMED
 *
 * Transition rules:
 *   DRAFT → CONFIRMED:            Any role (operator confirms own log)
 *   CONFIRMED → VERIFIED:         Owner only (owner says "this matches")
 *   CONFIRMED → DISPUTED:         Owner only (owner flags issue)
 *   VERIFIED → DISPUTED:          Owner only (owner changes mind)
 *   DISPUTED → CORRECTION_PENDING: Any role (operator starts fixing)
 *   CORRECTION_PENDING → CONFIRMED: Any role (operator resubmits)
 *   Any edited state → DRAFT:      System (edit invalidates confirmation)
 *
 * V1 compatibility: Old statuses (PENDING, APPROVED, etc.) are handled
 * by first migrating them via migrateVerificationStatus().
 */

import { LogVerificationStatus, migrateVerificationStatus } from '../../types';
import type { FarmOperator } from '../../types';

type OperatorRole = FarmOperator['role'];

interface TransitionRule {
    to: LogVerificationStatus;
    allowedRoles: ReadonlySet<OperatorRole>;
}

const OWNER_ROLES: ReadonlySet<OperatorRole> = new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']);
const ALL_ROLES: ReadonlySet<OperatorRole> = new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER', 'MUKADAM', 'WORKER']);

/**
 * Transition map: from → list of (to, allowedRoles).
 */
const TRANSITIONS: Record<string, TransitionRule[]> = {
    [LogVerificationStatus.DRAFT]: [
        { to: LogVerificationStatus.CONFIRMED, allowedRoles: ALL_ROLES },
    ],
    [LogVerificationStatus.CONFIRMED]: [
        { to: LogVerificationStatus.VERIFIED, allowedRoles: OWNER_ROLES },
        { to: LogVerificationStatus.DISPUTED, allowedRoles: OWNER_ROLES },
    ],
    [LogVerificationStatus.VERIFIED]: [
        { to: LogVerificationStatus.DISPUTED, allowedRoles: OWNER_ROLES },
    ],
    [LogVerificationStatus.DISPUTED]: [
        { to: LogVerificationStatus.CORRECTION_PENDING, allowedRoles: ALL_ROLES },
    ],
    [LogVerificationStatus.CORRECTION_PENDING]: [
        { to: LogVerificationStatus.CONFIRMED, allowedRoles: ALL_ROLES },
    ],
};

export class VerificationStateMachine {
    /**
     * V1-compatible transition map (no role gating).
     * @deprecated Use canTransitionWithRole() for DFES V2.
     */
    static transitions: Record<LogVerificationStatus, LogVerificationStatus[]> = {
        [LogVerificationStatus.DRAFT]: [LogVerificationStatus.CONFIRMED],
        [LogVerificationStatus.CONFIRMED]: [LogVerificationStatus.VERIFIED, LogVerificationStatus.DISPUTED],
        [LogVerificationStatus.VERIFIED]: [LogVerificationStatus.DISPUTED],
        [LogVerificationStatus.DISPUTED]: [LogVerificationStatus.CORRECTION_PENDING],
        [LogVerificationStatus.CORRECTION_PENDING]: [LogVerificationStatus.CONFIRMED],
        // V1 compat — old code may still reference these
        [LogVerificationStatus.PENDING]: [LogVerificationStatus.CONFIRMED, LogVerificationStatus.DISPUTED],
        [LogVerificationStatus.APPROVED]: [LogVerificationStatus.DISPUTED],
        [LogVerificationStatus.REJECTED]: [LogVerificationStatus.CORRECTION_PENDING],
        [LogVerificationStatus.AUTO_APPROVED]: [LogVerificationStatus.VERIFIED, LogVerificationStatus.DISPUTED],
    };

    /**
     * Simple transition check (no role gating).
     * V1 statuses are migrated before checking.
     */
    static canTransition(from: LogVerificationStatus, to: LogVerificationStatus): boolean {
        const normalizedFrom = migrateVerificationStatus(from);
        const normalizedTo = migrateVerificationStatus(to);
        const rules = TRANSITIONS[normalizedFrom];
        if (!rules) return false;
        return rules.some(r => r.to === normalizedTo);
    }

    /**
     * Role-gated transition check (DFES V2).
     * Returns true only if the transition is valid AND the role is allowed.
     */
    static canTransitionWithRole(
        from: LogVerificationStatus,
        to: LogVerificationStatus,
        role: OperatorRole
    ): boolean {
        const normalizedFrom = migrateVerificationStatus(from);
        const normalizedTo = migrateVerificationStatus(to);
        const rules = TRANSITIONS[normalizedFrom];
        if (!rules) return false;
        return rules.some(r => r.to === normalizedTo && r.allowedRoles.has(role));
    }

    /**
     * When a log is edited, determine the new verification status.
     * Any edit to a verified/confirmed log resets it to DRAFT.
     */
    static getNextStatusForEdit(current: LogVerificationStatus): LogVerificationStatus {
        const normalized = migrateVerificationStatus(current);
        switch (normalized) {
            case LogVerificationStatus.VERIFIED:
            case LogVerificationStatus.CONFIRMED:
                return LogVerificationStatus.DRAFT;
            default:
                return normalized;
        }
    }

    /**
     * Get all valid next statuses for a given role from a given state.
     */
    static getAvailableTransitions(
        from: LogVerificationStatus,
        role: OperatorRole
    ): LogVerificationStatus[] {
        const normalized = migrateVerificationStatus(from);
        const rules = TRANSITIONS[normalized];
        if (!rules) return [];
        return rules
            .filter(r => r.allowedRoles.has(role))
            .map(r => r.to);
    }
}
