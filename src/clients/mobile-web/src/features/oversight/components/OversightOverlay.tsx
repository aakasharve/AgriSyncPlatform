/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 14, change 9)
 *
 * OversightOverlay — the founder, on the built screen: *"oversight page is
 * a complete separate page but its UI is merged here, so don't treat it as
 * part of the log page — it's the navigation to go to that page, so that
 * further development is easy and returning to the log page is easy."*
 *
 * Before this task, the sheet's own chrome (backdrop + title bar + close
 * button) was written inline inside `AppHeader.tsx`'s JSX, sharing one file
 * with row 1, `OversightNavCards`, `CanonicalStrip` and the farm-switcher
 * sheet — five unrelated surfaces in one component. This file IS the
 * oversight "page" now, as its own component boundary: `AppHeader` (via
 * `CanonicalStrip`'s waiting button) is purely the NAVIGATION that opens
 * it, and owns only the `isOpen` boolean — the same shape every other
 * founder-facing "open a sheet" trigger in this app already uses
 * (`FarmSwitcherSheet`, `SyncStatusDrawer`).
 *
 * AN OVERLAY, NOT A ROUTE (binding) — `createPortal` to `document.body`,
 * conditionally rendered from `isOpen`, which the caller holds in its own
 * React state. Nothing here touches `AppRoute`/`currentRoute`, so the log
 * screen underneath is never unmounted — its scroll position and any
 * in-progress plot selection survive a round trip through this overlay
 * untouched. Same portal-past-`position:sticky` fix Task 11 diagnosed for
 * this exact sheet (a `position: sticky` ancestor traps `position: fixed`
 * descendants to its own containing block) — see that history for the
 * measurement.
 *
 * ONE BACK CONTROL, ALWAYS IN THE SAME PLACE — the `X` button, top-right of
 * the sheet header, is the only explicit dismiss affordance, in the same
 * place on every open. Tapping the dimmed backdrop is the same
 * well-understood convenience `FarmSwitcherSheet`/`SyncStatusDrawer`
 * already use, not a second inconsistent control. Nothing in this file
 * reads `history`/`popstate` or depends on the Android hardware back
 * button — `isOpen`/`onClose` are plain props.
 *
 * SEEING NEVER APPROVES (spec §P-A) — enforced by `WaitingDrawer` itself
 * (see that file's own header for the two rules it exists to hold); this
 * wrapper adds no second code path that could touch a decision as a side
 * effect of opening or closing.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import WaitingDrawer from './WaitingDrawer';
import type { OversightAcknowledgementStatus } from '../useOversightAcknowledgement';
import type { OversightDecision, OversightModel } from '../oversightSelectors';

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

export interface OversightOverlayProps {
    /** Held by the caller (`AppHeader`'s `isWaitingDrawerOpen`) — this
     * component never opens or closes itself. */
    isOpen: boolean;
    language: Language;
    /** Read-only — every row and every count is derived from this model,
     * never a literal (spec §P-F). */
    model: OversightModel;
    /** `useOversightAcknowledgement`'s `status` (spec §P-D). */
    status: OversightAcknowledgementStatus;
    /** Writes ONLY the awareness checkpoint (spec §P-A). Never approves. */
    onAcknowledge: () => void;
    /** Tapping a (non-delegated) decision row opens the existing filtered
     * detail view. Omit to render non-navigating rows. */
    onOpenDecision?: (decision: OversightDecision) => void;
    /** The one back control — always the top-right `X`, plus the backdrop. */
    onClose: () => void;
}

const OversightOverlay: React.FC<OversightOverlayProps> = ({
    isOpen,
    language,
    model,
    status,
    onAcknowledge,
    onOpenDecision,
    onClose,
}) => {
    if (!isOpen || typeof document === 'undefined') return null;

    const titleText = resolveOversightString(language, 'waitingLabel');

    return createPortal(
        <div
            className="fixed inset-0 z-[150] flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
            onClick={onClose}
        >
            <div
                data-testid="waiting-drawer-sheet"
                className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-stone-50 shadow-2xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3.5 py-3">
                    <span
                        className="text-[15px] font-extrabold text-stone-800"
                        style={fontStyleFor(titleText)}
                    >
                        {titleText}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        data-testid="waiting-drawer-close"
                        aria-label="Close"
                        className="rounded-full bg-stone-100 p-2 text-stone-600 hover:bg-stone-200"
                    >
                        <X size={16} />
                    </button>
                </div>
                <WaitingDrawer
                    language={language}
                    model={model}
                    status={status}
                    onAcknowledge={onAcknowledge}
                    onOpenDecision={onOpenDecision}
                />
            </div>
        </div>,
        document.body,
    );
};

export default OversightOverlay;
