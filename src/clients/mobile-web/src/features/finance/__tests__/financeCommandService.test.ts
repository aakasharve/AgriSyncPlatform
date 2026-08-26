/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-07-13-labour-attendance-approval-design (Phase 3 / Decision 3a,
 * 2026-07-19).
 *
 * Fix 2 — the expense-drop bug: `createMoneyEventFromSource` used to mint
 * `me_<uuid>` as the `costEntryId` it hands to `AddCostEntryCommand.enqueue`.
 * The sync-contract's `AddCostEntryPayload.costEntryId` schema
 * (sync-contract/schemas/payloads/add_cost_entry.zod.ts) is `ZGuid` — a bare
 * UUID regex — so `validatePayload` inside `MutationQueue.enqueue` rejected
 * every such payload and threw. The caller (`financeCommandService`) never
 * awaits or catches that promise, so the rejection was silent: the event
 * still landed in the in-memory finance cache (so the finance page showed it
 * as "saved") but NEVER reached `db.mutationQueue` — nothing to sync, ever.
 *
 * This suite proves the fix end-to-end through the REAL MutationQueue +
 * PayloadValidator + Dexie (via fake-indexeddb), not a mock — a mocked
 * validator would hide the exact bug this fix closes.
 *
 * Also proves the companion idempotency fix: a re-save of the same log/entry
 * (same deterministic `sourceId`) must not double-enqueue and must not
 * double-count a day's cost.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { financeCommandService } from '../financeCommandService';
import type { MoneySourcePayload } from '../finance.types';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function flushMicrotasks(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function pendingAddCostEntryRows() {
    const db = getDatabase();
    return db.mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
}

describe('financeCommandService.createMoneyEventFromSource — Decision 3a fix 2 (expense-drop)', () => {
    beforeEach(async () => {
        // Deliberately does NOT call resetDatabase() — closing/reopening the
        // Dexie handle mid-run races financeService's fire-and-forget
        // `refreshInBackground()` from the previous test (an unhandled
        // DatabaseClosedError rejection). Clearing the one table these tests
        // touch is enough for exact-count assertions to be trustworthy.
        await getDatabase().mutationQueue.clear();
    });

    it('mints a bare-UUID costEntryId and actually reaches the sync outbox (real PayloadValidator, no mock)', async () => {
        const payload: MoneySourcePayload = {
            type: 'VoiceLog',
            sourceId: 'log-1:labour:l1',
            dateTime: '2026-07-19T12:00:00Z',
            eventType: 'Expense',
            category: 'Labour',
            farmId: '11111111-1111-1111-1111-111111111111',
            amount: 800,
            createdByUserId: '22222222-2222-2222-2222-222222222222',
        };

        const event = financeCommandService.createMoneyEventFromSource(payload);

        // The id must satisfy the wire contract — no `me_` prefix.
        expect(event.id).toMatch(GUID_RE);
        expect(event.id.startsWith('me_')).toBe(false);

        await flushMicrotasks();

        const pending = await pendingAddCostEntryRows();
        expect(pending).toHaveLength(1);
        const row = pending[0].payload as { costEntryId: string; categoryId: string; amount: number };
        expect(row.costEntryId).toBe(event.id);
        expect(row.costEntryId).toMatch(GUID_RE);
        expect(row.categoryId).toBe('labour_misc');
        expect(row.amount).toBe(800);
    });

    it('is idempotent: re-saving the same log/entry (same sourceId) does not double-enqueue or double-count', async () => {
        const payload: MoneySourcePayload = {
            type: 'VoiceLog',
            sourceId: 'log-2:labour:l1',
            dateTime: '2026-07-19T12:00:00Z',
            eventType: 'Expense',
            category: 'Labour',
            farmId: '11111111-1111-1111-1111-111111111111',
            amount: 500,
            createdByUserId: '22222222-2222-2222-2222-222222222222',
        };

        const first = financeCommandService.createMoneyEventFromSource(payload);
        const second = financeCommandService.createMoneyEventFromSource(payload);

        expect(second.id).toBe(first.id);

        await flushMicrotasks();

        const pending = await pendingAddCostEntryRows();
        const forThisSource = pending.filter(
            p => (p.payload as { costEntryId: string }).costEntryId === first.id
        );
        expect(forThisSource).toHaveLength(1);
    });
});
