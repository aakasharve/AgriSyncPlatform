/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 / D-60) — two facts about a parse that
 * travel WITH the exact draft object it produced, the way `draftProvenance.ts` carries its provenance:
 *
 *   - the DAY it is for, when he chose a past day before speaking ("त्या दिवसाचं काम सांगा", D-60). The record is
 *     saved on that day (the log's own `date`, which `create_daily_log` carries as `logDate`); the time stays the moment
 *     he spoke — nothing is invented;
 *   - WHY the voice auto-save did not save it (D-58): nothing was understood, Sathi thinks it was another plot, or the
 *     phone could not write it. The screen that then shows it says exactly that, with his words and what was understood
 *     still on it (nothing he said is dropped, P9 / P10), and keeps the recording so a later save names it.
 *
 * A WeakMap keyed by object identity: nothing is added to the draft's shape, and a dropped draft takes its entry along.
 */
import type { VoiceRecordingRef } from './useVoiceRecorder.types';

/** Why the voice auto-save handed a parse back instead of saving it. */
export type DeclineReason = 'unclear' | 'otherPlot' | 'notWritten';

interface DraftFacts {
    day?: string;
    decline?: { reason: DeclineReason; recording?: VoiceRecordingRef };
    /** Lane OF fix 2 (carried) — who must hear when this draft is saved LATER, on "तपासा आणि जतन करा". */
    afterSave?: (logIds: string[]) => void;
}

const factsByDraft = new WeakMap<object, DraftFacts>();

const update = (draft: object, next: DraftFacts): void => {
    factsByDraft.set(draft, { ...factsByDraft.get(draft), ...next });
};

/** The day (`yyyy-MM-dd`) this parse is for, when he chose one; returns the same draft. */
export function bindDraftDay<T extends object>(draft: T, day: string | undefined): T {
    if (day) update(draft, { day });
    return draft;
}

/** The day this draft is for, or undefined (= the day it is saved, today). */
export function draftDay(draft: object | null | undefined): string | undefined {
    return draft ? factsByDraft.get(draft)?.day : undefined;
}

/** Record why the auto-save handed this draft back (and the recording it came from). */
export function bindDraftDecline<T extends object>(draft: T, reason: DeclineReason, recording?: VoiceRecordingRef): T {
    update(draft, { decline: { reason, recording } });
    return draft;
}

/** Why this draft was handed back, or undefined when no auto-save looked at it. */
export function draftDecline(draft: object | null | undefined): DraftFacts['decline'] {
    return draft ? factsByDraft.get(draft)?.decline : undefined;
}

/**
 * Lane OF fix 2 (carried) — what must happen once this draft is saved on "तपासा आणि जतन करा" (it was handed back, not
 * saved by itself): the request that asked for it (e.g. "पुन्हा सांगा" on a recording in आवाज नोंदी) hears "saved", exactly
 * as it does when the auto-save saves it. `undefined` clears it (it is told once). Returns the same draft.
 */
export function bindDraftAfterSave<T extends object>(draft: T, afterSave: ((logIds: string[]) => void) | undefined): T {
    update(draft, { afterSave });
    return draft;
}

/** Who must hear that this draft was saved (once), or undefined. */
export function draftAfterSave(draft: object | null | undefined): DraftFacts['afterSave'] {
    return draft ? factsByDraft.get(draft)?.afterSave : undefined;
}
