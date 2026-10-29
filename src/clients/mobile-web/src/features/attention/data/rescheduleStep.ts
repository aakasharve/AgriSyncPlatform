/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — "पुढे ठरवा": give a late scheduled step
 * a new day, on the server, through the endpoint that already exists for exactly this
 * (`POST /shramsafal/planned-activities/{id}/override`, `PlannedActivityEndpoints.cs`: new date + reason; the
 * step keeps its history — `PlannedActivity.Override` records who, when and why). No new contract (P11).
 *
 * It is a direct call, not a queued one: the farmer sees at once whether it worked. A failure is shown and the
 * step stays on the page (nothing is silently dropped, P10). Only a 2xx counts as done.
 */
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import { markRescheduled, type ScheduledWorkItem } from '../scheduledWork';

/** The reason the server keeps with the move. PROPOSED (Marathi) */
export const RESCHEDULE_REASON_MR = 'लक्ष द्या: शेतकऱ्याने पुढे ठरवले';

export async function rescheduleStep(step: Pick<ScheduledWorkItem, 'plannedActivityId' | 'farmId'>, newDateKey: string): Promise<void> {
    const response = await apiFetch(`/shramsafal/planned-activities/${encodeURIComponent(step.plannedActivityId)}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            farmId: step.farmId,
            newPlannedDate: newDateKey,
            reason: RESCHEDULE_REASON_MR,
            clientCommandId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null,
        }),
    });
    if (!response.ok) throw new Error(`reschedule failed: HTTP ${response.status}`);
    markRescheduled(step.plannedActivityId);
}
