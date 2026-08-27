import { useState, useEffect } from 'react';
import {
    CropProfile, FarmerProfile, DailyLog, PlannedTask, LedgerDefaults,
    ResourceItem, Person, VerificationStatus, OperatorCapability
} from '../../types';
import { useDataSource } from '../providers/DataSourceProvider';
import { HarvestSession } from '../../features/logs/harvest.types';
import { ProcurementExpense } from '../../features/procurement/procurement.types';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { useAuth } from '../providers/AuthProvider';
import { generateDemoHarvestSessions, generateDemoPlannedTasks, generateDemoProcurementExpenses } from '../../features/demo/DemoDataService';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

const PLANNED_TASKS_META_KEY = 'agrisync_local_planned_tasks_v1';

export interface UseAppDataResult {
    // State
    isDemoMode: boolean;
    setIsDemoMode: (val: boolean) => void;
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
    farmerProfile: FarmerProfile;
    setFarmerProfile: React.Dispatch<React.SetStateAction<FarmerProfile>>;

    // Abstracted History (Replacing mockHistory/realHistory)
    history: DailyLog[];
    setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;

    /**
     * Whether a hydration pass has actually COMPLETED — i.e. whether an
     * empty `history`/`crops` is a measured empty or an unfilled initial
     * value. spec: owner-oversight-loop, finding F7(a). See the state
     * declaration inside the hook for the full reasoning; read it only if
     * you turn the ABSENCE of records into a positive claim.
     */
    dataLoaded: boolean;

    // Deprecated, kept for compatibility
    mockHistory: DailyLog[];
    realHistory: DailyLog[];
    setMockHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;
    setRealHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;

    // Auxiliary Data
    ledgerDefaults: LedgerDefaults;
    setLedgerDefaults: (val: LedgerDefaults) => void;
    userResources: ResourceItem[];
    setUserResources: React.Dispatch<React.SetStateAction<ResourceItem[]>>;
    plannedTasks: PlannedTask[];
    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;

    // Income & Procurement (Demo Data - TODO: Move to DataSource)
    harvestSessions: HarvestSession[];
    setHarvestSessions: React.Dispatch<React.SetStateAction<HarvestSession[]>>;
    procurementExpenses: ProcurementExpense[];
    setProcurementExpenses: React.Dispatch<React.SetStateAction<ProcurementExpense[]>>;

    // Handlers
    handleUpdateCrops: (newCrops: CropProfile[]) => void;
    handleAddPerson: (person: Person) => void;
    handleDeletePerson: (id: string) => void;
    handleSaveTask: (task: PlannedTask) => void;
    handleUpdateTask: (id: string, updates: Partial<PlannedTask>) => void;

    // UI State
    showTaskCreationSheet: boolean;
    setShowTaskCreationSheet: (val: boolean) => void;
}

interface UseAppDataProps {
    initialCrops?: CropProfile[];  // Deprecated: crops now loaded based on demo mode
    onNewPlotDetected?: (newPlotId: string, parentCropId: string) => void;
}

/**
 * The profile a farmer's device actually holds on day one — BEFORE the first
 * sync pull has ever returned an operator. Its `activeOperatorId` is the
 * literal string `'owner'`, not a server id; the three operators here are
 * placeholders so the UI has names to render.
 *
 * WAVE-1.4 (spec: dfes-companion-2026-07-11): extracted from the `useState`
 * initialiser and EXPORTED so tests can drive the real day-one state instead
 * of a hand-made GUID fixture. A fixture that invents a UUID here cannot see
 * the bugs this placeholder causes — that is exactly how the approve button
 * shipped broken. Also now a lazy initialiser, so it is built once per mount
 * rather than on every render.
 */
