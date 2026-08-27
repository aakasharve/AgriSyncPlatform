/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesStageWindow — pure planned-vs-actual stage-confirmation window (Phase 5).
 * Decides whether Shram Sathi should ask the farmer to confirm the plot's current
 * crop stage. No React/DOM/network. Reads the cooldown from the stage.confirm_current
 * bank entry so the cadence stays a single reviewed source.
 *
 * spec: dfes-companion-2026-07-11
 */
import type { StageContext } from './meterGaps';
import { findQuestion } from './dfesQuestionBank';

/** The most recent stage-confirm telemetry (null = never confirmed). */
export interface LastStageConfirm {
    questionKey: string;
    ageDays: number; // whole days since it was shown/confirmed
}

export function isStageConfirmationWindowOpen(
    stage: StageContext | undefined,
    lastConfirm: LastStageConfirm | null,
): boolean {
    // Nothing to confirm against.
    if (!stage?.expectedStage || stage.expectedStage.trim().length === 0) return false;

    // Never confirmed → window is open.
    if (lastConfirm === null) return true;

    // Expected stage has moved on from what the farmer last confirmed → re-ask.
    const confirmed = stage.farmerConfirmedActualStage?.trim();
    if (!confirmed || confirmed !== stage.expectedStage.trim()) return true;

    // Matched — only re-ask once the bank cooldown has elapsed.
    const cooldown = findQuestion('stage.confirm_current')?.cooldownDays ?? 7;
    return lastConfirm.ageDays >= cooldown;
}
