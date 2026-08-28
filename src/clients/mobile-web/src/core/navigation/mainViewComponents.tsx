/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The components `mainView` renders, lifted out of it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `check:file-sizes` caps mobile-web source at 800 lines. `mainView.tsx` sat at
 * 775, and this wave adds a farm-wide panel, a farm-wide summary prop and two
 * hook-bearing headline components — which would have taken it past the cap.
 * The pre-existing violation in `i18n/translations.ts` was cleared earlier in
 * this same wave; handing a fresh one back in its place would be a poor trade.
 * So: split, not suppress. Third file split this session, same approach.
 *
 * WHY *THESE* FOUR
 * ----------------
 * `mainView` is a table of render FUNCTIONS, not components — `routeContext.ts`
 * keeps them free of hook calls so the cascade can invoke them conditionally.
 * Anything needing `useLanguage` therefore has to be a real component in the
 * tree, and this file is where those live. `NotQueuedForServerBadge` was
 * already one of them for exactly that reason; `LabourLogBanner` is pure
 * presentation with no hooks and travels with it rather than being marooned.
 *
 * THE MOVE IS VERBATIM. Every component below is byte-identical to what
 * `mainView.tsx` shipped at `a8d40d0f`, apart from the one wording change
 * called out inside `NotQueuedForServerBadge` and the two new components at the
 * bottom. The rendered DOM is unchanged, which is why this split does not
 * invalidate the viewport measurements taken against `mainView`.
 *
 * `mainView.tsx` RE-EXPORTS `NotQueuedForServerBadge` and `LabourLogBanner`, so
 * the two existing test files that import them from there keep working with the
 * SAME component identity — `labour-log-banner.test.tsx` compares
 * `el.type === LabourLogBanner`, which a second copy would silently break.
 */
