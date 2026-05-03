/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Work Closure (DWC v2) — typed emit helpers, one per client-emitted
 * event in the frozen vocabulary. Each helper:
 *   1. `safeParse`s the payload against the matching Zod schema.
 *   2. On success, enqueues the event onto the singleton `AnalyticsEventBus`.
 *   3. On failure, `console.warn`s with the issue summary and returns
 *      without enqueueing — telemetry must never throw into the calling
 *      feature code.
 *
 * The event bus is imported lazily so `eventEmitters.ts` may be tree-shaken
 * in tests that exercise the schemas in isolation.
 *
 * @module core/telemetry/eventEmitters
 */

import { eventBus } from './AnalyticsEventBus';
import {
    EventSchemas,
    type EventName,
    type EventPayload,
} from './eventSchema';

/**
 * Generic emit — used by all per-event helpers. Exported for tests; feature
 * code should prefer the typed helpers below for autocomplete safety.
 */
export function emit<E extends EventName>(eventName: E, payload: EventPayload<E>): void {
    const schema = EventSchemas[eventName];
    const result = schema.safeParse(payload);
    if (!result.success) {
        // eslint-disable-next-line no-console
        console.warn(
            `[telemetry] dropped invalid ${eventName} event:`,
            result.error.issues,
        );
        return;
    }
    // The schema's parsed shape matches the input payload shape one-to-one;
    // we send the validated payload to ensure no extraneous keys leak through.
    eventBus.enqueue({ eventType: eventName, props: result.data as Record<string, unknown> });
}

export function emitClosureStarted(payload: EventPayload<'closure.started'>): void {
    emit('closure.started', payload);
}

export function emitClosureSubmitted(payload: EventPayload<'closure.submitted'>): void {
    emit('closure.submitted', payload);
}

export function emitClosureAbandoned(payload: EventPayload<'closure.abandoned'>): void {
    emit('closure.abandoned', payload);
}

export function emitProofAttached(payload: EventPayload<'proof.attached'>): void {
    emit('proof.attached', payload);
}

export function emitClosureSummaryViewed(payload: EventPayload<'closure_summary.viewed'>): void {
    emit('closure_summary.viewed', payload);
}

export function emitClosureVerified(payload: EventPayload<'closure.verified'>): void {
    emit('closure.verified', payload);
}

export function emitNextActionCreated(payload: EventPayload<'next_action.created'>): void {
    emit('next_action.created', payload);
}

export function emitClientError(payload: EventPayload<'client.error'>): void {
    emit('client.error', payload);
}
