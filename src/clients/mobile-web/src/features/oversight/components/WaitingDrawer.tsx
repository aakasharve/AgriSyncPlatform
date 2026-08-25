/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * WaitingDrawer — Task 5 (design doc §3, "THE WAITING DRAWER").
 *
 * This is the screen the whole feature exists for: decisions above
 * information, in this fixed order —
 *
 *   1. Band 1 · needs your decision  — one amber row PER DECISION KIND
 *      (`model.decisions`), never one card per record. Finding F6 added the
 *      `unqueueable` kind here: records that reached no sync queue at all.
 *      It is a SEPARATE row from `failedSend` with a separate icon and a
 *      separate string, because nothing will ever send those records and
 *      `failedSend`'s copy promises the opposite.
 *   2. Band 2 · since you last looked — the briefing card
 *      (`OversightBriefingCard.tsx`, split out to keep both files under the
 *      800-line cap).
 *   3. The Seen control, after all content, "so the thumb travels over the
 *      material" (spec §3).
 *
 * Presentational only — props in, markup out. No Dexie, no storage reads,
 * no `infrastructure/` imports. Every farmer-facing string comes from
 * `oversightTranslations.ts` via `resolveOversightString()` (spec §6).
 *
 * THE TWO RULES THIS COMPONENT EXISTS TO ENFORCE
 * ------------------------------------------------
 * RULE 1 — Seeing is never approving (spec §P-A). `onAcknowledge` is the
 * ONLY thing the Seen button calls. This component holds no code path that
 * touches `model.decisions` as a result of that click — Band 1 renders
 * straight off the `model` prop the caller supplies, and nothing in this
 * file mutates it or hides a row locally. Awareness (the checkpoint) and
 * decision (`verification.status`) are different axes computed in
 * different places (`oversightSelectors.ts` already keeps `decisions`
 * independent of `checkpointISO`); this component cannot collapse them
 * because it never reads or writes either directly — it only renders
 * `model` and calls the two callbacks it was given.
 * Pinned by `acknowledging_does_not_change_any_decision_row`.
 *
 * RULE 2 — The Seen control is never emerald (spec §P-G). `bg-emerald-600`
 * already means Approve elsewhere in this app (`ReviewInbox.tsx:97`,
 * `AttentionCard.tsx:121`). White background, `2px` neutral (`stone-400`)
 * border — never green, so colour never says "approved" regardless of the
 * words on the button.
 * Pinned by `the_seen_control_is_not_emerald`.
 *
 * DELEGATED DECISIONS (spec §3): when `decision.holderName` is non-null,
 * the row renders with **no action affordance** — a plain, non-interactive
 * `<div>`, not a `<button>` — and names the holder instead. The owner keeps
 * full visibility; only the buttons differ. `oversightSelectors.ts`'s own
 * contract only ever sets `holderName` on an `'approval'` decision, so this
 * only ever applies to that kind.
 *
 * FAILED ACKNOWLEDGEMENT (spec §P-D): when `status === 'failed'`
 * (`useOversightAcknowledgement`'s hook state after a rejected write), a
 * visible retry affordance renders beside the Seen button. Reuses
 * `retryAffordance` — the SAME key `oversightTranslations.ts` already
 * declares for the failed-sends decision row's retry (see that file's
 * "TASK 5 ADDITIONS" header note on why this is a deliberate second use of
 * one generic "Retry" key, not a new near-duplicate one).
 */
import React from 'react';
import { Eye, Gavel, Clock, AlertTriangle, FileX, ChevronRight, RefreshCw } from 'lucide-react';

import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import type { OversightAcknowledgementStatus } from '../useOversightAcknowledgement';
import type { OversightDecision, OversightModel, OversightPerson } from '../oversightSelectors';
import { formatOversightTemplate } from '../formatOversightTemplate';
import OversightBriefingCard from './OversightBriefingCard';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

