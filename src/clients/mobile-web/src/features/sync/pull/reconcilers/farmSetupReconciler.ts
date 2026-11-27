/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P2) - the SERVER WINS on download for the farm's setup.
 *
 * The pull carries `farmSetup` only for a phone that asks (`farmSetup=1`): one entry per farm this person reads, FULL on every pull, even when the farm
 * has nothing yet (so "empty" and "not sent" stay two answers). Each listed farm REPLACES the phone's copy whole. A farm the pull does not list keeps
 * what it had (a farm this person may no longer read leaves by the rule below). An ABSENT key - an old server - leaves every store as it was (P11).
 *
 * A change made on this phone and not yet answered is never touched here: it is in the mutation queue (P10), and `getLocalFarmSetup` shows it over
 * these rows with a mark. An entry or a row that cannot be read is skipped and counted, never stored half. Never throws into the pull. Must run
 * inside the orchestrator's transaction (the four stores are in its list).
 *
 * A farm the server SAYS this person no longer reads (`accessScopes[].status` Paused / Waiting / Removed - a paused seat is sent `farmSetup: []`)
 * leaves the phone with its setup, here, whether or not the key came (the rule `reconcileAccessScopes` follows for the farm itself; done here so
 * that reconciler and its callers' transactions stay as they are). A farm merely absent from both lists is never removed.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { isReadableScope } from '../../../../infrastructure/storage/accessScopeStore';
import type { FarmSetupSet } from '../../../../domain/types/farmSetup.types';

export interface FarmSetupReconcileOutcome {
    /** `false` = the key was absent (an old server): nothing was touched. */
    applied: boolean;
    farms: number;
    skipped: number;
}

/**
 * A log line said AFTER the pull's transaction, never inside it: the transaction does not wait for the timer, and a console patched by a test runner
 * (vitest buffers it) can otherwise let the transaction commit early. The line is a note for whoever reads the log, never a gate.
 */
const noteLater = (action: string, detail: Record<string, unknown>): void => {
    setTimeout(() => console.warn(JSON.stringify({ component: 'farmSetupReconciler', action, ...detail })), 0);
};

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function reconcileFarmSetup(db: AgriLogDatabase, payload: SyncPullResponse, receivedAtUtc: string): Promise<FarmSetupReconcileOutcome> {
    const raw = (payload as SyncPullResponse & { farmSetup?: unknown }).farmSetup;
    const outcome: FarmSetupReconcileOutcome = { applied: false, farms: 0, skipped: 0 };
    const repo = new DexieFarmSetupRepository(db);
    try {
        const scopes = Array.isArray(payload.accessScopes) ? payload.accessScopes : [];
        const notReadable = scopes.filter(s => s && typeof s.farmId === 'string' && !isReadableScope(s)).map(s => s.farmId);
        await repo.removeFarms(notReadable);
    } catch (error) {
        noteLater('farm_setup_purge_failed', { reason: reasonOf(error) });
    }
    if (!Array.isArray(raw)) return outcome;
    try {
        const sets: FarmSetupSet[] = [];
        for (const entry of raw) {
            const read = farmSetupFromDto(entry, receivedAtUtc);
            if (!read) { outcome.skipped += 1; continue; }
            outcome.skipped += read.skipped;
            sets.push(read.set);
        }
        await repo.replaceFarms(sets);
        outcome.applied = true;
        outcome.farms = sets.length;
        if (outcome.skipped > 0) noteLater('farm_setup_rows_skipped', { skipped: outcome.skipped });
    } catch (error) {
        noteLater('farm_setup_not_kept_this_pull', { reason: reasonOf(error) });
    }
    return outcome;
}
