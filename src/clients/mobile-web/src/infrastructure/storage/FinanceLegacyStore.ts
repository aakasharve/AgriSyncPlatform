/**
 * FinanceLegacyStore — thin localStorage adapter for finance settings.
 *
 * Purpose-named storage adapter (Sub-plan 04 §DoD): the
 * features/finance/financeService.ts module owns Dexie hydration and the
 * settings business logic; raw read/write of the finance_settings key
 * lives here so direct localStorage usage stays inside
 * infrastructure/storage/.
 *
 * Note: the parent service file is also flagged for legacy-services
 * deletion (Task 10). For this wave we only drain the localStorage call;
 * the eventual file deletion is a follow-up.
 *
 * P0.1: the key was RAW — one `finance_settings` entry shared by every farmer
 * who signed in on the handset, including their GST number. It now goes through
 * `storageNamespace`, which scopes it to the farmer this handset is serving.
 * The pre-existing un-scoped entry is copied into the incumbent's scope by
 * `adoptUnscopedBusinessKeys` and is never deleted.
 */

import { storageNamespace } from './StorageNamespace';

const FINANCE_SETTINGS_KEY = 'finance_settings';

export function readFinanceSettingsRaw(): string | null {
    return localStorage.getItem(storageNamespace.getKey(FINANCE_SETTINGS_KEY));
}

export function writeFinanceSettingsRaw(serialized: string): void {
    localStorage.setItem(storageNamespace.getKey(FINANCE_SETTINGS_KEY), serialized);
}
