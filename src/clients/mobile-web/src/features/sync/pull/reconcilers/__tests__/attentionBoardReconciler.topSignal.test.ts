/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 4) - the attention card keeps the open signal that ranks it
 * (`topSignalId`, `topSignalRuleCode`) from the pull into the cache, so lane IT5 can show it. An older server sends neither: the
 * card is cached as before, with the keys left off.
 */
import { describe, expect, it, vi } from 'vitest';
import { reconcileAttentionBoard } from '../attentionBoardReconciler';
import type { AgriLogDatabase, AttentionCardCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const card = {
    cardId: 'card-1', farmId: 'farm-1', farmName: 'शेत', plotId: 'plot-1', plotName: 'प्लॉट १', rank: 2,
    computedAtUtc: '2026-11-09T04:00:00.000Z', titleEn: 't', titleMr: 'ट', descriptionEn: 'd', descriptionMr: 'व',
    suggestedAction: 0, suggestedActionLabelEn: 'l', suggestedActionLabelMr: 'ल',
};

const run = async (cards: unknown[]): Promise<AttentionCardCacheRecord[]> => {
    const stored: AttentionCardCacheRecord[] = [];
    const db = {
        attentionCards: { clear: vi.fn().mockResolvedValue(undefined), bulkPut: vi.fn(async (rows: AttentionCardCacheRecord[]) => { stored.push(...rows); }) },
        appMeta: { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
    } as unknown as AgriLogDatabase;
    await reconcileAttentionBoard(db, { serverTimeUtc: '2026-11-09T04:00:00.000Z', attentionBoard: { cards } } as unknown as SyncPullResponse);
    return stored;
};

describe('attentionBoardReconciler - the top signal (IT4 Task 4)', () => {
    it('TopSignal_FromServer_KeepsBothFieldsIntoTheCache', async () => {
        const [row] = await run([{ ...card, topSignalId: '7c0a1c3e-0000-4000-8000-000000000001', topSignalRuleCode: 'compliance.input-mix.never-together' }]);
        expect(row.topSignalId).toBe('7c0a1c3e-0000-4000-8000-000000000001');
        expect(row.topSignalRuleCode).toBe('compliance.input-mix.never-together');
        expect(row.cardId).toBe('card-1');
    });

    it('TopSignal_OldServerCard_StillCaches_WithoutEitherKey', async () => {
        const [row] = await run([card]);
        expect(row.cardId).toBe('card-1');
        expect(row.plotName).toBe('प्लॉट १');
        expect('topSignalId' in row).toBe(false);
        expect('topSignalRuleCode' in row).toBe(false);
    });

    it('TopSignal_ExplicitNull_IsNotInventedIntoAnId', async () => {
        const [row] = await run([{ ...card, topSignalId: null, topSignalRuleCode: null }]);
        expect(row.topSignalId ?? null).toBeNull();
        expect(row.topSignalRuleCode ?? null).toBeNull();
    });
});
