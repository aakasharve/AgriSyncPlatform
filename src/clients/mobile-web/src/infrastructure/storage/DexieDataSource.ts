import { AppDataSource, CropRepository, ProfileRepository } from '../../application/ports/AppDataSource';
import { LogsRepository } from '../../application/ports/index';
import { DexieLogsRepository } from './DexieLogsRepository';
import { storageNamespace } from './StorageNamespace';
import { CropProfile, FarmerProfile } from '../../types';

// Simple LocalStorage implementation for Crops/Profile for now, 
// as they are not yet in Dexie. 
// TODO: Move Crops/Profile to Dexie in Phase 3.

class LocalCropRepository implements CropRepository {
    async getAll(): Promise<CropProfile[]> {
        const key = storageNamespace.getKey('crops');
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    }

    async save(crops: CropProfile[]): Promise<void> {
        const key = storageNamespace.getKey('crops');
        localStorage.setItem(key, JSON.stringify(crops));
    }
}

class LocalProfileRepository implements ProfileRepository {
    async get(): Promise<FarmerProfile> {
        const key = storageNamespace.getKey('farmer_profile');
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : {} as FarmerProfile; // Handle default/empty upstream
    }

    async save(profile: FarmerProfile): Promise<void> {
        const key = storageNamespace.getKey('farmer_profile');
        localStorage.setItem(key, JSON.stringify(profile));
    }
}

export class DexieDataSource implements AppDataSource {
    public logs: LogsRepository;
    public crops: CropRepository;
    public profile: ProfileRepository;

    private static instance: DexieDataSource;

    private constructor() {
        this.logs = DexieLogsRepository.getInstance();
        this.crops = new LocalCropRepository();
        this.profile = new LocalProfileRepository();
    }

    public static getInstance(): DexieDataSource {
        if (!DexieDataSource.instance) {
            DexieDataSource.instance = new DexieDataSource();
        }
        return DexieDataSource.instance;
    }

    async initialize(): Promise<void> {
        // Dexie auto-opens on first access, but we could explicitly open here
        // or check migrations.
        // For now, no-op or simple check
    }

    async teardown(): Promise<void> {
        // Close connections if needed
    }
}
