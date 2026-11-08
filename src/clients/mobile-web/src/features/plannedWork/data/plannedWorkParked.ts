/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, doctrine P10) - the plan steps the server REFUSED and parked
 * (`REJECTED_USER_REVIEW`), read from the outbox beside `getLocalPlannedWork`. A parked step is not intent (the store leaves it out),
 * so the task keeps showing what the server last said - a parked accept never shows as accepted. The card says the step's own
 * words and opens the conflict page (route `offline-conflicts`), where he retries or discards it.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { PlannedWorkVerb } from './plannedWorkCommands';
import type { PlannedWorkWords } from '../plannedWorkWords';

export interface ParkedStep {
    verb: PlannedWorkVerb;
    errorCode: string | null;
    lastError: string | null;
}

const VERB_OF: Readonly<Record<string, PlannedWorkVerb>> = {
    [SyncMutationName.PlannedworkCreate]: 'create',
    [SyncMutationName.PlannedworkEdit]: 'edit',
    [SyncMutationName.PlannedworkSeen]: 'seen',
    [SyncMutationName.PlannedworkAccept]: 'accept',
    [SyncMutationName.PlannedworkCancel]: 'cancel',
    [SyncMutationName.PlannedworkComplete]: 'complete',
    [SyncMutationName.PlannedworkReopen]: 'reopen',
};

/** The latest parked step of each task of this farm, by task id. */
export async function getParkedPlannedWork(farmId: string): Promise<Map<string, ParkedStep>> {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').anyOf(Object.keys(VERB_OF))
        .filter(row => row.status === 'REJECTED_USER_REVIEW')
        .toArray();
    const parked = new Map<string, ParkedStep>();
    for (const row of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id ?? 0) - (b.id ?? 0))) {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const id = typeof payload.plannedWorkId === 'string' ? payload.plannedWorkId : null;
        if (!id || payload.farmId !== farmId) continue;
        parked.set(id, { verb: VERB_OF[row.mutationType], errorCode: row.errorCode ?? null, lastError: row.lastError ?? null });
    }
    return parked;
}

/** The refusal in the farmer's words (the server's rule said plainly); never the server's English sentence. */
export function parkedWords(step: ParkedStep, words: PlannedWorkWords): string {
    const code = step.errorCode ?? '';
    if (code.includes('AssigneeNotMember')) return words.personNotOnFarm;
    if (code.includes('AssigneeOutsidePlots')) return words.personNotOnPlots;
    if (code.includes('PlannedWorkState')) return words.changedFirst;
    // Lane L8c-3: the done step's own refusals, said plainly.
    if (code.includes('PlannedWorkPlots')) return words.donePlotsRefused;
    if (code.includes('PlannedWorkLog')) return words.doneLogRefused;
    if (code.includes('Forbidden')) {
        if (step.verb === 'reopen') return words.reopenOwnerOnly;
        return step.verb === 'seen' || step.verb === 'accept' || step.verb === 'complete' ? words.noLongerYours : words.notAllowedToAssign;
    }
    return words.parkedUnknown;
}
