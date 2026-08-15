import { getDatabase, type MutationQueueItem } from '../storage/DexieDatabase';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import type { SyncMutationType } from '../api/AgriSyncClient';
import { isSyncMutationType } from './SyncMutationCatalog';
import { validatePayload } from './PayloadValidator';
import type { MutationFailureKind } from './RejectionPolicy';
import { readDeviceId, writeDeviceId } from '../storage/DeviceIdStore';
import { MAX_AUTO_RETRY_COUNT } from './retryCap';

const SYNC_SCOPE = 'shramsafal';
const LAST_PULL_META_KEY = 'shramsafal_last_pull_payload';

/**
 * How many SERVER-ANSWERED refusals a row may collect before the worker stops
 * retrying it by itself and the farmer is asked to act.
 *
 * The cap is APPLIED here, in `markFailedAsPending`, but it is DEFINED in
 * `retryCap.ts` — a leaf with no imports — because the chip's derivation
 * (`syncHonestyState.ts`) needs the same number and must stay Dexie-free. It is
 * re-exported here so every existing reader of `MutationQueue`'s copy keeps
 * working. There is now exactly one literal in the client.
 */
export { MAX_AUTO_RETRY_COUNT };

/**
 * §P0.7 box 2c — EXPONENTIAL BACKOFF ON THE MUTATION QUEUE.
 *
 * `AiJobWorker` has had this since it shipped (`AiJobWorker.ts:152`) and the
 * attachment worker has its own (`AttachmentUploadWorker.ts:11-12`). The
 * mutation queue — the one carrying the farmer's actual records — had none: a
 * failing row was re-pushed every 15 seconds, at full price in battery and
 * mobile data, until it either succeeded or hit the cap.
 *
 * That was survivable while every failure was charged, because the cap put a
 * ceiling of five on it. §P0.7 box 2a deliberately removes the charge from
 * dependency waits, so without backoff a child whose parent is one batch behind
 * would re-ask the server four times a minute FOR EVER, for free. The two
 * changes are a pair; neither is safe alone.
 *
 * Same shape and same numbers as `AiJobWorker`: 2s, 4s, 8s, 16s, 32s, then a
 * 60s ceiling. Copied rather than shared because the two queues have different
 * attempt counters and unifying them would couple two workers that must be able
 * to change independently.
 */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CEILING_MS = 60000;

export function backoffDelayMs(attemptCount: number): number {
    return Math.min(BACKOFF_BASE_MS * Math.pow(2, attemptCount), BACKOFF_CEILING_MS);
}

/**
 * Is this row allowed on the wire yet?
 *
 * A row with no `nextRetryAfterMs` is due — every row written before §P0.7, and
 * every fresh enqueue. Absence must mean "go", never "wait", or the change
 * would silently freeze the queue on every handset it upgraded.
 */
export function isMutationDue(item: Pick<MutationQueueItem, 'nextRetryAfterMs'>, nowMs: number): boolean {
    return item.nextRetryAfterMs === undefined || item.nextRetryAfterMs <= nowMs;
}

/**
 * The fields that put a row back in play immediately.
 *
 * Used everywhere the FARMER acts — "Retry All", the per-row retry, the
 * conflict screen's retry and edit. A tap must not land behind a delay the
 * farmer cannot see; that is the painted-door defect this codebase keeps
 * removing (`P5`). Not used by the auto-retry path, whose whole job is to wait.
 */
const CLEAR_BACKOFF = { nextRetryAfterMs: undefined, attemptCount: 0 } as const;

function getOrCreateDeviceId(): string {
    const existing = readDeviceId();
    if (existing) {
        return existing;
    }

    const created = idGenerator.generate();
    writeDeviceId(created);
    return created;
}

export class MutationQueue {
    private static instance: MutationQueue;

    private constructor() { }

    static getInstance(): MutationQueue {
        if (!MutationQueue.instance) {
            MutationQueue.instance = new MutationQueue();
        }
        return MutationQueue.instance;
    }

    getDeviceId(): string {
        return getOrCreateDeviceId();
    }

