/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Work Closure (DWC v2) — backwards-compatibility shim.
 *
 * The original `TelemetryService` (single class, 4 hard-coded event types,
 * `console.log` sink) has been replaced by:
 *   - `AnalyticsEventBus`     — singleton bus with Dexie outbox + flush.
 *   - `AnalyticsOutbox`       — drainBatch() implementing the ADR's batch policy.
 *   - `eventEmitters.ts`      — Zod-validated typed emit helpers per vocab entry.
 *
 * This file remains so existing call sites (`telemetry.trackSyncFailure`,
 * `telemetry.trackCorrection`) continue to compile while the call sites are
 * migrated to the new emit helpers under task §2.8. New code should import
 * from `eventEmitters` directly — do not extend this shim.
 *
 * @module core/telemetry/TelemetryService
 */

import { emitClientError } from './eventEmitters';

type LegacyEventType = 'SYNC_FAILURE' | 'AI_CORRECTION' | 'LOG_CREATED' | 'APP_CRASH';

export class TelemetryService {
    private static instance: TelemetryService;

    private constructor() { /* singleton */ }

    static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService();
        }
        return TelemetryService.instance;
    }

    /**
     * Legacy generic `track`. Routes only what maps cleanly into the frozen
     * vocabulary (`client.error`); other legacy event types fall through
     * with a single `console.warn` so the call site is visible in logs but
     * never crashes.
     */
    track(type: LegacyEventType, payload: unknown): void {
        if (type === 'SYNC_FAILURE' || type === 'APP_CRASH') {
            const message = this.extractMessage(payload, type);
            emitClientError({ message });
            return;
        }
        // AI_CORRECTION + LOG_CREATED have first-class events in the
        // vocabulary, but they are emitted from their feature handlers
        // (Plan §2.8) — not from this legacy generic shim.
        // eslint-disable-next-line no-console
        console.warn(`[telemetry] legacy track(${type}) ignored — migrate to eventEmitters`);
    }

    /** Legacy: sync push failure → client.error. */
    trackSyncFailure(error: unknown): void {
        const message = this.extractMessage(error, 'SYNC_FAILURE');
        emitClientError({ message });
    }

    /**
     * Legacy: AI text correction telemetry. The DWC vocabulary doesn't
     * carry corrections directly — they're rolled up server-side. The
     * shim no-ops with a warn so the contract is explicit.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    trackCorrection(_original: string, _corrected: string): void {
        // eslint-disable-next-line no-console
        console.warn('[telemetry] legacy trackCorrection ignored — handled server-side');
    }

    private extractMessage(payload: unknown, prefix: string): string {
        if (payload instanceof Error) {
            return `${prefix}: ${payload.message}`;
        }
        if (typeof payload === 'string') {
            return `${prefix}: ${payload}`;
        }
        if (payload && typeof payload === 'object' && 'message' in payload) {
            const m = (payload as { message?: unknown }).message;
            if (typeof m === 'string') {
                return `${prefix}: ${m}`;
            }
        }
        return prefix;
    }
}

export const telemetry = TelemetryService.getInstance();
