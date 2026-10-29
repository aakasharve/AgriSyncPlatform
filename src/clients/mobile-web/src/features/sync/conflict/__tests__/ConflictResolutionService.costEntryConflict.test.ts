// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (R-1) — a money entry the server refused because its id is already recorded on
 * another farm or by another person reaches the conflict screen with a Marathi line that says so (PROPOSED),
 * read from the server's CODE, not from its English message.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { COST_ENTRY_ID_CONFLICT_CODE, ConflictResolutionService } from '../ConflictResolutionService';

const NOW = '2026-10-29T00:00:00.000Z';

beforeEach(async () => {
    await getDatabase().mutationQueue.clear();
});

describe('the cost-entry id conflict on the conflict screen', () => {
    it('is listed with a Marathi hint drawn from the code', async () => {
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'add_cost_entry:x', clientCommandId: 'add_cost_entry:x',
            mutationType: SyncMutationName.AddCostEntry, payload: { costEntryId: 'x' }, status: 'REJECTED_USER_REVIEW',
            createdAt: NOW, updatedAt: NOW, retryCount: 1,
            lastError: 'This money entry id is already recorded on another farm or by another person. It was not saved again.',
            errorCode: COST_ENTRY_ID_CONFLICT_CODE,
        });

        const [row] = await ConflictResolutionService.list();
        expect(row.hint).toContain('दुसऱ्या शेतावर किंवा दुसऱ्या व्यक्तीच्या नावाने');
    });
});