export function createInitialFarmerProfile(): FarmerProfile {
    return {
        // It used to be a stranger's: name "Shetkari Raja", village "Nashik", and
        // three invented colleagues — "Suresh (Manager)" and "Agronomist" — carrying
        // phone numbers that belong to somebody. None of it was behind a demo guard
        // (the real demo seed IS gated, in `purveshDemoEnrichment.ts`), so every new
        // farmer opened the app to another man's identity and had to work out that
        // the app did not know who he was.
        //
        // `P4`/`P5` — an empty field that says "—" is honest; a filled one that is
        // wrong is not. IdentitySection already renders `profile.name || '—'` and has
        // an empty-operators branch, so blank needs no new UI.
        //
        // The single `owner` operator STAYS, and so does `activeOperatorId: 'owner'`:
        // that id is a load-bearing identity check (`isOwner` in `LogFactory` and
        // `log-partition-builders` partitions logs on it), and "Owner" is a role, not
        // a claimed person. The sync pull replaces this list with real operators.
        //
        // evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 3
        name: '',
        village: '',
        phone: '',
        language: 'mr',
        verificationStatus: VerificationStatus.Unverified,
        operators: [
            {
                id: 'owner',
                name: 'Owner',
                role: 'PRIMARY_OWNER',
                capabilities: Object.values(OperatorCapability) as OperatorCapability[],
                isVerifier: true,
                isActive: true
            }
        ],
        activeOperatorId: 'owner',
        waterResources: [],
        motors: [],
        electricityTiming: {
            singlePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [],
                weekBOffWindows: []
            },
            threePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [],
                weekBOffWindows: []
            },
            updatedAt: new Date().toISOString()
        },
        // 20.0N 73.8E is Nashik, and `source: 'manual'` claimed the FARMER had
        // set it. He had not. It is not a cosmetic default either: weather
        // resolution goes farm centre → profile location → device GPS
        // (`useWeatherMonitor.ts`), so this stamp sat AHEAD of his real GPS and a
        // farmer in Sangli was shown Nashik's forecast — with no way to tell.
        //
        // 0/0/'unknown' is the sentinel the sync reconciler already uses for
        // "we don't know yet" (`profileAndCropsReconciler.ts`), and both the
        // profile and device paths in useWeatherMonitor explicitly reject it, so
        // the fallback chain now runs on to the farmer's actual location.
        location: {
            lat: 0,
            lon: 0,
            source: 'unknown',
            updatedAt: new Date().toISOString()
        },
        infrastructure: {
            waterManagement: 'Decentralized',
            filtrationType: 'Screen'
        }
    };
}

