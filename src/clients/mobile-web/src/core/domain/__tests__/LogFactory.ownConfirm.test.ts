/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LogFactory — the owner check must compare CAPABILITY, never IDENTITY.
 *
 * spec: dfes-companion-2026-07-11 (wave-1.1)
 *
 * THE DEFECT (verified causal chain):
 *   1. `profileAndCropsReconciler.ts` replaces `profile.activeOperatorId` with a
 *      server GUID after any pull that carries operators. It tries to preserve
 *      the existing id, but the candidate ids all come from `operator.userId`
 *      (server GUIDs), so the literal `'owner'` can never match and the
 *      fallback to `ownerOperator.id` always fires.
 *   2. All four LogFactory methods read `profile.activeOperatorId === 'owner'`.
 *   3. `useAppData.ts` is the ONLY writer of the literal `'owner'` — a React
 *      useState initializer, i.e. the window before a profile with operators
 *      was ever persisted.
 *   => After the first sync NOBODY matches, so every log the farm owner records
 *      is filed PENDING. The farmer logs work and his score drops.
 *
 * WHY CAPABILITY AND NOT IDENTITY: the owner's server GUID does not exist on a
 * brand-new farmer's device before the first sync, so an id comparison has a
 * day-one hole. `capabilities` is present in BOTH states — pre-sync seeded by
 * `useAppData.ts`, post-sync derived by `capabilitiesForRole()`.
 *
 * WHY CAPABILITY AND NOT `role === 'PRIMARY_OWNER'`: SECONDARY_OWNER
 * legitimately holds APPROVE_LOGS (`operatorRole.ts`), and APPROVE_LOGS is the
 * same predicate `isVerifier` encodes.
 *
 * These tests cover BOTH directions on ALL FOUR factory methods:
 *   (a) the owner's POST-SYNC log is confirmed, and carries a verifier id that
 *       actually resolves to an operator in the roster; and
 *   (b) a MUKADAM's log is STILL pending with no verifier id — the
 *       queue-for-approval path this feature exists to enforce must not
 *       regress.
 */

import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import { OperatorCapability, LogVerificationStatus } from '../../../types';
import type { Clock } from '../services/Clock';
import type {
    FarmerProfile,
    FarmOperator,
    FarmTrustSettings,
    CropProfile,
    LogScope,
    AgriLogResponse,
    CropActivityEvent,
    LabourEvent,
} from '../../../types';

const FIXED_ISO = '2026-08-16T06:00:00.000Z';
const fixedClock: Clock = {
    now: () => new Date(FIXED_ISO),
    nowISO: () => FIXED_ISO,
    nowEpoch: () => new Date(FIXED_ISO).getTime(),
};

/** Server GUIDs — exactly the shape profileAndCropsReconciler writes post-sync. */
const OWNER_GUID = '9f1c4d20-3b7e-4a55-9a11-0c2f5b8e7d31';
const MUKADAM_GUID = '2d8a6f11-77c4-49b2-8f03-5e6b1a9c0d42';

function ownerOperator(id: string = OWNER_GUID): FarmOperator {
    return {
        id,
        name: 'Purvesh',
        role: 'PRIMARY_OWNER',
        // capabilitiesForRole('PRIMARY_OWNER') === every capability.
        capabilities: Object.values(OperatorCapability) as OperatorCapability[],
        isVerifier: true,
        isActive: true,
    };
}

function mukadamOperator(): FarmOperator {
    return {
        id: MUKADAM_GUID,
        name: 'Ganpat (Mukadam)',
        role: 'MUKADAM',
        // capabilitiesForRole('MUKADAM') — deliberately NO APPROVE_LOGS.
        capabilities: [OperatorCapability.VIEW_ALL, OperatorCapability.LOG_DATA],
        isVerifier: false,
        isActive: true,
    };
}

function makeProfile(
    activeOperatorId: string,
    reviewPolicy: FarmTrustSettings['reviewPolicy'],
    operators: FarmOperator[] = [ownerOperator(), mukadamOperator()],
): FarmerProfile {
    return {
        activeOperatorId,
        operators,
        trust: { reviewPolicy, requirePinForVerification: false },
    } as unknown as FarmerProfile;
}

