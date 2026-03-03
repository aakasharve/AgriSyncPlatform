import { AppDataSource, CropRepository, ProfileRepository } from '../../application/ports/AppDataSource';
import { LogsRepository } from '../../application/ports/index';
import { DexieLogsRepository } from './DexieLogsRepository';
import { storageNamespace } from './StorageNamespace';
import { CropProfile, FarmerProfile } from '../../types';
import { normalizeMojibakeDeep } from '../../shared/utils/textEncoding';

// Simple LocalStorage implementation for Crops/Profile for now, 
// as they are not yet in Dexie. 
// TODO: Move Crops/Profile to Dexie in Phase 3.

class LocalCropRepository implements CropRepository {
    async getAll(): Promise<CropProfile[]> {
        const key = storageNamespace.getKey('crops');
        const stored = localStorage.getItem(key);
        if (!stored) {
            return [];
        }

        try {
            const parsed = JSON.parse(stored) as CropProfile[];
            const normalized = normalizeMojibakeDeep(Array.isArray(parsed) ? parsed : []);
            if (normalized.changed) {
                localStorage.setItem(key, JSON.stringify(normalized.value));
            }

            return normalized.value as CropProfile[];
        } catch {
            return [];
        }
    }

    async save(crops: CropProfile[]): Promise<void> {
        const key = storageNamespace.getKey('crops');
        const normalized = normalizeMojibakeDeep(crops).value;
        localStorage.setItem(key, JSON.stringify(normalized));
    }
}

class LocalProfileRepository implements ProfileRepository {
    async get(): Promise<FarmerProfile> {
        const key = storageNamespace.getKey('farmer_profile');
        const stored = localStorage.getItem(key);
        if (!stored) {
            return {} as FarmerProfile;
        }

        try {
            const parsed = JSON.parse(stored) as FarmerProfile;
            const normalized = normalizeMojibakeDeep(parsed);
            if (normalized.changed) {
                localStorage.setItem(key, JSON.stringify(normalized.value));
            }

            return normalized.value as FarmerProfile;
        } catch {
            return {} as FarmerProfile;
        }
    }

    async save(profile: FarmerProfile): Promise<void> {
        const key = storageNamespace.getKey('farmer_profile');
        const normalized = normalizeMojibakeDeep(profile).value;
        localStorage.setItem(key, JSON.stringify(normalized));
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
