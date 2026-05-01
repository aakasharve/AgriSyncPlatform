/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DexieDataSource — single point of entry for all client-side data access.
 *
 * Sub-plan 04 Task 2 / T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01) cut
 * over the crops + profile repositories from localStorage to Dexie. The
 * previous LocalCropRepository / LocalProfileRepository classes are gone;
 * Dexie is now the source of truth and SyncPullReconciler writes the same
 * substrate that this data source reads from.
 *
 * Legacy localStorage entries for `crops` and `farmer_profile` are imported
 * once on first boot via LegacyLocalStorageMigrator and then become inert.
 * Production code must not read those keys directly anymore.
 */

import { AppDataSource, CropRepository, ProfileRepository } from '../../application/ports/AppDataSource';
import { LogsRepository } from '../../application/ports/index';
import { DexieLogsRepository } from './DexieLogsRepository';
import { DexieCropsRepository } from './DexieCropsRepository';
import { DexieProfileRepository } from './DexieProfileRepository';

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
        // Dexie auto-opens on first access; the singleton in DexieDatabase.ts
        // handles version upgrades transparently. No explicit open() needed.
    }

    async teardown(): Promise<void> {
        // Close connections if needed
    }
}