    async enqueue(
        mutationType: SyncMutationType,
        payload: unknown,
        options?: { clientRequestId?: string; clientCommandId?: string; deviceId?: string }
    ): Promise<string> {
        if (!mutationType || mutationType.trim().length === 0) {
            throw new Error('mutationType is required');
        }

        const normalizedMutationType = mutationType.trim();
        if (!isSyncMutationType(normalizedMutationType)) {
            throw new Error(`Unsupported mutationType '${normalizedMutationType}'.`);
        }

        // Sub-plan 02 Task 9: catch malformed payloads at the offline boundary.
        // Mutations with z.unknown() scaffolds (T-IGH-02-PAYLOADS) accept anything;
        // strict-typed mutations (create_daily_log, verify_log_v2, add_cost_entry,
        // create_attachment) reject with a typed error here instead of silently
        // failing later at the server.
        const validation = validatePayload(normalizedMutationType, payload);
        if (!validation.ok) {
            throw new Error(
                `Payload validation failed for ${normalizedMutationType}: ` +
                validation.errors.map((e) => `${e.path || '<root>'} ${e.message}`).join('; ')
            );
        }

        const db = getDatabase();
        const deviceId = options?.deviceId ?? getOrCreateDeviceId();
        const clientRequestId = options?.clientRequestId ?? idGenerator.generate();
        const clientCommandId = options?.clientCommandId ?? clientRequestId;
        const now = systemClock.nowISO();

        const record: MutationQueueItem = {
            deviceId,
            clientRequestId,
            clientCommandId,
            mutationType: normalizedMutationType,
            payload,
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
        };

        try {
            await db.mutationQueue.add(record);
            return clientRequestId;
        } catch (error) {
            const existing = await db.mutationQueue
                .where('[deviceId+clientRequestId]')
                .equals([deviceId, clientRequestId])
                .first();

            if (existing) {
                return clientRequestId;
            }

            throw error;
        }
    }

    /**
     * The rows the worker may put on the wire this cycle.
     *
     * §P0.7 box 2c — the due-time filter runs BEFORE `limit`, so a handful of
     * backed-off rows cannot squat the batch and starve rows that are ready.
     * `MutationQueueBackoff.test.ts` pins that ordering explicitly, because
     * getting it the other way round is silent: the queue would simply appear
     * to stall.
     */
    async getPending(limit = 50): Promise<MutationQueueItem[]> {
        const db = getDatabase();
        const nowMs = Date.now();
        const items = await db.mutationQueue
            .where('status')
            .equals('PENDING')
            .filter((item) => isMutationDue(item, nowMs))
            .limit(limit)
            .toArray();

        return items.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    }

