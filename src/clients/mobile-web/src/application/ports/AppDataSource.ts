import { LogsRepository } from './index';
import { CropProfile, FarmerProfile } from '../../types';

// Define auxiliary repositories here for now, or move to separate files
export interface CropRepository {
    getAll(): Promise<CropProfile[]>;
    /** Replace-all: the download's own write. */
    save(crops: CropProfile[]): Promise<void>;
    /**
     * Repair FIX-2 - a screen's save: `merge` is handed the list as stored now and its answer is written, in one transaction.
     * Optional: a store without it is merged by its caller from `getAll()` (the same merge, not in one transaction).
     */
    saveMerged?(merge: (stored: CropProfile[]) => CropProfile[]): Promise<CropProfile[]>;
}

export interface ProfileRepository {
    get(): Promise<FarmerProfile>;
    save(profile: FarmerProfile): Promise<void>;
}

/**
 * AppDataSource
 * 
 * The Single Point of Entry for all data access in the application.
 * Abstracts the underlying storage mechanism (Dexie vs LocalStorage vs InMemory).
 */
export interface AppDataSource {
    logs: LogsRepository;
    crops: CropRepository;
    profile: ProfileRepository;

    // Future:
    // harvests: HarvestRepository;
    // procurement: ProcurementRepository;

    /**
     * Initialize the data source (migrations, connections, seeds)
     */
    initialize(): Promise<void>;

    /**
     * Teardown/Cleanup
     */
    teardown(): Promise<void>;
}
