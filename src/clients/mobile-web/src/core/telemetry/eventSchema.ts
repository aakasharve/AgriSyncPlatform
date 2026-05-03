/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Work Closure (DWC v2) — frozen Zod registry for the 8 client-emitted
 * closure-loop events. Mirrors the C# `EventVocabulary` registry at
 * `src/apps/Analytics/Analytics.Domain/Vocabulary/EventVocabulary.cs`. The
 * CI gate `event-vocabulary-parity` (Plan §2.7) enforces lockstep between
 * the two registries — adding a 14th vocabulary entry requires a new ADR
 * (`ADR-2026-05-02_event-vocabulary.md`).
 *
 * The 5 non-client-emitted events (`log.created`, `ai.invocation`,
 * `api.error`, `worker.named`, `admin.farmer_lookup`) live exclusively
 * on the backend / server-side and therefore do not appear here.
 *
 * @module core/telemetry/eventSchema
 */

import { z } from 'zod';

const Method = z.enum(['voice', 'manual', 'wizard', 'harvest']);
const ProofType = z.enum(['photo', 'voice', 'gps']);
const Source = z.enum(['reflect_mount', 'drawer_open', 'card_focus']);
const VerifyStatus = z.enum(['Confirmed', 'Verified', 'Disputed']);

export const EventSchemas = {
    'closure.started': z.object({
        farmId: z.string().uuid(),
        method: Method,
        ts: z.number(),
    }),
    'closure.submitted': z.object({
        farmId: z.string().uuid(),
        logId: z.string().uuid(),
        method: Method,
        durationMs: z.number().int().nonnegative(),
        fields_used: z.number().int().nonnegative(),
    }),
    'closure.abandoned': z.object({
        farmId: z.string().uuid(),
        method: Method,
        durationMs: z.number().int().nonnegative(),
        lastStep: z.string(),
    }),
    'proof.attached': z.object({
        farmId: z.string().uuid(),
        logId: z.string().uuid(),
        type: ProofType,
        sizeBytes: z.number().int().optional(),
    }),
    'closure_summary.viewed': z.object({
        farmId: z.string().uuid(),
        dateKey: z.string(),
        logsCount: z.number().int().nonnegative(),
        source: Source,
    }),
    'closure.verified': z.object({
        farmId: z.string().uuid(),
        logId: z.string().uuid(),
        verifierId: z.string().uuid(),
        status: VerifyStatus,
    }),
    'next_action.created': z.object({
        farmId: z.string().uuid(),
        taskId: z.string().uuid(),
        parentLogId: z.string().uuid().optional(),
    }),
    'client.error': z.object({
        farmId: z.string().uuid().optional(),
        message: z.string(),
        stack: z.string().optional(),
    }),
} as const;

export type EventName = keyof typeof EventSchemas;
export type EventPayload<E extends EventName> = z.infer<typeof EventSchemas[E]>;
