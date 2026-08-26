/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Owner Oversight Loop — acknowledgement hook (Task 2).
 *
 * Reads and advances the "I have seen this" checkpoint for one farm,
 * through `OversightAcknowledgementPort` (injected — see `useWeatherMonitor`
 * for the same `provider: SomePort` pattern elsewhere in this codebase).
 * This hook writes ONLY the awareness checkpoint (spec §P-A, two
 * independent axes): it never reads or writes `verification.status`, never
 * calls a verify command, and has no dependency on `features/labour` or
 * `application/usecases/sync`. Acknowledging is not approving.
 *
 * SPEC §P-D — NO SILENT SUCCESS (binding):
 * `acknowledge()` sets `status: 'saving'` immediately, then either:
 *   - resolves     -> `checkpointISO` advances to the acknowledged instant,
 *                      `status` returns to `'idle'`.
 *   - rejects      -> `status` becomes `'failed'` and `checkpointISO` is left
 *                      EXACTLY as it was. Never optimistic, never a silent
 *                      queue — the two rejection tests in this module's test
 *                      file exist specifically to pin this.
 */

import { useCallback, useEffect, useState } from 'react';

import { systemClock } from '../../core/domain/services/Clock';
import type { OversightAcknowledgementPort } from './OversightAcknowledgementPort';

export type OversightAcknowledgementStatus = 'idle' | 'saving' | 'failed';

export interface UseOversightAcknowledgementResult {
    /** The last-acknowledged ISO instant for this farm, or `null` when the
     * owner has never acknowledged anything here yet. */
    checkpointISO: string | null;
    status: OversightAcknowledgementStatus;
    /**
     * Advances the checkpoint. `atISO` defaults to the real current instant
     * (`systemClock.nowISO()`) — callers only need to pass it explicitly in
     * tests that must pin an exact value.
     */
    acknowledge: (atISO?: string) => Promise<void>;
}

export function useOversightAcknowledgement(
    farmId: string,
    port: OversightAcknowledgementPort,
): UseOversightAcknowledgementResult {
    const [checkpointISO, setCheckpointISO] = useState<string | null>(null);
    const [status, setStatus] = useState<OversightAcknowledgementStatus>('idle');

    useEffect(() => {
        let cancelled = false;

        // A farm switch invalidates whatever this hook previously believed —
        // stale 'failed' from the last farm must not bleed into the next
        // one's read.
        setStatus('idle');
        setCheckpointISO(null);

        port.read(farmId)
            .then((iso) => {
                if (!cancelled) setCheckpointISO(iso);
            })
            .catch((err) => {
                // A failed READ is not the write-failure §P-D guards against —
                // there is nothing to leave "untouched" yet. Leave
                // `checkpointISO` at null (never fabricate a checkpoint that
                // was never actually confirmed) and surface it for debugging.
                console.warn('[useOversightAcknowledgement] read failed', err);
            });

        return () => {
            cancelled = true;
        };
    }, [farmId, port]);

    const acknowledge = useCallback(
        async (atISO?: string): Promise<void> => {
            const resolvedISO = atISO ?? systemClock.nowISO();
            setStatus('saving');
            try {
                await port.acknowledge(farmId, resolvedISO);
                // Only a CONFIRMED write advances the checkpoint — never
                // before `await` settles, never optimistically.
                setCheckpointISO(resolvedISO);
                setStatus('idle');
            } catch (err) {
                // Spec §P-D: rejection leaves `checkpointISO` untouched.
                // `status` is the only thing allowed to move.
                console.warn('[useOversightAcknowledgement] acknowledge failed', err);
                setStatus('failed');
            }
        },
        [farmId, port],
    );

    return { checkpointISO, status, acknowledge };
}
