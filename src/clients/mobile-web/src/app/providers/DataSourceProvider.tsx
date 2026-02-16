import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { AppDataSource } from '../../application/ports/AppDataSource';
import { AuditPort } from '../../application/ports/AuditPort';
import { DexieDataSource } from '../../infrastructure/storage/DexieDataSource';
import { DemoDataSource } from '../../infrastructure/storage/DemoDataSource';
import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { MigrationService } from '../../infrastructure/storage/MigrationService';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { generateRollingDemoData, generateDemoHarvestSessions, generateDemoProcurementExpenses, captureMoneyEventsFromLog, DEMO_SEED_VERSION } from '../../features/demo/DemoDataService';
import { LocalStorageLogsRepository } from '../../infrastructure/storage/LocalStorageLogsRepository';
import { seedHarvestSessions } from '../../services/harvestService'; // To be refactored later
import { procurementRepository } from '../../services/procurementRepository'; // To be refactored later
import { RAMUS_FARM } from '../../data/farmData'; // Default crops for seeding
import { legacyAuditPort } from '../../infrastructure/audit/LegacyAuditPort';
import { useAuth } from './AuthProvider';

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
    const { isAuthenticated } = useAuth();
    // Start in Demo Mode unless user is already authenticated
    const [isDemoMode, setIsDemoMode] = useState<boolean>(!isAuthenticated);
    const [isLoading, setIsLoading] = useState<boolean>(true); // Start loading until first init completes

    // Select Source based on Mode — SYNCHRONOUSLY set namespace here
    // to prevent race conditions (children effects run before parent effects)
    const dataSource = useMemo(() => {
        storageNamespace.setNamespace(isDemoMode ? 'demo' : 'user');
        console.log(`[DataSource] Namespace set to '${isDemoMode ? 'demo' : 'user'}' (sync)`);
        return isDemoMode ? DemoDataSource.getInstance() : DexieDataSource.getInstance();
    }, [isDemoMode]);

    // Auto-switch mode based on authentication state
    useEffect(() => {
        if (isAuthenticated && isDemoMode) {
            console.log("[DataSource] User authenticated, switching to REAL mode");
            setIsDemoMode(false);
        } else if (!isAuthenticated && !isDemoMode) {
            console.log("[DataSource] User logged out, switching to DEMO mode");
            setIsDemoMode(true);
        }
    }, [isAuthenticated]);

    // Helper: Seeding Logic (moved from useAppData to keep Data logic contained)
    const seedDemoDataIfNeeded = async () => {
        const demoRepo = LocalStorageLogsRepository.getInstance(); // Access directly or via dataSource.logs
        // Version Check & Reset
        const versionKey = storageNamespace.getKey('demo_data_version');
        const currentVersion = localStorage.getItem(versionKey);

        if (currentVersion !== DEMO_SEED_VERSION) {
            console.log(`[DataSource] Demo Data Version Mismatch (${currentVersion} vs ${DEMO_SEED_VERSION}). Resetting...`);
            await demoRepo.clearAll();
            localStorage.removeItem(storageNamespace.getKey('crops'));

            // Clear Procurement
            localStorage.removeItem(storageNamespace.getKey('dfes_procurement_expenses'));

            // Clear Harvest & Other Income
            localStorage.removeItem(storageNamespace.getKey('harvest_other_income'));

            // Clear Finance Events (MoneyEvents)
            localStorage.removeItem(storageNamespace.getKey('money_events'));

            // Clear Sessions/Configs for all potential plots
            const crops = await dataSource.crops.getAll();
            const effectiveCrops = crops.length > 0 ? crops : RAMUS_FARM;

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
            const crops = await dataSource.crops.getAll(); // Might be empty if never set? Use RAMUS_FARM defaults?
            const effectiveCrops = crops.length > 0 ? crops : RAMUS_FARM;

            // 1. Logs
            const logs = generateRollingDemoData(effectiveCrops);
            await demoRepo.batchSave(logs);

            // 1b. Generate Finance Events
            logs.forEach(log => captureMoneyEventsFromLog(log));

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
        const switchMode = async () => {
            setIsLoading(true);
            try {
                if (isDemoMode) {
                    console.log("[DataSource] Switching to DEMO mode");
                    backgroundSyncWorker.stop();
                    // Namespace already set synchronously in useMemo
                    await dataSource.initialize();

                    // Helper: Auto-Seed Demo Data if empty
                    await seedDemoDataIfNeeded();

                } else {
                    console.log("[DataSource] Switching to REAL mode");
                    // Namespace already set synchronously in useMemo
                    await dataSource.initialize();

                    // Run Migrations if needed
                    await MigrationService.migrate();
                    backgroundSyncWorker.start();
                }
            } catch (error) {
                console.error("[DataSource] Switch failed", error);
            } finally {
                setIsLoading(false);
            }
        };

        switchMode();

        return () => {
            backgroundSyncWorker.stop();
        };
    }, [isDemoMode, dataSource]);

    const value: DataSourceContextValue = {
        dataSource,
        auditPort: legacyAuditPort,
        isDemoMode,
        setDemoMode: handleSetDemoMode,
        isLoading
    };

    // Gate children: Don't render until initialization is complete
    // This prevents useAppData from loading data with stale/uninitialized state
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
