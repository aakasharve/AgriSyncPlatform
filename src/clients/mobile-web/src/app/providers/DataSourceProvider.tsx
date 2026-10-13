import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { AppDataSource } from '../../application/ports/AppDataSource';
import { AuditPort } from '../../application/ports/AuditPort';
import { DexieDataSource } from '../../infrastructure/storage/DexieDataSource';
import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { MigrationService } from '../../infrastructure/storage/MigrationService';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { attachmentUploadWorker } from '../../infrastructure/sync/AttachmentUploadWorker';
import { voiceArchiveUploader } from '../../infrastructure/sync/VoiceArchiveUploader';
import { generateRollingDemoData, generateDemoHarvestSessions, generateDemoProcurementExpenses, DEMO_SEED_VERSION } from '../../features/demo/DemoDataService';
import { LocalStorageLogsRepository } from '../../infrastructure/storage/LocalStorageLogsRepository';
import { seedHarvestSessions } from '../../services/harvestService'; // To be refactored later
import { procurementRepository } from '../../services/procurementRepository'; // To be refactored later
import { legacyAuditPort } from '../../infrastructure/audit/LegacyAuditPort';
import { useAuth } from './AuthProvider';
import { getRootStore } from '../state/RootStore';
import { clearLabourReadoutsExcept } from '../../infrastructure/storage/LabourReadoutCache';
import { purgeExpiredLabourCaches } from '../../infrastructure/storage/labourFarmAccess';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { runLegacyLocalStorageMigration } from '../../infrastructure/storage/LegacyLocalStorageMigrator';
import { DemoModeStore } from '../../infrastructure/storage/DemoModeStore';
import { activateDatabaseForUser } from '../../infrastructure/storage/activateUserDatabase';
import { setActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../infrastructure/storage/userDatabaseName';
import { recoverLegacyOwnershipClaim, settleOwnershipClaims } from '../../infrastructure/storage/databaseOwnership';
import { getActiveDatabaseName } from '../../infrastructure/storage/activeDatabaseName';
import { sweepExpiredDownloadedLabour, sweepOtherLocalDatabases } from '../../infrastructure/storage/downloadedLabourCache';
import { purgeExpiredProcessingVoiceClips } from '../../infrastructure/voice/VoiceClipRetention';

// --- CONTEXT ---

interface DataSourceContextValue {
    dataSource: AppDataSource;
    auditPort: AuditPort;
    isDemoMode: boolean;
    setDemoMode: (enabled: boolean) => Promise<void>;
    isLoading: boolean;
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

// --- PROVIDER ---

export const DataSourceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated, session } = useAuth();
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

    const dataSource = useMemo(() => {
        storageNamespace.setNamespace('user');
        return DexieDataSource.getInstance();
    }, []);

    // Helper: Seeding Logic (moved from useAppData to keep Data logic contained)
    const seedDemoDataIfNeeded = async () => {
        const demoRepo = LocalStorageLogsRepository.getInstance(); // Access directly or via dataSource.logs
        // Version Check & Reset
        const currentVersion = DemoModeStore.getDemoDataVersion();

        if (currentVersion !== DEMO_SEED_VERSION) {
            console.log(`[DataSource] Demo Data Version Mismatch (${currentVersion} vs ${DEMO_SEED_VERSION}). Resetting...`);
            await demoRepo.clearAll();
            // T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01): Dexie crops is
            // the source of truth post-cutover. The legacy localStorage clear
            // stays as defense-in-depth for pre-migration installs.
            await getDatabase().crops.clear();
            DemoModeStore.clearLegacyCrops();

            // Clear Procurement
            DemoModeStore.clearProcurementExpenses();

            // Clear Harvest & Other Income
            DemoModeStore.clearHarvestOtherIncome();

            // Clear Finance Events (MoneyEvents)
            DemoModeStore.clearMoneyEvents();

            // Clear Sessions/Configs for all potential plots
            const crops = await dataSource.crops.getAll();
            const effectiveCrops = crops;

            effectiveCrops.forEach(c => {
                c.plots.forEach(p => {
                    DemoModeStore.clearHarvestConfig(p.id);
                    DemoModeStore.clearHarvestSessions(p.id, c.id);
                });
            });

            DemoModeStore.setDemoDataVersion(DEMO_SEED_VERSION);
        }

        const count = await demoRepo.count();

        if (count === 0) {
            console.log("[DataSource] Seeding Demo Data...");
            const crops = await dataSource.crops.getAll();
            const effectiveCrops = crops;

            // 1. Logs
            const logs = generateRollingDemoData(effectiveCrops);
            await demoRepo.batchSave(logs);

            // 1b. Generate Finance Events (Handled internally by DemoDataService now)

            // 2. Harvest (Legacy Service call for now)
            const harvestSessions = generateDemoHarvestSessions();
            seedHarvestSessions(harvestSessions);

            // 3. Procurement (Legacy Service call for now)
            const expenses = generateDemoProcurementExpenses();
            expenses.forEach(e => procurementRepository.saveExpense(e));
        }
    };

    const handleSetDemoMode = async (enabled: boolean) => {
        if (enabled === isDemoMode) return;
        setIsDemoMode(enabled);
        // Effect will trigger switch
    };

    // Handle Mode Switching & Initialization
    useEffect(() => {
        // A newer run supersedes this one (user/mode changed while it was still
        // awaiting): a superseded run must not activate a database, start
        // workers or clear the loading flag after the newer run has taken over.
        let cancelled = false;
        const init = async () => {
            setIsLoading(true);
            try {
                console.log(`[DataSource] Initializing ${isDemoMode ? 'DEMO' : 'REAL'} mode`);
                // Drain, don't just stop: the PREVIOUS user's in-flight cycle must
                // finish before the sync badge is reset and the database address
                // changes, or it could emit a stale rejection / touch B's rows.
                await Promise.all([backgroundSyncWorker.stop(), attachmentUploadWorker.stop(), voiceArchiveUploader.stop()]);
                if (cancelled) return;
                // The signed-in user changed (or signed out): the sync badge's
                // in-memory rejected list belongs to the PREVIOUS user. Forget
                // it; the new user's own parked rows are re-announced from THEIR
                // database when the worker starts. Nothing is deleted.
                getRootStore().sync.send({ type: 'RESET' });
                storageNamespace.setNamespace(isDemoMode ? 'demo' : 'user');
                // A farmer's records live in a database of their own, so that a
                // second farmer signing in on this handset is a change of
                // ADDRESS and not a deletion. This runs before anything reads
                // or writes — including the two localStorage imports below,
                // which must land in the database that owns those rows.
                //
                // P0.1 — READ THE OWNERSHIP CLAIM BACK FIRST.
                // Which farmer owns `AgriLogDB` now lives inside `AgriLogDB`
                // (`appMeta.owner_user_id`), not only in localStorage. A farmer
                // who cleared browser storage deleted the COPY of that answer,
                // not the answer; routing before reading it back is precisely
                // what handed the incumbent's database — worker names included
                // — to the next person who signed in. Nothing in this recovery
                // deletes anything: it repairs one localStorage key.
                //
                // Then wait for the claim to be written-or-verified, so the two
                // localStorage imports below cannot pour one farmer's rows into
                // another farmer's database while that check is still in flight.
                if (!isDemoMode && session?.userId) {
                    await recoverLegacyOwnershipClaim();
                    if (cancelled) return;
                    activateDatabaseForUser(session.userId);
                    // Offline Labour read-outs are per user: erase any other user's.
                    clearLabourReadoutsExcept(session.userId);
                    // 7-day cap on cached Labour names: purge expired copies at boot.
                    purgeExpiredLabourCaches();
                    await settleOwnershipClaims();
                    // Same 7-day cap in the IndexedDB stores (marks, names in logs, team list,
                    // last-pull snapshot) and in every OTHER farmer's database on this handset.
                    // Awaited so no screen reads before the sweep; best-effort, never blocks boot.
                    await sweepExpiredDownloadedLabour().catch((e) => console.warn('[DataSource] labour cache sweep failed', e));
                    await sweepOtherLocalDatabases(getActiveDatabaseName()).catch(() => undefined);
                } else if (!isDemoMode) {
                    // Signed out / not yet identified: no farmer's database may stay
                    // open (same invariant as endFarmerSessionLocally). Without this
                    // the worker's rehydrate would re-announce the PREVIOUS user's
                    // parked rows from the database still pointed at.
                    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
                    await sweepOtherLocalDatabases(UNIDENTIFIED_DATABASE_NAME).catch(() => undefined);
                }
                await dataSource.initialize();
                await MigrationService.migrate();
                // T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01): one-time
                // backfill of legacy localStorage crops + farmer_profile into
                // Dexie. The migrator is gated by its own once-only flag and
                // is a no-op on subsequent boots. Runs AFTER MigrationService
                // (so Dexie has the right schema) and BEFORE the demo/real
                // branch (so both modes see the imported data on first boot).
                await runLegacyLocalStorageMigration();
                if (isDemoMode) {
                    await seedDemoDataIfNeeded();
                } else {
                    await purgeExpiredProcessingVoiceClips();
                    if (cancelled) return;
                    backgroundSyncWorker.start();
                    attachmentUploadWorker.start();
                    voiceArchiveUploader.start();
                }
            } catch (error) {
                console.error("[DataSource] Init failed", error);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        init();

        return () => {
            cancelled = true;
            backgroundSyncWorker.stop();
            attachmentUploadWorker.stop();
            voiceArchiveUploader.stop();
        };
        // `seedDemoDataIfNeeded` is deliberately absent: it is re-created on
        // every render, so listing it would re-run this effect in a loop — a
        // behaviour change, and strictly worse than the lint debt. PRE-EXISTING:
        // the file emitted this same single warning before this change (verified
        // against the unmodified file at 16a314a6). Scoped to this one rule on
        // this one line; nothing else is silenced.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, isDemoMode, dataSource, session?.userId]);

    const value: DataSourceContextValue = {
        dataSource,
        auditPort: legacyAuditPort,
        isDemoMode,
        setDemoMode: handleSetDemoMode,
        isLoading
    };

    if (isLoading) {
        return (
            <DataSourceContext.Provider value={value}>
                <div className="min-h-screen flex items-center justify-center bg-surface-100">
                    <div className="animate-pulse text-stone-400 text-sm font-medium">Loading...</div>
                </div>
            </DataSourceContext.Provider>
        );
    }

    return (
        <DataSourceContext.Provider value={value}>
            {children}
        </DataSourceContext.Provider>
    );
};

// --- HOOK ---

export const useDataSource = (): DataSourceContextValue => {
    const context = useContext(DataSourceContext);
    if (!context) {
        throw new Error('useDataSource must be used within a DataSourceProvider');
    }
    return context;
};
