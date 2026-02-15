import { LogsRepository } from './index';
import { CropProfile, FarmerProfile } from '../../types';

// Define auxiliary repositories here for now, or move to separate files
export interface CropRepository {
    getAll(): Promise<CropProfile[]>;
    save(crops: CropProfile[]): Promise<void>;
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
