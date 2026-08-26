/**
 * DexieDatabase — DFES V2 Storage Layer
 *
 * IndexedDB-backed database using Dexie.js.
 * 9 tables: logs, outbox, mutationQueue, auditEvents, syncCursors, appMeta,
 * referenceData, attachments, uploadQueue.
 *
 * Replaces localStorage for:
 * - Larger storage capacity (no 5MB limit)
 * - Indexed queries (by date, status, operator)
 * - Transactional writes (atomic log + outbox + audit)
 *
 * @module infrastructure/storage/DexieDatabase
 */

import Dexie, { type Table } from 'dexie';
import type { AuditEvent } from './AuditLogRepository';
import type { CorrectionEvent } from '../../domain/ai/contracts/CorrectionEvent';
import { applyV1 } from './dexie/versions/v1';
import { applyV2 } from './dexie/versions/v2';
import { applyV3 } from './dexie/versions/v3';
import { applyV4 } from './dexie/versions/v4';
import { applyV5 } from './dexie/versions/v5';
import { applyV6 } from './dexie/versions/v6';
import { applyV7 } from './dexie/versions/v7';
import { applyV8 } from './dexie/versions/v8';
import { applyV9 } from './dexie/versions/v9';
import { applyV10 } from './dexie/versions/v10';
import { applyV11 } from './dexie/versions/v11';
import { applyV12 } from './dexie/versions/v12';
import { applyV13 } from './dexie/versions/v13';
import { applyV14 } from './dexie/versions/v14';
import { applyV15 } from './dexie/versions/v15';
import { applyV16 } from './dexie/versions/v16';
import { applyV17 } from './dexie/versions/v17';
import { applyV18 } from './dexie/versions/v18';
import { applyV19 } from './dexie/versions/v19';
import { applyV20 } from './dexie/versions/v20';
import { applyV21 } from './dexie/versions/v21';
import { applyV22 } from './dexie/versions/v22';
import { applyV23 } from './dexie/versions/v23';
import { applyV24 } from './dexie/versions/v24';
import { LEGACY_DATABASE_NAME } from './userDatabaseName';
import { getActiveDatabaseName, clearResolvedDatabaseName } from './activeDatabaseName';
import { recoverLegacyOwnershipClaim, settleOwnershipClaims } from './databaseOwnership';
// Record/interface/type declarations extracted to ./DexieDatabase.types (mobile-web
// 800-line file-size cap). Pure type move — no behavior change. Re-exported below so
// existing `import { X } from '.../DexieDatabase'` call sites keep working unchanged.
import type {
    OutboxEvent,
    MutationQueueItem,
    AttachmentRecord,
    UploadQueueItem,
    PendingAiJobRecord,
    VoiceClipCacheRecord,
    SyncCursor,
    AppMetaEntry,
    ReferenceDataKey,
    ReferenceDataRecord,
    DayLedgerCacheRecord,
    PlannedTaskCacheRecord,
    FarmCacheRecord,
    PlotCacheRecord,
    FarmBoundaryCacheRecord,
    PlotAreaCacheRecord,
    CropCycleCacheRecord,
    CostEntryCacheRecord,
    FinanceCorrectionCacheRecord,
    AttentionCardCacheRecord,
    DexieLogRecord,
    DexieComplianceSignal,
    DexieTestProtocol,
    DexieTestInstance,
    DexieTestRecommendation,
    DexieJobCard,
    DexieWorkerProfile,
    CropRow,
    ProfileRow,
    UiPrefRow,
    AnalyticsOutboxRow,
} from './DexieDatabase.types';

export type * from './DexieDatabase.types';

// =============================================================================
// SCHEMA VERSION CONSTANTS
// =============================================================================

/** Current Dexie schema version — bump this when adding version(N).stores(). */
export const DATABASE_VERSION = 24; // §P0.4 — strip the raw transcript out of stored correction events; no index change. 23 is RESERVED for feat/dfes-companion — see versions/v24.ts.
/**
 * CEI Phase 1 schema version (now active — applied by Task 5.1.1).
 *
 * §P0.7 review N2 — `tests/storage/migrationService.test.ts` used to 'reserve'
 * this number with a pair of compile-time assertions. It was deleted: the
 * directory is in neither `tsconfig.include` (`["src"]`) nor the vitest
 * include, so nothing loaded the file and no assertion in it could ever fail —
 * one of them had been wrong since v7 and never said so. This declaration is
 * the reservation. `dexie/__tests__/dexieVersionIntegrity.test.ts` owns the
 * assertions, in a file that runs.
 */
