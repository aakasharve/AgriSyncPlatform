/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F2; F3) - the ONE full-screen layer of the voice journey. From the green door "झालेले काम
 * सांगा" to the saved screen the whole journey (crop, plot, the mic card, recording, the step list, the saved screen, the
 * nothing-understood screen) is drawn inside it: no farm header, no tabs, no approval chips, no bottom bar (`AppContent` steps them
 * away while a layer is open, `voiceLayerSignal`).
 *
 * Frame, as the approved design draws the phone: a top row (the place chip on the left, "मागे" when the caller gives one; the
 * right-hand chip only when the caller really holds that number - never invented), a body that scrolls, and a bottom slot that
 * never scrolls (the saved screen's "आणखी सांगा" bar is drawn into it, `useVoiceLayerBottom`). Safe areas are respected top and bottom.
 * Drawn through a portal into the body: the app's scroll area can neither clip it nor move it. z-45: over the bottom bar (z-40), under
 * every sheet and pop-up the journey opens (z-50 and above).
 *
 * Part 03 B1 (final design): a step with its own header drops the top row while it is on screen (`useHideVoiceLayerTop`); the back
 * control the caller gave stays mounted, hidden, so the phone's back button still works.
 */
import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { PHONE_COLUMN } from '../phoneColumn';
import type { DailyLog } from '../../../../types';
import { useMonthChip } from './monthChip';
import { enterVoiceLayer } from './voiceLayerSignal';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SAFE_TOP = 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';

const BottomSlot = createContext<HTMLElement | null | undefined>(undefined);

/** The layer's bottom slot: `undefined` outside a layer (the caller draws its bar in its own flow, as before), `null` for the one pass before the slot exists. */
export const useVoiceLayerBottom = (): HTMLElement | null | undefined => useContext(BottomSlot);

const TopRowSwitch = createContext<((hidden: boolean) => void) | undefined>(undefined);

/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — a step that draws its own header (the result's final design: no
 * "मागे" bar, the place in its own top card) asks the layer to drop its top row while it is on screen. The row's back control stays
 * MOUNTED (hidden), so the phone's back button keeps working (`SavedScreenBack` owns the history entry). Outside a layer: nothing.
 */
export const useHideVoiceLayerTop = (active = true): void => {
    const set = useContext(TopRowSwitch);
    useLayoutEffect(() => {
        if (!set || !active) return undefined;
        set(true);
        return () => set(false);
    }, [set, active]);
};

export interface VoiceLayerProps {
    /** "Crop · plot" - absent while no place is chosen yet. */
    placeLabel?: string | ((language: string | undefined) => string | undefined);
    /** The right-hand chip - ONLY a number the app already holds. Absent = none is drawn. */
    rightChip?: string;
    /** "या महिन्यात N दिवस": the days this month with a saved log on this plot, drawn only when the phone's pull covers it (`monthChip`). */
    monthOf?: { history: readonly DailyLog[] | undefined; plotId: string | null };
    /** The "मागे" control, when this step has one of its own. */
    back?: React.ReactNode;
    /** Which part of the journey this is (for tests and logs). */
    step: string;
    children: React.ReactNode;
}

export const VoiceLayer: React.FC<VoiceLayerProps> = ({ placeLabel: place, rightChip: given, monthOf, back, step, children }) => {
    const language = useOptionalLanguage()?.language;
    const month = useMonthChip(monthOf?.history, monthOf?.plotId, language);
    const rightChip = given ?? month;
    const placeLabel = typeof place === 'function' ? place(language) : place;
    const [bottom, setBottom] = useState<HTMLElement | null>(null);
    const [topHidden, setTopHidden] = useState(false);
    useLayoutEffect(() => enterVoiceLayer(), []);
    if (typeof document === 'undefined') return <>{children}</>;
    const hasTop = !!(back || placeLabel || rightChip);
    return createPortal(
        <div className="fixed inset-0 z-[45] flex justify-center bg-stone-100" data-testid="voice-layer" data-step={step}>
            <div className={`flex h-full min-h-0 flex-col bg-stone-50 ${PHONE_COLUMN}`} style={{ fontFamily: SANS }}>
                {hasTop && (
                    // Hidden by the step on screen (`useHideVoiceLayerTop`): the same element, so the back control is never re-mounted.
                    <div className={topHidden ? 'hidden' : 'flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2'}
                        style={topHidden ? undefined : { paddingTop: `calc(0.5rem + ${SAFE_TOP})` }} data-testid="voice-layer-top" data-hidden={topHidden ? 'yes' : 'no'}>
                        {back}
                        {placeLabel && !topHidden && (
                            <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-[#DDE3DA] bg-white px-3 py-1 text-[14px] font-extrabold text-[#1C1917]" data-testid="voice-layer-place">
                                <MapPin size={14} className="shrink-0 text-[#0F6B3A]" aria-hidden="true" />
                                <span className="truncate">{placeLabel}</span>
                            </span>
                        )}
                        {rightChip && !topHidden && (
                            <span className="ml-auto shrink-0 rounded-full bg-[#E4F3EB] px-3 py-1 text-[13px] font-extrabold text-[#0F6B3A]" data-testid="voice-layer-chip">{rightChip}</span>
                        )}
                    </div>
                )}
                {(!hasTop || topHidden) && <div className="shrink-0" style={{ height: SAFE_TOP }} aria-hidden="true" />}
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4" data-testid="voice-layer-body">
                    <TopRowSwitch.Provider value={setTopHidden}>
                        <BottomSlot.Provider value={bottom}>{children}</BottomSlot.Provider>
                    </TopRowSwitch.Provider>
                </div>
                <div ref={setBottom} className="shrink-0 empty:hidden" data-testid="voice-layer-bottom" />
            </div>
        </div>,
        document.body,
    );
};

export default VoiceLayer;
