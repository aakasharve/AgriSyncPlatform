/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — the lower half of the saved screen in the FINAL design's
 * order (result-v12-final.html `buildResult()`), under the talk card:
 *   1. Sathi's question: the slot the question card is drawn in (the container's panel; the product-purpose question of B4 is drawn
 *      here by its own builder), then the other post-save surfaces (`extras`) as the container draws them;
 *   2. "आजची बोलणी" (`TalkList`): one row per talk of the day, a tap opens the whole talk;
 *   3. the 24-hour line "काही बदल करायचा असेल तर २४ तासांत करता येईल" — only while the SERVER's change window is open (P10);
 *   4. the end button "झालं — पूर्ण शेतीचा आढावा बघा": it calls the screen's close handler (the container points it where the log
 *      ends; the same handler the self-close uses).
 *
 * Replaced here by the final design (founder 28 Nov, "one way out"): the day's earlier recordings fold (now "आजची बोलणी") and the blue
 * "आजचा आढावा बघा" detail button. "बदला" and "हे दिसतं" moved into the talk card.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../../shared/utils/haptics';
import { finalResultWords } from './finalResultWords';
import { LineGlyph, SANS } from './savedBits';
import TalkList, { type TalkRow } from './TalkList';

const SERIF = "'Noto Serif Devanagari', serif";

export interface SavedScreenLowerProps {
    /** A recording saved for a past day: its short name ("२४ ऑक्टो"); null = today. */
    onDay: string | null;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    talks: readonly TalkRow[];
    onOpenTalk: (recId: string) => void;
    /** The server's change window of the talk he just made is open now. */
    editable: boolean;
    onFinish: () => void;
}

export const SavedScreenLower: React.FC<SavedScreenLowerProps> = (p) => {
    const FW = finalResultWords(useOptionalLanguage()?.language);
    return (
        <>
            {/* The question card's place (B1 slot 4): empty = nothing drawn. */}
            <div className="empty:hidden" data-testid="vr2-question" data-slot="sathi-question">{p.questionPanel}</div>
            {p.extras}

            <TalkList rows={p.talks} title={p.onDay ? FW.talksOn(p.onDay) : FW.talksTitle} onOpen={p.onOpenTalk} />

            {p.editable && (
                <div className="mt-1.5 flex items-center justify-center gap-2 text-center text-[14.5px] font-extrabold text-[#44403C]" data-testid="vr2-end-note" style={{ fontFamily: SANS }}>
                    <LineGlyph name="pen" size={16} className="flex-none" />{FW.endNote}
                </div>
            )}

            <button type="button" data-testid="vr2-finish" style={{ fontFamily: SANS }}
                onClick={() => { hapticFeedback.medium(); p.onFinish(); }}
                className="mt-1.5 flex min-h-[76px] w-full items-center gap-3 rounded-[22px] bg-[#0F6B3A] px-4 py-3 text-left text-white shadow-[0_10px_24px_rgba(15,107,58,0.3)] active:scale-[0.99]">
                <LineGlyph name="tick" size={30} className="flex-none" />
                <span className="min-w-0 flex-1">
                    <b className="block text-[24px] font-bold leading-[1.2]" style={{ fontFamily: SERIF }}>{FW.finish}</b>
                    <small className="block text-[15px] font-bold text-[#D1FAE5]">{FW.finishSub}</small>
                </span>
                <LineGlyph name="right" size={30} className="flex-none" />
            </button>
        </>
    );
};

export default SavedScreenLower;
