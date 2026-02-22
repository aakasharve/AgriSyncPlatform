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

export const useAppData = (_props?: UseAppDataProps): UseAppDataResult => {
    // --- DATA SOURCE INTEGRATION ---
    const { dataSource, isDemoMode, setDemoMode } = useDataSource();
    const { isAuthenticated } = useAuth();

    // --- LOCAL STATE (Mirrors DataSource) ---
    // Start with empty crops - will be populated based on demo mode
    const [crops, setCrops] = useState<CropProfile[]>([]);
    // Separate state for user's real crops (persisted)
    const [realCrops, setRealCrops] = useState<CropProfile[]>([]);
    const [farmerProfile, setFarmerProfile] = useState<FarmerProfile>({
        name: 'Shetkari Raja',
        village: 'Nashik',
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
            },
            {
                id: 'manager1',
                name: 'Suresh (Manager)',
                role: 'SECONDARY_OWNER',
                capabilities: [OperatorCapability.VIEW_ALL, OperatorCapability.LOG_DATA, OperatorCapability.APPROVE_LOGS],
                isVerifier: true,
                isActive: true,
                phone: '9876543210'
            },
            {
                id: 'verifier1',
                name: 'Agronomist',
                role: 'WORKER',
                capabilities: [OperatorCapability.VIEW_ALL, OperatorCapability.APPROVE_LOGS],
                isVerifier: true,
                isActive: true,
                phone: '9876543211'
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
        location: {
            lat: 20.0,
            lon: 73.8,
            source: 'manual',
            updatedAt: new Date().toISOString()
        },
        infrastructure: {
            waterManagement: 'Decentralized',
            filtrationType: 'Screen'
        }
    });
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

    // --- LOAD DATA EFFECT ---
    useEffect(() => {
        let mounted = true;

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
                } else {
                    if (isAuthenticated) {
                        await backgroundSyncWorker.triggerNow();
                    }

                    // REAL MODE: Load user's actual data (may be empty)
                    const loadedCrops = await dataSource.crops.getAll();

                    // Only use loaded crops if they exist, otherwise empty
                    setCrops(loadedCrops.length > 0 ? loadedCrops : []);
                    setRealCrops(loadedCrops);

                    // Load real profile
                    const loadedProfile = await dataSource.profile.get();
                    if (loadedProfile && loadedProfile.name) {
                        setFarmerProfile(loadedProfile);
                    }

                    // Load real logs
                    const loadedLogs = await dataSource.logs.getAll();
                    setHistory(loadedLogs);

                    // Clear demo aux data
                    setPlannedTasks([]);
                    setHarvestSessions([]);
                    setProcurementExpenses([]);
                }
            } catch (err) {
                console.error("Failed to load app data", err);
            }
        };

        loadData();

        return () => { mounted = false; };
    }, [dataSource, isDemoMode, isAuthenticated]);

    // --- HANDLERS ---

    const handleUpdateCrops = async (newCrops: CropProfile[]) => {
        setCrops(newCrops);
        await dataSource.crops.save(newCrops);
    };

    const handleAddPerson = (person: Person) => {
        // TODO: Persist to generic 'PeopleRepository'
        console.log("Adding person", person);
    };

    const handleDeletePerson = (id: string) => {
        console.log("Deleting person", id);
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
        setIsDemoMode: (val) => setDemoMode(val), // Adapts provider to hook interface
        crops, setCrops,
        farmerProfile, setFarmerProfile,

        // Aliases for compatibility
        mockHistory: history,
        realHistory: history,
        history,
        setHistory, // Unified setter
        setMockHistory: setHistory,
        setRealHistory: setHistory,

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
