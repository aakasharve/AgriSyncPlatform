/**
 * The provenance of a parse, BOUND TO THE DRAFT OBJECT that parse produced.
 *
 * Why (PR #82 review, B005): the voice state keeps the LAST parse's provenance
 * until something resets it, while the draft on screen can be replaced by other
 * paths (an edit opened from Reflect or from today's activity list) that never
 * touch provenance. Reading that shared value at the labour door's बरोबर could
 * stamp a record with an earlier, unrelated parse's `sourceAiJobId`.
 *
 * The parse binds its provenance to the exact draft object it hands to the
 * screen (`useVoiceRecorder.commitParsedDraft`). A reader asks for the
 * provenance OF a draft: a draft that no parse produced has none. Absent is the
 * safe direction (no claim), never a borrowed one.
 *
 * A WeakMap keyed by object identity: nothing is added to the draft's shape, and
 * a draft that is dropped takes its entry with it.
 */
import type { LogProvenance } from '../../domain/ai/LogProvenance';

const provenanceByDraft = new WeakMap<object, LogProvenance>();

/** Record `provenance` as the origin of `draft`; returns the same draft object. */
export function bindDraftProvenance<T extends object>(draft: T, provenance: LogProvenance | null | undefined): T {
    if (provenance) {
        provenanceByDraft.set(draft, provenance);
    } else {
        provenanceByDraft.delete(draft);
    }
    return draft;
}

/** The provenance bound to this exact draft object, or undefined. */
export function draftProvenance(draft: object | null | undefined): LogProvenance | undefined {
    return draft ? provenanceByDraft.get(draft) : undefined;
}
