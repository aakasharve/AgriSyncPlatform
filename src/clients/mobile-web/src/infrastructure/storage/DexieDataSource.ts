import { AppDataSource, CropRepository, ProfileRepository } from '../../application/ports/AppDataSource';
import { LogsRepository } from '../../application/ports/index';
import { DexieLogsRepository } from './DexieLogsRepository';
import { DexieCropsRepository } from './DexieCropsRepository';
import { DexieProfileRepository } from './DexieProfileRepository';

/**
 * Sub-plan 04 Task 2 — Crops + Profile now live in Dexie via DexieCropsRepository
 * and DexieProfileRepository. The legacy LocalCropRepository/LocalProfileRepository
 * inline classes were deleted; LegacyLocalStorageMigrator copies any pre-existing
 * localStorage rows into Dexie on first load.
 */
export class DexieDataSource implements AppDataSource {
    public logs: LogsRepository;
    public crops: CropRepository;
    public profile: ProfileRepository;

    private static instance: DexieDataSource;

    private constructor() {
        this.logs = DexieLogsRepository.getInstance();
        this.crops = new DexieCropsRepository();
        this.profile = new DexieProfileRepository();
    }

    public static getInstance(): DexieDataSource {
        if (!DexieDataSource.instance) {
            DexieDataSource.instance = new DexieDataSource();
        }
        return DexieDataSource.instance;
    }

    async initialize(): Promise<void> {
        // Dexie auto-opens on first access; v14 stores are declared in
        // DexieDatabase.ts.
    }

    async teardown(): Promise<void> {
        // Close connections if needed
    }
}