export const CEI_PHASE1_SCHEMA_VERSION = 7;
/** CEI Phase 2 schema version — adds test stack (protocols/instances/recs). */
export const CEI_PHASE2_SCHEMA_VERSION = 8;
/** CEI Phase 3 schema version — adds compliance signals store (§4.6). RESERVED. */
export const CEI_PHASE3_SCHEMA_VERSION = 9;
/** CEI Phase 4 schema version — job cards + worker profiles (stores added in Task 6.1.1). RESERVED. */
export const CEI_PHASE4_SCHEMA_VERSION = 10;
/** Farm geography schema version — ownerAccount scoped cache tables. */
export const FARM_GEOGRAPHY_SCHEMA_VERSION = 11;
/** AI voice journal schema version — local 30-day processing clips only. */
export const AI_VOICE_JOURNAL_SCHEMA_VERSION = 12;
/** AI correction event schema version — per-bucket correction-rate signal. */
export const AI_CORRECTION_EVENTS_SCHEMA_VERSION = 13;
/** Sub-plan 04 Task 2 — crops + farmerProfile + uiPrefs unification (away from localStorage). */
export const SUBPLAN_04_FRONTEND_STORAGE_SCHEMA_VERSION = 14;
/** DWC v2 §2.6 — analytics outbox store for closure-loop telemetry. */
export const DWC_TELEMETRY_OUTBOX_SCHEMA_VERSION = 15;
/** DATA_PRINCIPLE_SPINE sub-phase 01.6 — pre_spine provenance backfill on existing logs. */
export const DATA_PRINCIPLE_SPINE_PROVENANCE_SCHEMA_VERSION = 16;
/** DATA_PRINCIPLE_SPINE sub-phase 02.7 — offline cost-entry rows migrate `category` → canonical `categoryId`. */
export const DATA_PRINCIPLE_SPINE_COST_CATEGORY_SCHEMA_VERSION = 17;
/** DATA_PRINCIPLE_SPINE sub-phase 05.3 — voice clip envelope encryption (WebCrypto AES-GCM); voiceClips row gains ciphertext/iv/wrappedDekId. */
export const DATA_PRINCIPLE_SPINE_VOICE_ENVELOPE_SCHEMA_VERSION = 18;
/** DATA_PRINCIPLE_SPINE sub-phase 06.5 — voiceClips row gains consentTokenKid (HS256 `kid` claim) for consent-audit pinning. */
export const DATA_PRINCIPLE_SPINE_CONSENT_TOKEN_KID_SCHEMA_VERSION = 19;
/** DATA_PRINCIPLE_SPINE sub-phase 10.6 (OQ-9) — `pii_redaction` correction-event type registered (TS union extension; pure-additive schema bump). */
export const DATA_PRINCIPLE_SPINE_PII_REDACTION_EVENT_SCHEMA_VERSION = 20;
/** voice-diary-e2e-2026-05-17 (D.17) — voiceClips row gains `s3RetainedKey` index for cross-reference into the retained S3 tier. */
export const VOICE_DIARY_RETAINED_KEY_SCHEMA_VERSION = 21;
/**
 * §P0.4 — correction events stop carrying verbatim speech; v24 strips it from
 * rows already on the handset.
 *
 * 24, not 23: `feat/dfes-companion` owns 23 and ships first. Dexie only runs an
 * upgrade for versions ABOVE the one on the device, so re-using 23 would have
 * meant the strip never executed on any handset that took DFES first — a
 * privacy fix that looks shipped and is not. Full reasoning in
 * `dexie/versions/v24.ts`.
 */
export const CORRECTION_EVENT_TRANSCRIPT_STRIPPED_SCHEMA_VERSION = 24;

// =============================================================================
// DATABASE CLASS
// =============================================================================

export class AgriLogDatabase extends Dexie {
    logs!: Table<DexieLogRecord, string>;
    outbox!: Table<OutboxEvent, number>;
    mutationQueue!: Table<MutationQueueItem, number>;
    attachments!: Table<AttachmentRecord, string>;
    uploadQueue!: Table<UploadQueueItem, number>;
    pendingAiJobs!: Table<PendingAiJobRecord, number>;
    voiceClips!: Table<VoiceClipCacheRecord, string>;
    aiCorrectionEvents!: Table<CorrectionEvent, string>;
    auditEvents!: Table<AuditEvent, string>;
    syncCursors!: Table<SyncCursor, string>;
    appMeta!: Table<AppMetaEntry, string>;
    referenceData!: Table<ReferenceDataRecord, ReferenceDataKey>;
    dayLedgers!: Table<DayLedgerCacheRecord, string>;
    plannedTasks!: Table<PlannedTaskCacheRecord, string>;

    farms!: Table<FarmCacheRecord, string>;
    plots!: Table<PlotCacheRecord, string>;
    farmBoundaries!: Table<FarmBoundaryCacheRecord, string>;
    plotAreas!: Table<PlotAreaCacheRecord, string>;
    cropCycles!: Table<CropCycleCacheRecord, string>;
    costEntries!: Table<CostEntryCacheRecord, string>;
    financeCorrections!: Table<FinanceCorrectionCacheRecord, string>;

