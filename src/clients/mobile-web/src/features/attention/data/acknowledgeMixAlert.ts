/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1; founders D-92 / P7) - "पाहिलं" on an "आधी हे पाहा" card.
 *
 * It acknowledges the ALERT, the open compliance signal that ranks the card (`topSignalId`), through the existing queued
 * `compliance.acknowledge` mutation (`compliance_acknowledge.zod.ts`: `{ signalId }`). So it works with no internet (P10), and
 * pressing twice is the same request: the queue key derives from the signal id. It is queued with `enqueueRepeatable` (as a move
 * of a saved entry is): a request still waiting or already applied is left as it is, but one the server refused (or that gave up
 * past the retry cap) is RE-ARMED by the next tap - plain `enqueue` would keep the finished row and queue nothing, and the card
 * would come back for ever with nothing on its way. It changes nothing in the stored record, the
 * dose, the product names or the date (P7): the record stays exactly as it was said, and the card only leaves the list.
 *
 * A card from an older server carries no signal id: there is nothing to acknowledge, and nothing is sent.
 */
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { markSignalSeen } from '../seenSignals';

export const acknowledgeRequestId = (signalId: string): string => `${SyncMutationName.ComplianceAcknowledge}:${signalId}`;

/** Queues the acknowledge and hides the card here. Throws when it could not be queued (the card then stays). */
export async function acknowledgeMixAlert(signalId: string | null | undefined): Promise<boolean> {
    if (!signalId) return false;
    const clientRequestId = acknowledgeRequestId(signalId);
    await mutationQueue.enqueueRepeatable(SyncMutationName.ComplianceAcknowledge, { signalId }, { clientRequestId, clientCommandId: clientRequestId });
    markSignalSeen(signalId);
    return true;
}
