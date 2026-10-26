/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H08) — what a tap on the आजची कामे tab card
 * does to that tab: start it fresh on its work home, or leave it where it is.
 *
 *   - the ENTRY flow (home, crop, plots + mic): back to the work home, fresh;
 *   - the SAVED card (status 'success'): the entry is already saved, so nothing is lost — the card is
 *     closed (the same reset as its own "आणखी नोंद करा") and the work home opens (I12-V1-m2);
 *   - the REVIEW form of a parsed entry (manual mode with a crop/plot chosen — its draft lives only in
 *     that form) or a parse in progress: stays. The review has its own "मागे" (ReviewBackBar).
 * (While the mic itself listens, the flow ignores the request.)
 */
import { useCallback } from 'react';
import type { AppStatus, InputMode, PageView } from '../../../../domain/types/farm.types';

export interface WorkTabState { mode: InputMode; hasActiveLogContext: boolean; status: AppStatus }
export type WorkTabTap = 'home' | 'close-saved-then-home' | 'stay';

export function workTabTapAction(state: WorkTabState): WorkTabTap {
    if (state.status === 'success') return 'close-saved-then-home';
    if (state.status === 'processing' || state.status === 'recording') return 'stay';
    return state.mode !== 'voice' && state.hasActiveLogContext ? 'stay' : 'home';
}

/** Kept for callers that only need yes/no: may the tap open the work home? */
export function opensWorkHomeOnTabTap(state: WorkTabState): boolean {
    return workTabTapAction(state) !== 'stay';
}

export interface WorkTabDeps {
    setMainView: (view: PageView) => void;
    requestLogHome: () => void;
    /** Close the saved card: the voice reset (`handleReset`). */
    resetSaved: () => void;
    setMode: (mode: InputMode) => void;
}

/**
 * The header's page-switcher handler (`AppHeader.onViewChange`). Any card switches the page as before;
 * the आजची कामे card also asks for its work home per `workTabTapAction`.
 */
export function handleWorkTabViewChange(view: PageView, state: WorkTabState, deps: WorkTabDeps): void {
    if (view === 'log') {
        const action = workTabTapAction(state);
        if (action === 'close-saved-then-home') {
            // the same two steps as the saved card's own "आणखी नोंद करा" (mainView), then home
            deps.resetSaved();
            deps.setMode('voice');
        }
        if (action !== 'stay') deps.requestLogHome();
    }
    deps.setMainView(view);
}

/** `handleWorkTabViewChange` bound to the live state, for `AppContent`'s header. */
export function useWorkTabViewChange(state: WorkTabState, deps: WorkTabDeps): (view: PageView) => void {
    const { mode, hasActiveLogContext, status } = state;
    const { setMainView, requestLogHome, resetSaved, setMode } = deps;
    return useCallback(
        (view: PageView) => handleWorkTabViewChange(view, { mode, hasActiveLogContext, status }, { setMainView, requestLogHome, resetSaved, setMode }),
        [mode, hasActiveLogContext, status, setMainView, requestLogHome, resetSaved, setMode],
    );
}
