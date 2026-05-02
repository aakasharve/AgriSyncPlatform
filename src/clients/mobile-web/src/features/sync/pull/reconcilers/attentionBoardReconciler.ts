/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * CEI Phase 1 — clear and repopulate `attentionCards` on every successful
 * pull. Must run inside the orchestrator's `db.transaction('rw', ...)`
 * block (the table list includes `db.attentionCards`).
 */

import type {
    AttentionBoardDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';

export async function reconcileAttentionBoard(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
): Promise<void> {
    if (!payload.attentionBoard) {
        return;
    }

    await db.attentionCards.clear();

    const attentionBoard = payload.attentionBoard as AttentionBoardDto;
    if (attentionBoard.cards.length === 0) {
        return;
    }

    await db.attentionCards.bulkPut(
        attentionBoard.cards.map(card => ({
            cardId: card.cardId,
            farmId: card.farmId,
            farmName: card.farmName,
            plotId: card.plotId,
            plotName: card.plotName,
            rank: card.rank,
            computedAtUtc: card.computedAtUtc,
            cropCycleId: card.cropCycleId,
            stageName: card.stageName,
            titleEn: card.titleEn,
            titleMr: card.titleMr,
            descriptionEn: card.descriptionEn,
            descriptionMr: card.descriptionMr,
            suggestedAction: card.suggestedAction,
            suggestedActionLabelEn: card.suggestedActionLabelEn,
            suggestedActionLabelMr: card.suggestedActionLabelMr,
            overdueTaskCount: card.overdueTaskCount,
            latestHealthScore: card.latestHealthScore,
            unresolvedDisputeCount: card.unresolvedDisputeCount,
        })),
    );
}