export const useAppData = (_props?: UseAppDataProps): UseAppDataResult => {
    // --- DATA SOURCE INTEGRATION ---
    const { dataSource, isDemoMode, setDemoMode } = useDataSource();
    const { isAuthenticated } = useAuth();

    // --- LOCAL STATE (Mirrors DataSource) ---
    // Start with empty crops - will be populated based on demo mode
    const [crops, setCrops] = useState<CropProfile[]>([]);
    // Separate state for user's real crops (persisted). Written by the hydrate
    // effect; nothing reads it, so the value binding is elided rather than
    // named — the setter call stays exactly as it was.
    const [, setRealCrops] = useState<CropProfile[]>([]);
    const [farmerProfile, setFarmerProfile] = useState<FarmerProfile>(createInitialFarmerProfile);
    const [history, setHistory] = useState<DailyLog[]>([]);

    // --- AUXILIARY STATE ---
    const [ledgerDefaults, setLedgerDefaults] = useState<LedgerDefaults>({
        irrigation: { method: 'Drip', source: 'Well', defaultDuration: 60 },
        labour: { defaultWage: 400, defaultHours: 8, shifts: [] },
        machinery: { defaultRentalCost: 1000, defaultFuelCost: 100 }
    });
    const [userResources, setUserResources] = useState<ResourceItem[]>([]);

    // --- TODO: Move these to DataSource/Repositories ---
    const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([]);
    const [harvestSessions, setHarvestSessions] = useState<HarvestSession[]>([]);
    const [procurementExpenses, setProcurementExpenses] = useState<ProcurementExpense[]>([]);

    // --- UI STATE ---
    const [showTaskCreationSheet, setShowTaskCreationSheet] = useState(false);

    /**
     * Whether the load effect below has actually FINISHED a hydration pass —
     * i.e. whether an empty `history`/`crops` is a measured empty or just an
     * unfilled initial value.
     *
     * spec: owner-oversight-loop, finding F7(a). Everything this hook returns
     * starts empty and fills in asynchronously. A surface that turns "no
     * records" into a positive claim — the oversight strip's rest state, a
     * green tick reading "आज पर्यन्त सर्व कामे पूर्ण आहेत" ("all work is
     * complete as of today") — would otherwise make that claim during the
     * first-load window, from data nobody has read yet. Consumers that only
     * RENDER the data (every existing one) are unaffected and need not read
     * this; consumers that make a claim FROM ITS ABSENCE must.
     *
     * Set only after a hydration pass completes. `loadData`'s `catch` leaves
     * it false on purpose: a failed load has proven nothing.
     */
    const [dataLoaded, setDataLoaded] = useState(false);

    // --- LOAD DATA EFFECT ---
    useEffect(() => {
        let mounted = true;

        const hydrateRealData = async () => {
            const db = getDatabase();
            const loadedCrops = await dataSource.crops.getAll();
            if (!mounted) return;

            setCrops(loadedCrops.length > 0 ? loadedCrops : []);
            setRealCrops(loadedCrops);

            const loadedProfile = await dataSource.profile.get();
            if (!mounted) return;
            if (loadedProfile && loadedProfile.name) {
                setFarmerProfile(loadedProfile);
            }

            const loadedLogs = await dataSource.logs.getAll();
            if (!mounted) return;
            setHistory(loadedLogs);

            const plannedTasksMeta = await db.appMeta.get(PLANNED_TASKS_META_KEY);
            if (!mounted) return;
            setPlannedTasks(Array.isArray(plannedTasksMeta?.value) ? plannedTasksMeta.value as PlannedTask[] : []);
            setHarvestSessions([]);
            setProcurementExpenses([]);
            // Last line of the pass, after every `await` above resolved —
            // see `dataLoaded`'s own doc comment (finding F7(a)).
            setDataLoaded(true);
        };

        const loadData = async () => {
            try {
                if (isDemoMode) {
                    const loadedCrops = await dataSource.crops.getAll();

                    if (mounted) {
                        setCrops(loadedCrops);
                        setPlannedTasks(generateDemoPlannedTasks());
                        setHarvestSessions(generateDemoHarvestSessions());
                        setProcurementExpenses(generateDemoProcurementExpenses());
                    }

                    // Load demo logs
                    const loadedLogs = await dataSource.logs.getAll();
                    if (mounted) setHistory(loadedLogs);

                    // Load demo profile or use default
                    const loadedProfile = await dataSource.profile.get();
                    if (mounted && loadedProfile && loadedProfile.name) {
                        setFarmerProfile(loadedProfile);
                    }
                    // Demo branch's own completion point (finding F7(a)).
                    if (mounted) setDataLoaded(true);
                } else {
                    if (isAuthenticated) {
                        await backgroundSyncWorker.triggerNow();
                    }

                    await hydrateRealData();
                }
            } catch (err) {
                console.error("Failed to load app data", err);
            }
        };

        const handleSyncReconciled = () => {
            if (!isDemoMode) {
                void hydrateRealData();
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('agrisync:sync-reconciled', handleSyncReconciled);
        }

        loadData();

        return () => {
            mounted = false;
            if (typeof window !== 'undefined') {
                window.removeEventListener('agrisync:sync-reconciled', handleSyncReconciled);
            }
        };
    }, [dataSource, isDemoMode, isAuthenticated]);

    useEffect(() => {
        if (isDemoMode) {
            return;
        }

        const persistPlannedTasks = async () => {
            try {
                const db = getDatabase();
                await db.appMeta.put({
                    key: PLANNED_TASKS_META_KEY,
                    value: plannedTasks,
                    updatedAt: new Date().toISOString(),
                });
            } catch (error) {
                console.error('Failed to persist planned tasks', error);
            }
        };

        void persistPlannedTasks();
    }, [plannedTasks, isDemoMode]);

    // --- HANDLERS ---

    const handleUpdateCrops = async (newCrops: CropProfile[]) => {
        setCrops(newCrops);
        await dataSource.crops.save(newCrops);
    };

    const handleAddPerson = (person: Person) => {
        setFarmerProfile(prev => ({
            ...prev,
            operators: [...(prev.operators || []), {
                id: person.id || `op_${Date.now()}`,
                name: person.name,
                role: person.role === 'SECONDARY_OWNER' ? 'SECONDARY_OWNER' : 'WORKER',
                phone: person.phone,
                capabilities: [OperatorCapability.LOG_DATA],
                isVerifier: false,
                isActive: true
            }]
        }));
    };

    const handleDeletePerson = (id: string) => {
        setFarmerProfile(prev => ({
            ...prev,
            operators: (prev.operators || []).filter(op => op.id !== id)
        }));
    };

    const handleSaveTask = (task: PlannedTask) => {
        setPlannedTasks(prev => {
            const exists = prev.find(p => p.id === task.id);
            if (exists) return prev.map(p => p.id === task.id ? task : p);
            return [...prev, task];
        });
        // TODO: dataSource.tasks.save(task);
    };

    const handleUpdateTask = (id: string, updates: Partial<PlannedTask>) => {
        setPlannedTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
        // TODO: dataSource.tasks.update(id, updates);
    };

    return {
        isDemoMode,
        setIsDemoMode: (val: boolean) => {
            void setDemoMode(val); // Fire and forget promise handling
        }, // Adapts provider to hook interface
        crops, setCrops,
        farmerProfile, setFarmerProfile,

        // Aliases for compatibility
        mockHistory: history,
        realHistory: history,
        history,
        setHistory, // Unified setter
        setMockHistory: setHistory,
        setRealHistory: setHistory,

        // spec: owner-oversight-loop, finding F7(a) — see this flag's own
        // declaration above. Read it before turning "no records" into a
        // positive claim; ignore it if you only render the records.
        dataLoaded,

        ledgerDefaults, setLedgerDefaults,
        userResources, setUserResources,
        plannedTasks, setPlannedTasks,
        harvestSessions, setHarvestSessions,
        procurementExpenses, setProcurementExpenses,

        handleUpdateCrops,
        handleAddPerson, handleDeletePerson,
        handleSaveTask, handleUpdateTask,
        showTaskCreationSheet, setShowTaskCreationSheet
    };
};
