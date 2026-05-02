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
 */

const FINANCE_SETTINGS_KEY = 'finance_settings';

export function readFinanceSettingsRaw(): string | null {
    return localStorage.getItem(FINANCE_SETTINGS_KEY);
}

export function writeFinanceSettingsRaw(serialized: string): void {
    localStorage.setItem(FINANCE_SETTINGS_KEY, serialized);
}
