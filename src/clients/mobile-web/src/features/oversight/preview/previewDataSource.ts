/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 13b, review verifier 8) — the `useDataSource()` value of the dev-only preview.
 * The result screen reads it (its "पक्कं आहे" goes through `dataSource.logs`); the preview has no store to write to,
 * so every write is REFUSED with the same words the preview's other stubs use, and the screen then shows its own honest
 * failure line — never a fake success (P4). Reads answer "nothing stored here". The audit append resolves (it records
 * nothing, and nothing it would record can happen).
 */
import type { DataSourceContextValue } from '../../../app/providers/DataSourceProvider';
import type { LogsRepository } from '../../../application/ports';

export const PREVIEW_SAVE_REFUSED = 'Saving is disabled in this preview (no backend, no Dexie writes).';

const refuse = async (): Promise<never> => { throw new Error(PREVIEW_SAVE_REFUSED); };

const logs: LogsRepository = {
    getAll: async () => [],
    getByDate: async () => [],
    getByPlot: async () => [],
    getById: async () => null,
    save: refuse,
    batchSave: refuse,
    delete: refuse,
    updateVerification: refuse,
};

export const PREVIEW_DATA_SOURCE: DataSourceContextValue = {
    dataSource: {
        logs,
        crops: { getAll: async () => [], save: refuse },
        profile: { get: refuse, save: refuse },
        initialize: async () => undefined,
        teardown: async () => undefined,
    },
    auditPort: { append: async () => undefined },
    isDemoMode: true,
    setDemoMode: async () => undefined,
    isLoading: false,
};
