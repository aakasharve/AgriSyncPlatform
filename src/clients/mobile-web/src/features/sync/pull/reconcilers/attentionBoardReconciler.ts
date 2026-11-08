/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * CEI Phase 1 — clear and repopulate `attentionCards` on every successful
 * pull. Must run inside the orchestrator's `db.transaction('rw', ...)`
 * block (the table list includes `db.attentionCards` and `db.appMeta`).
 *
 * spec: plr-d10 (I22) — the board's `scheduledWork` list (one row per scheduled
 * step due today or late) is kept whole in `appMeta`, replaced on every pull that
 * carries a board. A board WITHOUT the list (an older server) removes the stored
 * one, so the phone never keeps showing a stale list as if it were today's.
 */

import type {
    AttentionBoardDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SCHEDULED_WORK_META_KEY, scheduledWorkItemOf, type ScheduledWorkItem } from '../../../attention/scheduledWork';

export async function reconcileAttentionBoard(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
): Promise<void> {
    if (!payload.attentionBoard) {
        return;
    }

    await db.attentionCards.clear();

    const attentionBoard = payload.attentionBoard as AttentionBoardDto & { asOfUtc?: string };
    if (Array.isArray(attentionBoard.scheduledWork)) {
        await db.appMeta.put({
            key: SCHEDULED_WORK_META_KEY,
            value: {
                items: attentionBoard.scheduledWork.map(scheduledWorkItemOf).filter((x): x is ScheduledWorkItem => x !== null),
                asOfUtc: attentionBoard.asOfUtc ?? payload.serverTimeUtc,
            },
            updatedAt: payload.serverTimeUtc,
        });
    } else {
        await db.appMeta.delete(SCHEDULED_WORK_META_KEY);
    }

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
            // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 4) - the open signal that ranks this card, kept as
            // sent (optional, non-indexed). An older server sends neither: the keys are left off, not written as undefined.
            ...(typeof card.topSignalId === 'string' ? { topSignalId: card.topSignalId } : {}),
            ...(typeof card.topSignalRuleCode === 'string' ? { topSignalRuleCode: card.topSignalRuleCode } : {}),
        })),
    );
}
