/**
 * Schema Migration V1 → V2
 *
 * Migrates DailyLog records from V1 (localStorage era) to V2 (DFES MVP).
 *
 * Changes:
 * 1. Verification status: PENDING→DRAFT, APPROVED→VERIFIED, AUTO_APPROVED→CONFIRMED, REJECTED→DISPUTED
 * 2. LogMeta: adds schemaVersion = 2
 * 3. LogVerification → VerificationRecord shape (adds confirmedByActorId, statusHistory, etc.)
 *
 * This function is PURE — takes a log, returns a migrated log. No side effects.
 *
 * @module infrastructure/storage/migrations/v1ToV2
 */

import type { DailyLog, LogVerification } from '../../../types';
import { LogVerificationStatus, migrateVerificationStatus, isV1Status } from '../../../types';
import type { VerificationRecord } from '../../../domain/types/log.types';

/**
 * Migrate a single DailyLog from V1 schema to V2 schema.
 * Returns a new object (does not mutate the input).
 */
export function migrateLogV1ToV2(log: DailyLog): DailyLog {
    const migrated = { ...log };

    // 1. Migrate verification status
    if (migrated.verification) {
        migrated.verification = migrateVerification(migrated.verification);
    }

    // 2. Set schema version in meta
    migrated.meta = {
        ...migrated.meta,
        createdAtISO: migrated.meta?.createdAtISO ?? new Date().toISOString(),
        schemaVersion: 2,
    };

    return migrated;
}

/**
 * Migrate LogVerification from V1 to V2 shape.
 * Preserves existing data while adding V2 fields.
 */
function migrateVerification(v1: LogVerification): LogVerification {
    const oldStatus = v1.status;
    const newStatus = migrateVerificationStatus(oldStatus);

    // Build the migrated verification record
    // We keep the LogVerification shape for backward compat,
    // but with the new status value
    const migrated: LogVerification = {
        status: newStatus,
        required: v1.required,
        notes: v1.notes,
    };

    // Map V1 verifiedByOperatorId to the appropriate V2 actor field
    if (v1.verifiedByOperatorId) {
        if (newStatus === LogVerificationStatus.VERIFIED) {
            migrated.verifiedByOperatorId = v1.verifiedByOperatorId;
            migrated.verifiedAtISO = v1.verifiedAtISO;
        } else if (newStatus === LogVerificationStatus.CONFIRMED) {
            migrated.verifiedByOperatorId = v1.verifiedByOperatorId;
            migrated.verifiedAtISO = v1.verifiedAtISO;
        } else {
            migrated.verifiedByOperatorId = v1.verifiedByOperatorId;
            migrated.verifiedAtISO = v1.verifiedAtISO;
        }
    }

    return migrated;
}

/**
 * Batch migrate an array of logs.
 * Returns { migrated: DailyLog[], migratedCount: number, alreadyV2Count: number }.
 */
export function batchMigrateV1ToV2(logs: DailyLog[]): {
    migrated: DailyLog[];
    migratedCount: number;
    alreadyV2Count: number;
} {
    let migratedCount = 0;
    let alreadyV2Count = 0;

    const migrated = logs.map(log => {
        const needsMigration = log.meta?.schemaVersion !== 2 ||
            (log.verification && isV1Status(log.verification.status));

        if (needsMigration) {
            migratedCount++;
            return migrateLogV1ToV2(log);
        } else {
            alreadyV2Count++;
            return log;
        }
    });

    return { migrated, migratedCount, alreadyV2Count };
}

/**
 * Build a VerificationRecord from a legacy LogVerification.
 * Use this when constructing the full V2 record shape.
 */
export function toVerificationRecord(v1: LogVerification): VerificationRecord {
    const newStatus = migrateVerificationStatus(v1.status);

    const record: VerificationRecord = {
        status: newStatus,
        required: v1.required,
        notes: v1.notes,
        statusHistory: [],
    };

    // Map the actor to the appropriate V2 field
    if (v1.verifiedByOperatorId && v1.verifiedAtISO) {
        switch (newStatus) {
            case LogVerificationStatus.VERIFIED:
                record.verifiedByActorId = v1.verifiedByOperatorId;
                record.verifiedAtISO = v1.verifiedAtISO;
                break;
            case LogVerificationStatus.CONFIRMED:
                record.confirmedByActorId = v1.verifiedByOperatorId;
                record.confirmedAtISO = v1.verifiedAtISO;
                break;
            case LogVerificationStatus.DISPUTED:
                record.disputedByActorId = v1.verifiedByOperatorId;
                record.disputedAtISO = v1.verifiedAtISO;
                break;
            default:
                break;
        }
    }

    return record;
}