import React from 'react';
import { Users, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { SYNC_HONESTY_I18N_KEYS } from '../../features/sync/status/syncHonestyState';

/**
 * Labour Phase 2 -> Phase 1, Task T2 (review round 1, finding B1) — the DURABLE
 * half of the skipped-save truth.
 *
 * The toast that reports a dropped record self-destructs; the "Saved to Ledger"
 * panel this sits inside persists until the farmer navigates away. Without this
 * line the reassuring half of the story outlives the honest half, on exactly the
 * screen a farmer looks at to decide whether their day is recorded.
 *
 * THE THREE-VALUE RULE IS INSIDE THIS COMPONENT ON PURPOSE. `syncQueued` is
 * `boolean | null`, and `null` means demo mode — no enqueue was attempted, so
 * there is no evidence in either direction and we make NO claim. A caller
 * writing `{item.syncQueued && ...}` or `{!item.syncQueued && ...}` would turn
 * "I don't know" into "it failed", which is the same class of error pointed the
 * other way. Keeping the `!== false` guard here means there is one place to get
 * it right, and one place to test it.
 */
export const NotQueuedForServerBadge: React.FC<{ syncQueued: boolean | null | undefined }> = ({ syncQueued }) => {
    const { t } = useLanguage();

    if (syncQueued !== false) return null;

    return (
        <p className="mt-2 text-[11px] font-bold text-amber-700">
            {/* AMBER, not red, and it never touches the headline above it —
                that headline is TRUE for every log that reaches this screen
                (`confirmAndSave` -> `repo.batchSave` ran before the enqueue was
                even attempted). What is false is only the IMPLIED "and it is on
                its way", so the fix is to state the fact, not to weaken a true
                statement into a vaguer one.

                The trailing clause used to be hardcoded English here, so a
                Marathi farmer read one sentence in two scripts. Both halves are
                i18n now; report item C1 is closed. */}
            {t(SYNC_HONESTY_I18N_KEYS.ON_PHONE)} — {t('sync.notFiledBadgeTail')}
        </p>
    );
};

/**
 * spec: 2026-07-13-labour-attendance-approval-design (Task 3.5)
 *
 * Replaces the Task-3.4 dismissible hint. Founder ask #1 (more visible,
 * matching the app's established aesthetic) + ask #2 (the ✕ becomes a "back
 * to Labour Management" action, not a dismiss — there is no dismiss any
 * more). Styling borrows the labour hub's own voice-card treatment
 * (LabourHub.tsx: rounded-[24px], emerald gradient, white/20 icon tile,
 * font-black white title, trailing white/20 pill) so the farmer reads this
 * as the SAME feature continuing onto this screen — while carrying no
 * neutral grays of its own, so it doesn't clash with mainView's stone
 * chrome even though the labour feature itself is built on slate.
 */
export const LabourLogBanner: React.FC<{ onBackToLabour: () => void }> = ({ onBackToLabour }) => (
    <button
        type="button"
        onClick={onBackToLabour}
        data-testid="labour-log-banner"
        aria-label="कामगार व्यवस्थापनाकडे परत जा — back to Labour Management"
        className="relative mb-3 flex w-full items-center gap-3 overflow-hidden rounded-[20px] bg-gradient-to-br from-emerald-500 to-emerald-700 p-3.5 text-left shadow-[0_14px_28px_-12px_rgba(5,150,105,0.6)] transition-transform active:scale-[0.99] animate-in fade-in slide-in-from-top-2 duration-300"
    >
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white">
            <Users size={22} strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-black text-white">कामगार व्यवस्थापनासाठी नोंद</span>
            {/* Task 7 (labour-v2-release-1) — DELETED "हजेरी · " from this
                subtitle: it named attendance among what you can voice-log
                here, but no attendance capture exists anywhere in the
                Labour feature. */}
            <span className="block truncate text-[11.5px] font-semibold text-emerald-50/90">मजूर · मजुरी बोला</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-[11px] font-extrabold text-white">
            <ArrowLeft size={13} strokeWidth={2.6} />
            कामगार व्यवस्थापन
        </span>
    </button>
);

/**
 * LABOUR_PHASE2 Phase 6 — Shram Sathi's own voice on the processing screen.
 *
 * Was: "Your Shram sathi is trying to understand what work you did today..." —
 * English on a Marathi-first surface, and THIRD person about a character who
 * speaks in the first person everywhere else (`WelcomeScreen.tsx:148` ships
 * `मी श्रम साथी…`, and the Understanding-Meter design states the rule verbatim:
 * the subject of any gap is Shram Sathi, never the farmer).
 *
 * PROPOSED COPY, PENDING FOUNDER CONFIRMATION (ruling §1.4).
 */
export const ShramSathiUnderstanding: React.FC = () => {
    const { t } = useLanguage();
    return (
        <h3 className="text-xl font-bold text-stone-800 mb-3 leading-snug">
            {t('shramSathi.understanding')}
        </h3>
    );
};

/**
 * LABOUR_PHASE2 Phase 6 — the post-save headline.
 *
 * Was: "Saved to Ledger". That made a DURABILITY claim — the ledger, i.e. the
 * farm records — over a record that at this instant exists only on the handset.
 * What IS provable here is that `confirmAndSave` -> `repo.batchSave` ran, and
 * that is exactly what the ON_PHONE claim says. Same string as the header chip
 * and the save toast: three surfaces, one claim, no fourth dialect (`R6`).
 *
 * THE SHORT FORM, AT text-3xl — and that is a measured decision, not a
 * shortcut. The long `sync.onPhoneFull` was drafted for this slot and L5b
 * measured it at ~34 characters against "Saved to Ledger"'s 15; the short form
 * comes in at 190.42px on ONE line, 34px NARROWER than the string it replaces,
 * and moves the fold by 0px. The long form is explicitly NOT authorised here.
 * `sync.onPhoneFull` stays in the i18n table as correct copy with no surface
 * today — the same standing as `sync.onServerFull`.
 */
export const SavedLocallyHeadline: React.FC = () => {
    const { t } = useLanguage();
    return (
        <h2 className="text-3xl font-bold text-stone-800 mb-6 tracking-tight">
            {t(SYNC_HONESTY_I18N_KEYS.ON_PHONE)}
        </h2>
    );
};