const DECISION_ICONS: Record<OversightDecision['kind'], React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
    approval: Gavel,
    dayNotClosed: Clock,
    failedSend: AlertTriangle,
    // Finding F6 — a DIFFERENT glyph from `failedSend`'s on purpose. These
    // two rows can appear together, and if they shared an icon the owner
    // would read them as one thing said twice. `AlertTriangle` also carries
    // "act on me", which is precisely what this row cannot ask for.
    //
    // CHANGE 5 — WAS `CloudOff`, AND A CLOUD MEANS NOTHING HERE.
    // A smallholder farmer has no mental model in which a cloud holds his
    // records, so the glyph carried no information at any size; rendered at
    // this row's 14px and compared side by side against the candidates, its
    // thin diagonal-slash-over-cloud also collapses into a smudge.
    //
    // `FileX` is a written page with a cross through it. Both halves are
    // things he can name: a page IS what a record is to him, and a cross
    // through it is the plainest available "this one did not go in". It is
    // also the app's OWN metaphor for the destination — the farm book,
    // शेतनोंद (`farmBookOpen`) — so the row reads as "a page that never made
    // it into the book", which is exactly what
    // `unsendableRecordsLine` says in words.
    //
    // Still a STATE, never a request: no triangle, no exclamation, nothing
    // urgent. That is the F6 constraint above, and `FileX` keeps it —
    // `failedSend`'s `AlertTriangle` remains the only "act on me" glyph in
    // this list.
    unqueueable: FileX,
};

/** Resolves a decision's row text — one key per §3's Band-1 table, the
 * delegated variant substituted only for the (only ever `'approval'`) kind
 * that can carry a `holderName`. Never a literal sentence written here. */
function decisionRowText(language: Language, decision: OversightDecision): string {
    if (decision.holderName !== null) {
        return formatOversightTemplate(resolveOversightString(language, 'delegatedLine'), {
            count: decision.count,
            name: decision.holderName,
        });
    }
    switch (decision.kind) {
        case 'approval':
            return formatOversightTemplate(resolveOversightString(language, 'decisionLine'), { count: decision.count });
        case 'dayNotClosed':
            return resolveOversightString(language, 'dayNotClosedLine');
        case 'failedSend':
            return formatOversightTemplate(resolveOversightString(language, 'failedSends'), { count: decision.count });
        case 'unqueueable':
            // Finding F6 — its OWN key, never `failedSends`. See that key's
            // note in `oversightTranslations.ts` for why the retry-promising
            // wording may not be reused for records nothing will ever send.
            return formatOversightTemplate(
                resolveOversightString(language, 'unsendableRecordsLine'),
                { count: decision.count },
            );
    }
    // Totality, not a fallback. The `default: return ''` that stood here
    // would have rendered finding F6's new kind as a BLANK row — a row the
    // owner can see and tap that says nothing. `never` makes a future kind
    // fail `tsc` here the same way it already fails at `DECISION_ICONS`.
    const exhaustive: never = decision.kind;
    return exhaustive;
}

