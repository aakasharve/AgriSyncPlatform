/**
 * HarvestLegacyStore
 *
 * Thin localStorage adapter for the legacy harvest service. The service keeps
 * harvest-domain behavior; this module owns raw persistence calls so storage
 * access remains behind infrastructure/storage/.
 */

import { storageNamespace } from './StorageNamespace';

function harvestConfigKey(plotId: string): string {
    return storageNamespace.getKey(`harvest_config_${plotId}`);
}

function harvestSessionsKey(plotId: string, cropId: string): string {
    return storageNamespace.getKey(`harvest_sessions_${plotId}_${cropId}`);
}

const OTHER_INCOME_KEY = 'harvest_other_income';

export function readHarvestConfigRaw(plotId: string): string | null {
    return localStorage.getItem(harvestConfigKey(plotId));
}

export function writeHarvestConfigRaw(plotId: string, serialized: string): void {
    localStorage.setItem(harvestConfigKey(plotId), serialized);
}

export function readHarvestSessionsRaw(plotId: string, cropId: string): string | null {
    return localStorage.getItem(harvestSessionsKey(plotId, cropId));
}

export function writeHarvestSessionsRaw(plotId: string, cropId: string, serialized: string): void {
    localStorage.setItem(harvestSessionsKey(plotId, cropId), serialized);
}

export function readOtherIncomeRaw(): string | null {
    return localStorage.getItem(storageNamespace.getKey(OTHER_INCOME_KEY));
}

export function writeOtherIncomeRaw(serialized: string): void {
    localStorage.setItem(storageNamespace.getKey(OTHER_INCOME_KEY), serialized);
}

