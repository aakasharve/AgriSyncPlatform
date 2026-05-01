import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { AppDataSource } from '../../application/ports/AppDataSource';
import { AuditPort } from '../../application/ports/AuditPort';
import { DexieDataSource } from '../../infrastructure/storage/DexieDataSource';
import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { MigrationService } from '../../infrastructure/storage/MigrationService';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { attachmentUploadWorker } from '../../infrastructure/sync/AttachmentUploadWorker';
import { generateRollingDemoData, generateDemoHarvestSessions, generateDemoProcurementExpenses, DEMO_SEED_VERSION } from '../../features/demo/DemoDataService';
import { LocalStorageLogsRepository } from '../../infrastructure/storage/LocalStorageLogsRepository';
import { seedHarvestSessions } from '../../services/harvestService'; // To be refactored later
import { procurementRepository } from '../../services/procurementRepository'; // To be refactored later
import { legacyAuditPort } from '../../infrastructure/audit/LegacyAuditPort';
import { useAuth } from './AuthProvider';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { runLegacyLocalStorageMigration } from '../../infrastructure/storage/LegacyLocalStorageMigrator';
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

const ACTIVE_USER_ID_KEY = 'agrisync_active_user_id_v1';
const REAL_MODE_LOCAL_STORAGE_KEYS = [
    'crops',
    'farmer_profile',
] as const;

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
        const versionKey = storageNamespace.getKey('demo_data_version');
        const currentVersion = localStorage.getItem(versionKey);

        if (currentVersion !== DEMO_SEED_VERSION) {
            console.log(`[DataSource] Demo Data Version Mismatch (${currentVersion} vs ${DEMO_SEED_VERSION}). Resetting...`);
            await demoRepo.clearAll();
            // T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01): Dexie crops is
            // the source of truth post-cutover. The legacy localStorage
            // 'crops' removal stays as defense-in-depth (legacy entries may
            // still exist from pre-migration installs).
            await getDatabase().crops.clear();
            localStorage.removeItem(storageNamespace.getKey('crops'));

            // Clear Procurement
            localStorage.removeItem(storageNamespace.getKey('dfes_procurement_expenses'));

            // Clear Harvest & Other Income
            localStorage.removeItem(storageNamespace.getKey('harvest_other_income'));

            // Clear Finance Events (MoneyEvents)
            localStorage.removeItem(storageNamespace.getKey('money_events'));

            // Clear Sessions/Configs for all potential plots
            const crops = await dataSource.crops.getAll();
            const effectiveCrops = crops;

            effectiveCrops.forEach(c => {
                c.plots.forEach(p => {
                    localStorage.removeItem(storageNamespace.getKey(`harvest_config_${p.id}`));
                    localStorage.removeItem(storageNamespace.getKey(`harvest_sessions_${p.id}_${c.id}`));
                });
            });

            localStorage.setItem(versionKey, DEMO_SEED_VERSION);
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

    const resetAuthenticatedUserCacheIfNeeded = async (nextUserId: string) => {
        const previousUserId = localStorage.getItem(ACTIVE_USER_ID_KEY);
        if (previousUserId === nextUserId) {
            return;
        }

        console.info(`[DataSource] Authenticated user changed (${previousUserId ?? 'none'} -> ${nextUserId}). Resetting cached user state.`);

        const db = getDatabase();
        await db.transaction('rw', [
            db.logs,
            db.outbox,
            db.mutationQueue,
            db.attachments,
            db.uploadQueue,
            db.pendingAiJobs,
            db.voiceClips,
            db.aiCorrectionEvents,
            db.auditEvents,
            db.syncCursors,
            db.appMeta,
            db.referenceData,
            db.dayLedgers,
            db.plannedTasks,
            db.farms,
            db.plots,
            db.cropCycles,
            db.costEntries,
            db.financeCorrections,
            // T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01): Dexie crops +
            // farmerProfile are now the source of truth for those surfaces.
            // User-switch must clear them along with the rest of the
            // per-user cache.
            db.crops,
            db.farmerProfile,
        ], async () => {
            await Promise.all([
                db.logs.clear(),
                db.outbox.clear(),
                db.mutationQueue.clear(),
                db.attachments.clear(),
                db.uploadQueue.clear(),
                db.pendingAiJobs.clear(),
                db.voiceClips.clear(),
                db.aiCorrectionEvents.clear(),
                db.auditEvents.clear(),
                db.syncCursors.clear(),
                db.appMeta.clear(),
                db.referenceData.clear(),
                db.dayLedgers.clear(),
                db.plannedTasks.clear(),
                db.farms.clear(),
                db.plots.clear(),
                db.cropCycles.clear(),
                db.costEntries.clear(),
                db.financeCorrections.clear(),
                db.crops.clear(),
                db.farmerProfile.clear(),
            ]);
        });

        // Defense-in-depth: clear the legacy localStorage entries too. The
        // migrator left them in place as a safety net; on user-switch we
        // clear them so the next user's first boot doesn't accidentally
        // re-import the previous user's data via the migrator's once-only
        // flag (the flag is also reset implicitly because the next boot
        // sees no localStorage source data to import).
        for (const baseKey of REAL_MODE_LOCAL_STORAGE_KEYS) {
            localStorage.removeItem(storageNamespace.getKey(baseKey));
        }

        localStorage.setItem(ACTIVE_USER_ID_KEY, nextUserId);
    };

    // Handle Mode Switching & Initialization
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                console.log(`[DataSource] Initializing ${isDemoMode ? 'DEMO' : 'REAL'} mode`);
                backgroundSyncWorker.stop();
                attachmentUploadWorker.stop();
                storageNamespace.setNamespace(isDemoMode ? 'demo' : 'user');
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
                    if (session?.userId) {
                        await resetAuthenticatedUserCacheIfNeeded(session.userId);
                    }
                    await purgeExpiredProcessingVoiceClips();
                    backgroundSyncWorker.start();
                    attachmentUploadWorker.start();
                }
            } catch (error) {
                console.error("[DataSource] Init failed", error);
            } finally {
                setIsLoading(false);
            }
        };

        init();

        return () => {
            backgroundSyncWorker.stop();
            attachmentUploadWorker.stop();
        };
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
