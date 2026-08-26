/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Owner Oversight Loop — acknowledgement port (Task 2).
 *
 * The "I have seen this" checkpoint is its own axis (spec §P-A): it never
 * touches `verification.status` and is never an approval. This is the only
 * contract `useOversightAcknowledgement` depends on to read or advance that
 * checkpoint — concrete persistence lives behind an adapter (see
 * `infrastructure/storage/LocalOversightAcknowledgementStore.ts`) so the hook, and anything that
 * feeds `buildOversightModel` in `oversightSelectors.ts`, never import
 * storage directly.
 */

export interface OversightAcknowledgementPort {
    /**
     * The ISO checkpoint currently recorded for this farm, or `null` when
     * the owner has never acknowledged anything on this farm yet.
     */
    read(farmId: string): Promise<string | null>;

    /**
     * Advances the checkpoint for this farm to `atISO`.
     *
     * Throws (rejects) on failure — spec §P-D, "acknowledgement never fakes
     * success". Callers MUST NOT treat a throw as success and MUST NOT
     * update any locally-held checkpoint until this resolves. Never
     * optimistic, never a silent queue.
     */
    acknowledge(farmId: string, atISO: string): Promise<void>;
}