    async markSending(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'SENDING',
            updatedAt: systemClock.nowISO(),
        });
    }

    async markApplied(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'APPLIED',
            updatedAt: systemClock.nowISO(),
            lastError: undefined,
            ...CLEAR_BACKOFF,
        });
    }

    /**
     * Records a failed push attempt.
     *
     * `kind` decides whether the attempt is CHARGED to the auto-retry cap.
     * Only a `REJECTION` — a verdict the server (or this client's own mutation
     * catalog) reached about this row — is charged. A `TRANSPORT` failure never
     * judged the row at all, so charging it would let 75 seconds of bad signal
     * strand a perfectly good record permanently (Task T3, finding R1).
     * §P0.7 adds `DEPENDENCY`, which is uncharged for the same reason: the
     * server judged the row's PARENT, not the row.
     *
     * The status still becomes `FAILED` either way: the row is genuinely not
     * sent, and the farmer's records must never look more delivered than they
     * are (`P4`). Only the counter changes.
     *
     * Defaults to `REJECTION` so a caller that says nothing gets the stricter,
     * bounded behaviour — a silent omission can never produce an uncapped loop.
     *
     * @returns the row's CHARGED retry count after this attempt, so the caller
     *          can tell — without a second read — whether this is the failure
     *          that just exhausted the cap and therefore needs announcing to
     *          the farmer (§P0.7 box 2d).
     */
    async markFailed(id: number, error: string, kind: MutationFailureKind = 'REJECTION'): Promise<number> {
        const db = getDatabase();
        const existing = await db.mutationQueue.get(id);
        const chargedRetries = existing?.retryCount ?? 0;
        // §P0.7 box 2c — every attempt slows the row down, whatever the cap
        // does about it. Counted separately from `retryCount` so the two
        // deliberately-uncharged kinds still back off.
        const attemptCount = (existing?.attemptCount ?? 0) + 1;
        const nextRetryCount = kind === 'REJECTION' ? chargedRetries + 1 : chargedRetries;
        await db.mutationQueue.update(id, {
            status: 'FAILED',
            updatedAt: systemClock.nowISO(),
            retryCount: nextRetryCount,
            lastError: error,
            attemptCount,
            nextRetryAfterMs: Date.now() + backoffDelayMs(attemptCount),
        });

        return nextRetryCount;
    }

    /**
     * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY: mark a row as
     * durably rejected. The row will NOT be picked up by markFailedAsPending —
     * the user must explicitly retry or discard via OfflineConflictPage.
     */
    async markRejectedUserReview(id: number, error: string): Promise<void> {
        const db = getDatabase();
        const existing = await db.mutationQueue.get(id);
        await db.mutationQueue.update(id, {
            status: 'REJECTED_USER_REVIEW',
            updatedAt: systemClock.nowISO(),
            retryCount: (existing?.retryCount ?? 0) + 1,
            lastError: error,
        });
    }

    /**
     * Soft-delete: user explicitly chose to drop a REJECTED_USER_REVIEW row.
     * Kept for audit + Sub-plan 05 E2E assertion. Never returned by
     * getPending(); never included in the conflict UI list().
     */
    async markRejectedDropped(id: number): Promise<void> {
        const db = getDatabase();
        await db.mutationQueue.update(id, {
            status: 'REJECTED_DROPPED',
            updatedAt: systemClock.nowISO(),
        });
    }

    /**
     * T-IGH-04-CONFLICT-EDIT: replace a rejected row's payload and reset it
     * to PENDING so the next sync cycle retries it with the corrected data.
     *
     * Validates via the same PayloadValidator used by enqueue() so the
     * corrected payload must satisfy the mutation's schema before the row
     * is updated. The row is not duplicated — only its payload, status, and
     * lastError are changed in-place.
     *
     * @returns true if the row was found and updated, false if not found.
     * @throws if clientRequestId is empty or payload validation fails.
     */
    async replacePayload(clientRequestId: string, newPayload: unknown): Promise<boolean> {
        if (!clientRequestId || clientRequestId.trim().length === 0) {
            throw new Error('clientRequestId is required');
        }

        const db = getDatabase();
        const deviceId = getOrCreateDeviceId();

        const row = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([deviceId, clientRequestId])
            .first();

        if (!row || row.id === undefined) {
            return false;
        }

        const validation = validatePayload(row.mutationType, newPayload);
        if (!validation.ok) {
            throw new Error(
                `Payload validation failed for ${row.mutationType}: ` +
                validation.errors.map((e) => `${e.path || '<root>'} ${e.message}`).join('; ')
            );
        }

        await db.mutationQueue.update(row.id, {
            payload: newPayload,
            status: 'PENDING',
            lastError: undefined,
            updatedAt: systemClock.nowISO(),
            // The farmer just corrected this record by hand. Making them wait
            // out a delay earned by the bytes they have already replaced would
            // be a penalty for fixing it.
            ...CLEAR_BACKOFF,
        });

        return true;
    }

    /**
     * Returns the rows that need user attention (durable rejections).
     * Used by ConflictResolutionService.list().
     */
    async getRejectedUserReview(): Promise<MutationQueueItem[]> {
        const db = getDatabase();
        const items = await db.mutationQueue
            .where('status')
            .equals('REJECTED_USER_REVIEW')
            .toArray();
        return items.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    }

    /**
     * §P0.7 box 2d — THE OTHER SET OF ROWS THAT NEEDS THE FARMER.
     *
     * A `FAILED` row at or over `MAX_AUTO_RETRY_COUNT` is as stuck as a durable
     * rejection: `markFailedAsPending` will not touch it again, so nothing in
     * the app will move it without a tap. The header chip has always known that
     * (`syncHonestyState.ts` returns `NEEDS_FIX`) and `stuckMutations` has
     * always counted it — but `ConflictResolutionService.list()` read only
     * `REJECTED_USER_REVIEW`, so the chip pointed at a door that was not there.
     *
     * Same predicate as `stuckMutations.needsFarmerAction`, same constant, and
     * `stuckMutations.agreement.test.ts` already holds the chip and the drawer
     * to it across the whole status/retryCount cross-product.
     *
     * Indexed on `status`, then filtered in memory over the FAILED rows only —
     * a set bounded by how much is currently broken, not by the size of the
     * queue. `retryCount` is not indexed and indexing it would need a Dexie
     * version bump, which this task is explicitly forbidden from spending.
     */
    async getCapExhaustedFailed(): Promise<MutationQueueItem[]> {
        const db = getDatabase();
        const items = await db.mutationQueue
            .where('status')
            .equals('FAILED')
            .filter((item) => item.retryCount >= MAX_AUTO_RETRY_COUNT)
            .toArray();
        return items.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    }

    /**
     * Auto-retry path. Filters strictly by status === 'FAILED' so durable
     * REJECTED_USER_REVIEW and REJECTED_DROPPED rows are NEVER auto-retried.
     *
     * Capped by design — see `MAX_AUTO_RETRY_COUNT`. The cap binds the WORKER
     * only; `retryAllFailedByUser()` below is the farmer's uncapped path.
     */
    async markFailedAsPending(maxRetryCount = MAX_AUTO_RETRY_COUNT): Promise<void> {
        // Backoff is NOT cleared here. This is the automatic path, and the flip
        // to PENDING is only permission to be considered — `getPending` still
        // holds the row until its delay expires. Clearing here would make the
        // backoff a no-op, since this runs at the top of every cycle.
        await this.flipFailedToPending(maxRetryCount, { clearBackoff: false });
    }

    /**
     * MANUAL retry path — "Retry All" in `SyncStatusDrawer`.
     *
     * Ignores `MAX_AUTO_RETRY_COUNT` deliberately. Before Task T3 this button
     * called `markFailedAsPending()` with no argument, so it re-applied the cap
     * and **silently skipped exactly the rows the farmer was complaining
     * about** — the chip said "stuck, go check", the drawer offered one big
     * obvious button, the button did nothing, and no message explained why,
     * while the small per-row "Retry" beside it (which never checked the cap,
     * `BackgroundSyncWorker.retryFailed`) would have worked. `P5`: make it real
     * or make it honest. This makes it real, and the per-row path had already
     * proved the uncapped transition is safe.
     *
     * There is no runaway risk: this only runs on a deliberate tap, and one tap
     * buys exactly one attempt — a row that is refused again lands straight
     * back over the cap.
     *
     * `REJECTED_USER_REVIEW` is deliberately NOT included. Those rows were
     * refused on their merits and retrying the identical bytes is known to
     * fail; their remedy is `OfflineConflictPage` (edit / retry / discard),
     * reached from `ConflictBadge`. Retrying them here would be a second
     * painted door, not a fix.
     *
     * @returns how many rows were moved back to PENDING, so the caller can say
     *          something true about what just happened instead of guessing.
     */
    async retryAllFailedByUser(): Promise<number> {
        // §P0.7 box 2c — a deliberate tap clears the backoff. The whole reason
        // this method exists is that the previous version silently skipped the
        // rows the farmer had come to the drawer about; leaving them behind a
        // 60-second delay with no indication would recreate that defect in a
        // new form.
        return this.flipFailedToPending(Number.POSITIVE_INFINITY, { clearBackoff: true });
    }

    private async flipFailedToPending(
        maxRetryCount: number,
        options: { clearBackoff: boolean },
    ): Promise<number> {
        const db = getDatabase();
        const failed = await db.mutationQueue.where('status').equals('FAILED').toArray();
        let flipped = 0;

        for (const item of failed) {
            if (!item.id) continue;
            if (item.retryCount >= maxRetryCount) continue;

            await db.mutationQueue.update(item.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
                ...(options.clearBackoff ? CLEAR_BACKOFF : {}),
            });
            flipped += 1;
        }

        return flipped;
    }

    /**
     * Put a row back on the wire NOW, whatever delay it had earned.
     *
     * The single place the "a tap means now" rule is written, so the three
     * farmer-initiated paths that reach into `db.mutationQueue` directly
     * (`BackgroundSyncWorker.retryFailed`, `ConflictResolutionService.retry`)
     * cannot each forget it in their own way.
     */
    async clearBackoff(id: number): Promise<void> {
        await getDatabase().mutationQueue.update(id, { ...CLEAR_BACKOFF });
    }

    async resetInFlightMutations(): Promise<void> {
        const db = getDatabase();
        const inFlight = await db.mutationQueue.where('status').equals('SENDING').toArray();

        for (const item of inFlight) {
            if (!item.id) continue;
            await db.mutationQueue.update(item.id, {
                status: 'PENDING',
                updatedAt: systemClock.nowISO(),
            });
        }
    }

    async getCursor(scope = SYNC_SCOPE): Promise<string | undefined> {
        const db = getDatabase();
        const cursor = await db.syncCursors.get(scope);
        return cursor?.serverCursor ?? cursor?.lastSyncAt;
    }

    async setCursor(cursorIso: string, scope = SYNC_SCOPE): Promise<void> {
        const db = getDatabase();
        await db.syncCursors.put({
            tableName: scope,
            lastSyncAt: systemClock.nowISO(),
            serverCursor: cursorIso,
            version: 1,
        });
    }

    async saveLastPullPayload(payload: unknown): Promise<void> {
        const db = getDatabase();
        await db.appMeta.put({
            key: LAST_PULL_META_KEY,
            value: payload,
            updatedAt: systemClock.nowISO(),
        });
    }
}

export const mutationQueue = MutationQueue.getInstance();
