/**
 * ProcurementLegacyStore
 *
 * Raw persistence adapter for the legacy procurement repository.
 */

import { storageNamespace } from './StorageNamespace';

const PROCUREMENT_STORAGE_KEY = 'dfes_procurement_expenses';

export function readProcurementExpensesRaw(): string | null {
    return localStorage.getItem(storageNamespace.getKey(PROCUREMENT_STORAGE_KEY));
}

export function writeProcurementExpensesRaw(serialized: string): void {
    localStorage.setItem(storageNamespace.getKey(PROCUREMENT_STORAGE_KEY), serialized);
}

