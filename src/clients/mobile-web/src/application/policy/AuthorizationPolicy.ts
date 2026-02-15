/**
 * AuthorizationPolicy — DFES V2
 *
 * Role-gated permission matrix for 9 actions x 4 roles.
 * Pure domain logic — no imports from infrastructure or UI.
 *
 * PERMISSION_MATRIX (Y = allowed):
 * | Action            | PRIMARY_OWNER | SECONDARY_OWNER | MUKADAM | WORKER |
 * |-------------------|:---:|:---:|:---:|:---:|
 * | CREATE_LOG        |  Y  |  Y  |  Y  |  Y  |
 * | CONFIRM_OWN_LOG   |  Y  |  Y  |  Y  |  Y  |
 * | EDIT_LOG          |  Y  |  Y  |  N  |  N  |
 * | DELETE_LOG        |  Y  |  N  |  N  |  N  |
 * | VERIFY_LOG        |  Y  |  Y  |  N  |  N  |
 * | DISPUTE_LOG       |  Y  |  Y  |  N  |  N  |
 * | CORRECT_LOG       |  Y  |  Y  |  N  |  N  |
 * | VIEW_AUDIT        |  Y  |  Y  |  N  |  N  |
 * | MANAGE_FARM       |  Y  |  N  |  N  |  N  |
 */

import type { FarmerProfile, FarmOperator } from '../../types';

export type ActionType =
    | 'CREATE_LOG'
    | 'CONFIRM_OWN_LOG'
    | 'EDIT_LOG'
    | 'DELETE_LOG'
    | 'VERIFY_LOG'
    | 'DISPUTE_LOG'
    | 'CORRECT_LOG'
    | 'VIEW_AUDIT'
    | 'MANAGE_FARM';

type OperatorRole = FarmOperator['role'];

/**
 * Static permission matrix: action → set of allowed roles.
 */
const PERMISSION_MATRIX: Record<ActionType, ReadonlySet<OperatorRole>> = {
    CREATE_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER', 'MUKADAM', 'WORKER']),
    CONFIRM_OWN_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER', 'MUKADAM', 'WORKER']),
    EDIT_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']),
    DELETE_LOG: new Set(['PRIMARY_OWNER']),
    VERIFY_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']),
    DISPUTE_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']),
    CORRECT_LOG: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']),
    VIEW_AUDIT: new Set(['PRIMARY_OWNER', 'SECONDARY_OWNER']),
    MANAGE_FARM: new Set(['PRIMARY_OWNER']),
};

export class AuthorizationPolicy {
    /**
     * Check if the active operator on the profile can perform the given action.
     */
    static can(action: ActionType, actor: FarmerProfile, _resource?: unknown): boolean {
        if (!actor || !actor.activeOperatorId) return false;

        const operator = actor.operators?.find(op => op.id === actor.activeOperatorId);
        if (!operator) return false;

        const allowed = PERMISSION_MATRIX[action];
        return allowed ? allowed.has(operator.role) : false;
    }

    /**
     * Resolve the role of the active operator.
     */
    static getActiveRole(actor: FarmerProfile): OperatorRole | null {
        if (!actor?.activeOperatorId) return null;
        const operator = actor.operators?.find(op => op.id === actor.activeOperatorId);
        return operator?.role ?? null;
    }

    /**
     * Check if a role is an owner role (can verify/dispute).
     */
    static isOwnerRole(role: OperatorRole): boolean {
        return role === 'PRIMARY_OWNER' || role === 'SECONDARY_OWNER';
    }
    /**
     * Get a display label for the role
     */
    static getRoleLabel(role: OperatorRole, lang: 'en' | 'mr' = 'en'): string {
        const labels: Record<OperatorRole, { en: string; mr: string }> = {
            'PRIMARY_OWNER': { en: 'Owner', mr: 'मालक' },
            'SECONDARY_OWNER': { en: 'Co-Owner', mr: 'सह-मालक' },
            'MUKADAM': { en: 'Mukadam', mr: 'मुकादम' },
            'WORKER': { en: 'Worker', mr: 'कामाची व्यक्ती' }
        };
        return labels[role]?.[lang] || role;
    }
}