function DecisionRow({
    language,
    decision,
    onOpen,
}: {
    language: Language;
    decision: OversightDecision;
    onOpen?: (decision: OversightDecision) => void;
}): React.ReactElement {
    const isDelegated = decision.holderName !== null;
    const text = decisionRowText(language, decision);
    const Icon = DECISION_ICONS[decision.kind];
    const testId = `waiting-drawer-decision-${decision.kind}`;

    const iconCircle = (
        <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                isDelegated ? 'border-stone-300 bg-stone-100 text-stone-500' : 'border-amber-200 bg-amber-100 text-amber-800'
            }`}
        >
            <Icon size={16} strokeWidth={2.25} />
        </span>
    );

    // Spec §3 "Delegated case": SAME row, SAME position, NO action
    // affordance — a plain <div>, never a <button>, so it cannot fire
    // `onOpen` and has no interactive affordance for a screen reader or a
    // tap either.
    if (isDelegated) {
        return (
            <div
                data-testid={testId}
                className="flex w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm"
            >
                {iconCircle}
                <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-stone-700" style={fontStyleFor(text)}>
                    {text}
                </span>
            </div>
        );
    }

    return (
        <button
            type="button"
            data-testid={testId}
            onClick={() => onOpen?.(decision)}
            className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-3.5 text-left shadow-sm"
        >
            {iconCircle}
            <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-stone-800" style={fontStyleFor(text)}>
                {text}
            </span>
            <ChevronRight size={16} className="shrink-0 text-amber-400" />
        </button>
    );
}

export interface WaitingDrawerProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /** Read-only — every row and every count is derived from this model,
     * never a literal (spec §P-F). */
    model: OversightModel;
    /** `useOversightAcknowledgement`'s `status` (spec §P-D). */
    status: OversightAcknowledgementStatus;
    /** Writes ONLY the awareness checkpoint (spec §P-A). Never approves,
     * never touches `verification.status`. */
    onAcknowledge: () => void;
    /** Tapping a (non-delegated) decision row opens the existing filtered
     * detail view (spec §3). Approving happens there — this drawer never
     * approves. Omit to render non-navigating rows. */
    onOpenDecision?: (decision: OversightDecision) => void;
    /** Tapping a person (or the unattributed) row opens the existing
     * filtered detail view (spec §3). Omit to render non-navigating rows. */
    onOpenPerson?: (person: OversightPerson) => void;
}

const WaitingDrawer: React.FC<WaitingDrawerProps> = ({
    language,
    model,
    status,
    onAcknowledge,
    onOpenDecision,
    onOpenPerson,
}) => {
    const bandDecisionsHeaderText = resolveOversightString(language, 'bandDecisionsHeader');
    const seenControlText = resolveOversightString(language, 'seenControl');
    const seenControlHintText = resolveOversightString(language, 'seenControlHint');
    const retryAffordanceText = resolveOversightString(language, 'retryAffordance');

    const isSaving = status === 'saving';
    const isFailed = status === 'failed';

    return (
        <div data-testid="waiting-drawer" className="flex flex-col gap-3 p-3.5">
            {model.decisions.length > 0 && (
                <div>
                    <div
                        className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-600"
                        style={fontStyleFor(bandDecisionsHeaderText)}
                    >
                        {bandDecisionsHeaderText}
                    </div>
                    <div className="flex flex-col gap-2">
                        {model.decisions.map((decision) => (
                            <DecisionRow key={decision.kind} language={language} decision={decision} onOpen={onOpenDecision} />
                        ))}
                    </div>
                </div>
            )}

            <OversightBriefingCard language={language} model={model} onOpenPerson={onOpenPerson} />

            {/* THE SEEN CONTROL — spec §3: "at the bottom, after all
                content, so the thumb travels over the material." Spec §P-G:
                white background, 2px stone-400 border — NEVER emerald. */}
            <div className="mt-1">
                <button
                    type="button"
                    data-testid="waiting-drawer-seen-button"
                    onClick={onAcknowledge}
                    disabled={isSaving}
                    aria-busy={isSaving}
                    className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-stone-400 bg-white text-[14.5px] font-bold text-stone-700 transition-opacity ${
                        isSaving ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                    style={fontStyleFor(seenControlText)}
                >
                    <Eye size={18} strokeWidth={2.25} />
                    <span>{seenControlText}</span>
                </button>

                {isFailed && (
                    <div
                        data-testid="waiting-drawer-seen-retry"
                        role="alert"
                        className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700"
                    >
                        <RefreshCw size={14} strokeWidth={2.25} />
                        <button
                            type="button"
                            data-testid="waiting-drawer-seen-retry-button"
                            onClick={onAcknowledge}
                            className="underline underline-offset-2"
                            style={fontStyleFor(retryAffordanceText)}
                        >
                            {retryAffordanceText}
                        </button>
                    </div>
                )}

                <p
                    className="mt-2 text-center text-[10.5px] leading-relaxed text-stone-400"
                    style={fontStyleFor(seenControlHintText)}
                >
                    {seenControlHintText}
                </p>
            </div>
        </div>
    );
};

export default WaitingDrawer;