function makeCrops(): CropProfile[] {
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [
                { id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } },
            ] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeSinglePlotScope(): LogScope {
    return {
        selectedPlotIds: ['plot-a'],
        selectedCropIds: ['crop-grapes'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

function makeFarmGlobalScope(): LogScope {
    return {
        selectedPlotIds: [],
        selectedCropIds: ['FARM_GLOBAL'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

const MANUAL_DATA = {
    date: '2026-08-16',
    cropActivities: [
        { id: 'ca1', title: 'Pruning', status: 'completed' as const, targetPlotName: 'Plot A' },
    ] as CropActivityEvent[],
    labour: [
        { id: 'lab1', type: 'HIRED' as const, count: 5, wagePerPerson: 400, totalCost: 2000, targetPlotName: 'Plot A' },
    ] as LabourEvent[],
};

function makeVoiceResponse(): AgriLogResponse {
    return {
        summary: 'आज छाटणी केली',
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [
            { id: 'ca1', title: 'छाटणी', status: 'completed', targetPlotName: 'Plot A' },
        ],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        plannedTasks: [],
        missingSegments: [],
    } as unknown as AgriLogResponse;
}

// createFromVoiceResult positional args: (response, scope, crops, profile,
// weatherStamps, provenance, clock, idGen, resolveDue).
function voiceLogs(profile: FarmerProfile, scope: LogScope) {
    return LogFactory.createFromVoiceResult(
        makeVoiceResponse(),
        scope,
        makeCrops(),
        profile,
        undefined,
        undefined,
        fixedClock,
    );
}

function manualLogs(profile: FarmerProfile, scope: LogScope) {
    return LogFactory.createFromManualEntry(
        MANUAL_DATA,
        scope,
        makeCrops(),
        profile,
        fixedClock,
    );
}

// =============================================================================
// (a) THE OWNER, AFTER A SYNC — activeOperatorId is a server GUID
// =============================================================================

describe('LogFactory — the farm owner\'s POST-SYNC log is CONFIRMED, not pending', () => {
    it('createFromManualEntry (per-plot): owner GUID with APPROVE_LOGS ⇒ APPROVED, not required, verifier id resolves to the owner', () => {
        const profile = makeProfile(OWNER_GUID, 'ALWAYS_REVIEW');
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.required).toBe(false);
        expect(log!.verification?.verifiedByOperatorId).toBe(OWNER_GUID);
        expect(log!.verification?.verifiedAtISO).toBe(FIXED_ISO);
        // The verifier id must resolve to a real operator in the roster —
        // dayWorkSummary.ts and ReviewInboxSheet both do exactly this lookup.
        expect(
            profile.operators.find(op => op.id === log!.verification?.verifiedByOperatorId),
        ).toBeDefined();
    });

    it('createFarmGlobalManualLog: owner GUID with APPROVE_LOGS ⇒ APPROVED, not required, verifier id resolves to the owner', () => {
        const profile = makeProfile(OWNER_GUID, 'ALWAYS_REVIEW');
        const [log] = manualLogs(profile, makeFarmGlobalScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.required).toBe(false);
        expect(log!.verification?.verifiedByOperatorId).toBe(OWNER_GUID);
        expect(log!.verification?.verifiedAtISO).toBe(FIXED_ISO);
        expect(
            profile.operators.find(op => op.id === log!.verification?.verifiedByOperatorId),
        ).toBeDefined();
    });

    it('createFromVoiceResult (per-plot): AUTO_APPROVE_OWNER honours the owner GUID ⇒ APPROVED with a resolvable verifier id', () => {
        const profile = makeProfile(OWNER_GUID, 'AUTO_APPROVE_OWNER');
        const [log] = voiceLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.required).toBe(false);
        expect(log!.verification?.verifiedByOperatorId).toBe(OWNER_GUID);
        expect(log!.verification?.verifiedAtISO).toBe(FIXED_ISO);
        expect(
            profile.operators.find(op => op.id === log!.verification?.verifiedByOperatorId),
        ).toBeDefined();
    });

    it('createFarmGlobalVoiceLog: AUTO_APPROVE_OWNER honours the owner GUID ⇒ APPROVED with a resolvable verifier id', () => {
        const profile = makeProfile(OWNER_GUID, 'AUTO_APPROVE_OWNER');
        const [log] = voiceLogs(profile, makeFarmGlobalScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.required).toBe(false);
        expect(log!.verification?.verifiedByOperatorId).toBe(OWNER_GUID);
        expect(log!.verification?.verifiedAtISO).toBe(FIXED_ISO);
        expect(
            profile.operators.find(op => op.id === log!.verification?.verifiedByOperatorId),
        ).toBeDefined();
    });

    it('a SECONDARY_OWNER also holds APPROVE_LOGS, so their log is confirmed too', () => {
        const secondary: FarmOperator = {
            id: 'a1b2c3d4-0000-4000-8000-000000000001',
            name: 'Suresh',
            role: 'SECONDARY_OWNER',
            capabilities: [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
                OperatorCapability.APPROVE_LOGS,
                OperatorCapability.MANAGE_PEOPLE,
            ],
            isVerifier: true,
            isActive: true,
        };
        const profile = makeProfile(secondary.id, 'ALWAYS_REVIEW', [ownerOperator(), secondary]);
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.verifiedByOperatorId).toBe(secondary.id);
    });
});

// =============================================================================
// (b) THE TRUST MODEL MUST NOT REGRESS — a MUKADAM still queues for approval
// =============================================================================

describe('LogFactory — a MUKADAM\'s log is STILL pending (no APPROVE_LOGS capability)', () => {
    it('createFromManualEntry (per-plot): MUKADAM ⇒ PENDING, required, no verifier id', () => {
        const profile = makeProfile(MUKADAM_GUID, 'ALWAYS_REVIEW');
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.PENDING);
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
        expect(log!.verification?.verifiedAtISO).toBeUndefined();
    });

    it('createFarmGlobalManualLog: MUKADAM ⇒ PENDING, required, no verifier id', () => {
        const profile = makeProfile(MUKADAM_GUID, 'ALWAYS_REVIEW');
        const [log] = manualLogs(profile, makeFarmGlobalScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.PENDING);
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
        expect(log!.verification?.verifiedAtISO).toBeUndefined();
    });

    it('createFromVoiceResult (per-plot): AUTO_APPROVE_OWNER must NOT auto-approve a MUKADAM', () => {
        const profile = makeProfile(MUKADAM_GUID, 'AUTO_APPROVE_OWNER');
        const [log] = voiceLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.PENDING);
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
        expect(log!.verification?.verifiedAtISO).toBeUndefined();
    });

    it('createFarmGlobalVoiceLog: AUTO_APPROVE_OWNER must NOT auto-approve a MUKADAM', () => {
        const profile = makeProfile(MUKADAM_GUID, 'AUTO_APPROVE_OWNER');
        const [log] = voiceLogs(profile, makeFarmGlobalScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.PENDING);
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
        expect(log!.verification?.verifiedAtISO).toBeUndefined();
    });

    it('an operator id that matches NOBODY in the roster is not treated as the owner', () => {
        const profile = makeProfile('ghost-operator-id', 'ALWAYS_REVIEW');
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.PENDING);
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
    });
});

// =============================================================================
// DAY ONE — before any sync the seeded literal 'owner' must keep working
// =============================================================================

describe('LogFactory — pre-sync (day one) owner still confirms', () => {
    it("useAppData's seeded { id: 'owner', PRIMARY_OWNER, all capabilities } is still confirmed", () => {
        const profile = makeProfile('owner', 'ALWAYS_REVIEW', [ownerOperator('owner')]);
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        expect(log!.verification?.required).toBe(false);
        expect(log!.verification?.verifiedByOperatorId).toBe('owner');
    });

    it('AUTO_APPROVE_ALL still approves a non-owner on the manual path (policy untouched)', () => {
        const profile = makeProfile(MUKADAM_GUID, 'AUTO_APPROVE_ALL');
        const [log] = manualLogs(profile, makeSinglePlotScope());

        expect(log!.verification?.status).toBe(LogVerificationStatus.APPROVED);
        // Still not the verifier — approval came from policy, not authority.
        expect(log!.verification?.required).toBe(true);
        expect(log!.verification?.verifiedByOperatorId).toBeUndefined();
    });
});