    /** CEI Phase 1 — server-computed attention cards */
    attentionCards!: Table<AttentionCardCacheRecord, string>;

    /** CEI Phase 2 §4.5 — test stack */
    testProtocols!: Table<DexieTestProtocol, string>;
    testInstances!: Table<DexieTestInstance, string>;
    testRecommendations!: Table<DexieTestRecommendation, string>;

    /** CEI Phase 3 §4.6 — compliance signals */
    complianceSignals!: Table<DexieComplianceSignal, string>;

    /** CEI Phase 4 §4.8 — job cards */
    jobCards!: Table<DexieJobCard, string>;
    /** CEI Phase 4 §4.8 — worker profile cache */
    workerProfiles!: Table<DexieWorkerProfile, string>;

    /** Sub-plan 04 Task 2 — crops as Dexie rows (away from localStorage). */
    crops!: Table<CropRow, string>;
    /** Sub-plan 04 Task 2 — farmer profile singleton (away from localStorage). */
    farmerProfile!: Table<ProfileRow, 'self'>;
    /** Sub-plan 04 Task 2 — misc UI preferences key-value store. */
    uiPrefs!: Table<UiPrefRow, string>;

    /** DWC v2 §2.6 — analytics outbox; drained by `AnalyticsEventBus`. */
    analyticsOutbox!: Table<AnalyticsOutboxRow, number>;

    /**
     * @param databaseName Which IndexedDB database to open. Defaults to the one
     * every install already has; `userDatabaseName.ts` decides the rest. The
     * SCHEMA is identical either way — a per-farmer database is these same v24
     * stores under another name, which is why this needed no version bump.
     * It also means every upgrade callback runs ONCE PER FARMER DATABASE on a
     * shared device, so each one must be idempotent per database.
     */
    constructor(databaseName: string = LEGACY_DATABASE_NAME) {
        super(databaseName);

        // Schema versions are declared in dexie/versions/v{N}.ts. Each applyVN
        // call performs `this.version(N).stores({...})` (and any `.upgrade()`
        // chain). Order matters — Dexie applies migrations sequentially.
        applyV1(this);
        applyV2(this);
        applyV3(this);
        applyV4(this);
        applyV5(this);
        applyV6(this);
        applyV7(this);
        applyV8(this);
        applyV9(this);
        applyV10(this);
        applyV11(this);
        applyV12(this);
        applyV13(this);
        applyV14(this);
        applyV15(this);
        applyV16(this);
        applyV17(this);
        applyV18(this);
        applyV19(this);
        applyV20(this);
        applyV21(this);
        applyV22(this);
        // §P0.7 review C1 — THIS BRANCH MUST DECLARE v23 EVEN THOUGH IT DID NOT
        // WRITE IT, and the file is `feat/dfes-companion`'s, byte-identical.
        //
        // Dexie's schema is the UNION of the versions the running build
        // DECLARES, and `deleteRemovedTables` drops any object store the union
        // does not contain. A gap is not inert: with v23 missing from this
        // chain, opening a handset that took DFES first upgraded it to 24 and
        // SILENTLY DELETED `pendingInterpretations` and every row in it —
        // measured, verno 24, `InvalidTableError`, no error raised, upgrade
        // reported success.
        //
        // Carrying the declaration is what keeps that store alive; it is not
        // optional and it is not tidy-up-able. On a device that has never seen
        // DFES it creates one empty store this branch never touches, which
        // costs nothing. Kept BYTE-IDENTICAL to the other branch so the merge is
        // a no-op and any divergence there surfaces as a real conflict.
        applyV23(this);
        applyV24(this);
    }
}

// =============================================================================
// SINGLETON — one open handle, on the database the active farmer owns
// =============================================================================

let dbInstance: AgriLogDatabase | null = null;

/**
 * Get the singleton database instance.
 * Creates it on first call, and re-opens on the new database after a switch of
 * farmer — closing the handle it is leaving, never emptying it.
 */
export function getDatabase(): AgriLogDatabase {
    const databaseName = getActiveDatabaseName();
    if (!dbInstance || dbInstance.name !== databaseName) {
        dbInstance?.close();
        dbInstance = new AgriLogDatabase(databaseName);
    }
    return dbInstance;
}

/**
 * Drop everything held in memory and re-derive routing from durable state.
 *
 * P0.1: durable state now includes the ownership claim INSIDE `AgriLogDB`, so
 * this reads it back and repairs the localStorage mirror before anybody is
 * routed anywhere — the step that makes a cleared `localStorage` survivable.
 * The in-flight claim settles BEFORE the handle closes, because closing a Dexie
 * handle aborts its transactions and would discard the claim just written.
 *
 * @internal
 */
export async function resetDatabase(): Promise<void> {
    await settleOwnershipClaims();
    dbInstance?.close();
    dbInstance = null;
    clearResolvedDatabaseName();
    await recoverLegacyOwnershipClaim();
}
