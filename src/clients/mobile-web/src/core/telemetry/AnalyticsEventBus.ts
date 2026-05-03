/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Work Closure (DWC v2) — singleton event bus that owns the Dexie
 * outbox + flush scheduler for analytics events. Replaces the legacy
 * `console.log` stub in `TelemetryService.ts`.
 *
 * Behavior (per `ADR-2026-05-02_telemetry-batching.md`):
 *   - `enqueue(item)` writes the event to the Dexie `analyticsOutbox` table.
 *   - `start()` registers the flush scheduler:
 *       * `setInterval` every 15s while the app is foregrounded.
 *       * `document.visibilitychange === 'hidden'` flush.
 *       * `online` window event flush after offline window reconnects.
 *   - `flush()` invokes `AnalyticsOutbox.drainBatch(50)`.
 *
 * The bus is environment-tolerant: in non-browser environments (vitest
 * `node` env without jsdom), the visibility / online listeners are no-ops
 * but `enqueue` and `flush` still work against the in-memory Dexie
 * (fake-indexeddb).
 *
 * @module core/telemetry/AnalyticsEventBus
 */

import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { drainBatch, MAX_BATCH, type DrainOutcome } from './AnalyticsOutbox';

/** Periodic flush interval (ms). 15s per the ADR. */
export const FLUSH_INTERVAL_MS = 15_000;

export interface EnqueueItem {
    eventType: string;
    props: Record<string, unknown>;
}

class AnalyticsEventBus {
    private timer: ReturnType<typeof setInterval> | null = null;
    private started = false;
    private flushing: Promise<DrainOutcome> | null = null;

    private readonly visibilityHandler = (): void => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            void this.flush();
        }
    };

    private readonly onlineHandler = (): void => {
        void this.flush();
    };

    /**
     * Wire up the periodic + lifecycle flush triggers. Idempotent — calling
     * `start` more than once is a no-op (defends against React StrictMode
     * double-mount in development).
     */
    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;

        if (typeof setInterval !== 'undefined') {
            this.timer = setInterval(() => {
                void this.flush();
            }, FLUSH_INTERVAL_MS);
        }

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('online', this.onlineHandler);
        }
    }

    /**
     * Tear down listeners and the periodic timer. Used by tests to avoid
     * leaking timers across cases; production code does not call `stop`.
     */
    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('online', this.onlineHandler);
        }
        this.started = false;
    }

    /**
     * Persist an event to the Dexie outbox. Errors are swallowed and logged
     * — telemetry must never throw into the calling feature code.
     */
    async enqueue(item: EnqueueItem): Promise<void> {
        try {
            const db = getDatabase();
            await db.analyticsOutbox.add({
                payloadJson: JSON.stringify(item),
                createdAtUtc: Date.now(),
                attempts: 0,
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[telemetry] failed to enqueue event:', error);
        }
    }

    /**
     * Drain one batch from the outbox. Concurrent calls coalesce — at most
     * one in-flight POST at a time per device.
     */
    async flush(): Promise<DrainOutcome> {
        if (this.flushing) {
            return this.flushing;
        }
        this.flushing = (async () => {
            try {
                return await drainBatch(MAX_BATCH);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn('[telemetry] flush failed:', error);
                return { attempted: 0, deleted: 0, retried: 0, droppedAfterMaxAttempts: 0 };
            } finally {
                // Cleared after the inner try so subsequent flushes start fresh.
                this.flushing = null;
            }
        })();
        return this.flushing;
    }
}

/**
 * Singleton — wired into `index.tsx` via `eventBus.start()`. Tests may
 * import the underlying class for isolation by re-instantiating; the
 * singleton handle exposed here is sufficient for production code.
 */
export const eventBus = new AnalyticsEventBus();
