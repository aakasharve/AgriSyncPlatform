/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.4 — transcript redaction for correction events.
 *
 * A correction event exists to teach the AI *what the structure should have
 * been*: which field, what the model said, what the farmer said instead. It
 * has never needed the words the farmer spoke, and the locked ruling says it
 * must not carry them. Worker names live in exactly those words.
 *
 * This module is the single definition of "which keys are verbatim speech".
 * It is used by:
 *   - `CorrectionEventStore` — before a correction is built or POSTed;
 *   - Dexie `v23` — to clean rows already sitting unencrypted on handsets.
 *
 * Contract:
 *   - It only ever REMOVES keys. It never adds, renames, defaults or
 *     rewrites a value. Nothing here can fabricate.
 *   - It is idempotent: redacting an already-redacted value is a no-op,
 *     which is what lets the Dexie upgrade run once per farmer database on
 *     a device that holds several.
 *   - It never mutates its input.
 */

/**
 * Keys whose documented purpose is *verbatim speech*.
 *
 * Each entry is here because the schema comment says so, not because the name
 * looked transcript-shaped:
 *   - `rawTranscript`     — `LogProvenance`: "full transcript for this extraction"
 *   - `fullTranscript`    — `AgriLogResponseSchema`: the whole utterance
 *   - `sourceText`        — "the transcript chunk that produced this field"
 *   - `english`           — Sarvam voice-spine: natural-English transcript
 *   - `english_redacted`  — the same transcript with PII *tokens*; still speech
 *   - `rawText`           — `UnclearSegment`: a slice of `fullTranscript`
 *                           (its sibling `highlightRange` is documented as
 *                           "indices in fullTranscript")
 *   - `transcript`        — defensive: any future plain spelling
 *
 * DELIBERATELY NOT REDACTED — these are the structured signal, not speech:
 *   - `textRaw` on an observation note: the observation *is* its text; that
 *     is the farmer's value for the observations bucket, so removing it
 *     would destroy the correction signal this whole event exists to carry.
 *   - `summary`, `systemInterpretation`, `userMessage`: model-authored
 *     prose about the parse, not a recording of what was said.
 */
export const TRANSCRIPT_TEXT_KEYS: readonly string[] = [
    'rawTranscript',
    'fullTranscript',
    'sourceText',
    'english',
    'english_redacted',
    'rawText',
    'transcript',
];

const TRANSCRIPT_KEY_SET = new Set(TRANSCRIPT_TEXT_KEYS);

/**
 * True when `value` (or anything nested inside it) still carries a
 * transcript-bearing key. Used by tests and by the redaction assertions —
 * "prove the transcript is gone" needs its own oracle, separate from the
 * function that removed it.
 */
export function containsTranscriptText(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.some(containsTranscriptText);
    }
    if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (TRANSCRIPT_KEY_SET.has(key)) return true;
            if (containsTranscriptText(nested)) return true;
        }
    }
    return false;
}

/**
 * Deep copy of `value` with every transcript-bearing key removed at every
 * depth. Non-object leaves come back untouched — a bare string is never
 * assumed to be speech, because only the KEY tells us that.
 */
export function stripTranscriptText<T>(value: T): T {
    return stripUnknown(value) as T;
}

function stripUnknown(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stripUnknown);
    }

    if (value !== null && typeof value === 'object') {
        // Date/RegExp/Blob and friends are not correction payloads; they are
        // returned as-is rather than being flattened into `{}`.
        if (Object.getPrototypeOf(value) !== Object.prototype
            && Object.getPrototypeOf(value) !== null) {
            return value;
        }

        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (TRANSCRIPT_KEY_SET.has(key)) continue;
            out[key] = stripUnknown(nested);
        }
        return out;
    }

    return value;
}
