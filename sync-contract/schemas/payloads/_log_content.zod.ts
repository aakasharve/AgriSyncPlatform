// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — WHAT SATHI UNDERSTOOD,
// as the phone holds it, carried to the server so no phone ever rebuilds a farmer's
// record by guessing it back from flattened task lines.
//
// THE DOCUMENT IS THE PHONE'S OWN BUCKETS, COPIED. Each item keeps its values, units,
// `mix[]`, carrier fields, `numbers{…spokenText}`, `sourceText`, `provenance` and
// `provenanceVerified` exactly as the phone wrote them; the server stores the document
// verbatim (one immutable row per record version, `ssf.daily_log_contents`) and the
// pull hands it back. Labour is NOT here: it has its own structured path.
//
// LOOSE ON PURPOSE, exactly like `manualDraft` (create_daily_log.zod.ts, `ZDraftBucket`):
// `MutationQueue.enqueue` safe-parses every payload and THROWS on failure, so a strict
// per-field schema would let one unexpected field cost the farmer his whole day (P9).
// What IS enforced — here and, identically, at the server's sync boundary
// (`LogContentDocument.Validate`) — is the STRUCTURE: only the known keys, each bucket
// an array of objects with a string `id`, and one size cap.
//
// NOT a `*Payload` export, so the C# generator and the payload barrel do not treat it as
// a mutation. The `.superRefine` makes it a ZodEffects, which the generator emits as
// `object` (a raw JSON element) — the server reads the document raw and never through a
// lossy generated record.
import { z } from 'zod';

/** The document format. Bumped only when a reader must interpret it differently. */
export const LOG_CONTENT_SCHEMA_VERSION = 1;

/**
 * One cap, the same number the server enforces (`LogContentDocument.MaxBytes`) and the
 * same as the manual draft's (`PushSyncBatchHandler.MaxManualDraftBytes`): a real day is a
 * few KB, even in Devanagari (3 bytes a character).
 */
export const LOG_CONTENT_MAX_BYTES = 64 * 1024;

/** The longest item id the server accepts. Local ids are short (`irr_1730000000000`, UUIDs). */
export const LOG_CONTENT_ITEM_ID_MAX = 128;

/** His whole spoken sentence (founder D-40 §3). Far above any real recording. */
export const LOG_CONTENT_TRANSCRIPT_MAX = 20000;

/** The seven item buckets, in the order the server projects task lines from them. */
export const LOG_CONTENT_BUCKETS = [
    'cropActivities',
    'irrigation',
    'inputs',
    'observations',
    'machinery',
    'activityExpenses',
    'plannedTasks',
] as const;

export type LogContentBucket = typeof LOG_CONTENT_BUCKETS[number];

const ZContentItem = z.object({
    id: z.string().min(1).max(LOG_CONTENT_ITEM_ID_MAX),
}).passthrough();

const ZContentBucket = z.array(ZContentItem);

const LogContentObject = z.object({
    schema: z.literal(LOG_CONTENT_SCHEMA_VERSION),
    /** When the phone captured it (`meta.createdAtISO`), the time its task lines carry. */
    capturedAtUtc: z.string().max(40).optional(),
    /** His whole words, as the phone holds them (founder D-40 §3). Personal data: erased with the rest. */
    fullTranscript: z.string().max(LOG_CONTENT_TRANSCRIPT_MAX).optional(),
    cropActivities: ZContentBucket.optional(),
    irrigation: ZContentBucket.optional(),
    inputs: ZContentBucket.optional(),
    observations: ZContentBucket.optional(),
    machinery: ZContentBucket.optional(),
    activityExpenses: ZContentBucket.optional(),
    plannedTasks: ZContentBucket.optional(),
    /** The day's disturbance chip, as the phone holds it (an object, not a bucket). */
    disturbance: z.object({}).passthrough().optional(),
}).strict();

/** UTF-8 bytes of the document as it goes on the wire (`JSON.stringify`, no spaces). */
export function logContentByteLength(content: unknown): number {
    return new TextEncoder().encode(JSON.stringify(content)).length;
}

export const LogContentSchema = LogContentObject.superRefine((content, ctx) => {
    if (logContentByteLength(content) > LOG_CONTENT_MAX_BYTES) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `content exceeds ${LOG_CONTENT_MAX_BYTES} bytes`,
        });
    }
    // Review N2 — an item's id is how a later version names the SAME item (its task line, its
    // history), so two items in one bucket may not share one. Same rule as the server.
    for (const bucket of LOG_CONTENT_BUCKETS) {
        const seen = new Set<string>();
        for (const item of content[bucket] ?? []) {
            if (seen.has(item.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [bucket],
                    message: `content bucket '${bucket}' holds two items with the same id`,
                });
                break;
            }
            seen.add(item.id);
        }
    }
});

export type LogContentPayloadType = z.infer<typeof LogContentObject>;
