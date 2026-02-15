import { AppDataSource, CropRepository, ProfileRepository } from '../../application/ports/AppDataSource';
import { LogsRepository } from '../../application/ports/index';
import { LocalStorageLogsRepository } from './LocalStorageLogsRepository';
import { storageNamespace } from './StorageNamespace';
import { CropProfile, FarmerProfile } from '../../types';

// Reuse Local implementation for Crops/Profile since Demo also uses LocalStorage
// but with 'demo' namespace (handled by storageNamespace global or we should ensure explicit namespace?)
// Fix-03 implies we rely on the global storageNamespace. 
// But wait, if we switch DataSource, we might want DemoDataSource to FORCE demo namespace?
// Ideally DataSourceProvider handles the namespace switching before initializing the source.

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
        return stored ? JSON.parse(stored) : {} as FarmerProfile;
    }

    async save(profile: FarmerProfile): Promise<void> {
        const key = storageNamespace.getKey('farmer_profile');
        localStorage.setItem(key, JSON.stringify(profile));
    }
}

export class DemoDataSource implements AppDataSource {
    public logs: LogsRepository;
    public crops: CropRepository;
    public profile: ProfileRepository;

    private static instance: DemoDataSource;

    private constructor() {
        this.logs = LocalStorageLogsRepository.getInstance();
        this.crops = new LocalCropRepository();
        this.profile = new LocalProfileRepository();
    }

    public static getInstance(): DemoDataSource {
        if (!DemoDataSource.instance) {
            DemoDataSource.instance = new DemoDataSource();
        }
        return DemoDataSource.instance;
    }

    async initialize(): Promise<void> {
        // Ensure namespace is set to demo? 
        // Or assume caller sets it. 
        // For safety, we can check.
    }

    async teardown(): Promise<void> {
        // Cleanup
    }
}
