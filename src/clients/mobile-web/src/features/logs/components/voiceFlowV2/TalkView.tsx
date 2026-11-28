/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — one talk in full, as the final design draws it.
 *
 *   - `TalkBody`: what a talk card holds (result-v12-final.html `.lc`): the 24-hour line (only while the SERVER's window is open,
 *     `editWindow`), his words (`SavedWords`, final look), his voice (`TalkVoice`, or the typed note), and "यातून काय समजलं"
 *     (`SavedUnderstood`: products first, then the parts, each with his own words). The saved screen draws it for the talk he just made.
 *   - `TalkView`: a talk opened from "आजची बोलणी" (`openLog()`): a page over the result with its own "मागे" (the phone's back closes it
 *     too), the speaker and the time, the same body for THAT talk, and the line that an earlier talk is kept as it was.
 *
 * Everything is the talk's own record as this phone holds it; a talk opened from the list asks for nothing (no "सांगितलं नाही" buttons).
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { useLanguage, useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { PHONE_COLUMN } from '../phoneColumn';
import { LegacyNote, TypedNote } from '../voiceResult/DayParts';
import type { TankVerdict } from '../voiceResult/MixBox';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import type { OpenProduct } from './SavedProducts';
import type { DayView, PartKey, RecordingView } from '../voiceResult/resultModel';
import { finalResultWords } from './finalResultWords';
import { LineGlyph, SANS } from './savedBits';
import SavedUnderstood from './SavedUnderstood';
import SavedWords from './SavedWords';
import { initialOf } from './TalkList';
import { TalkVoice } from './TalkVoice';

const SAFE_TOP = 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))';

/** The 24-hour line (`.editl`). */
export const EditWindowLine: React.FC<{ testId: string }> = ({ testId }) => {
    const FW = finalResultWords(useOptionalLanguage()?.language);
    return (
        <div className="-mt-1 flex items-center gap-[5px] text-[12px] font-bold text-[#57534E]" data-testid={testId}>
            <LineGlyph name="pen" size={13} />{FW.editWindow}
        </div>
    );
};

export interface TalkBodyProps {
    /** The talk's recording(s): one per plot when he named several. */
    recs: readonly RecordingView[];
    /** The one that carries his words (its clip is linked to it). */
    primary: RecordingView;
    /** The talk read as a day (`talkDay.talkDayOf`). */
    talk: DayView;
    /** The server's change window is open now (`editWindow.talkEditableAt`). */
    editable: boolean;
    wordsTitle: string;
    unclear: readonly string[];
    clip: VoiceClipCacheRecord | undefined;
    durationSec: number | null;
    playing: boolean;
    onTogglePlay: () => void;
    /** He answered "हो, ऐकला" for this clip. */
    heard: boolean;
    kit?: ProductAnswerKit;
    /** The combination verdicts of THIS talk's logs only. */
    verdicts: readonly TankVerdict[];
    onOpenProduct: OpenProduct;
    onTellMore?: (part: PartKey) => void;
    /** 'vr2' on the saved screen (its testids as before), 'vr2-tv' in the talk view. */
    idPrefix: string;
}

export const TalkBody: React.FC<TalkBodyProps> = (p) => {
    const { primary } = p;
    const entries = p.recs.flatMap(r => r.entries);
    return (
        <>
            {p.editable && <EditWindowLine testId={`${p.idPrefix}-edit-window`} />}
            <SavedWords transcript={primary.transcript} wordsWithheld={primary.wordsWithheld} entries={entries} unclear={p.unclear}
                look="final" title={p.wordsTitle} testId={`${p.idPrefix}-words`} />
            <div data-testid={`${p.idPrefix}-listen`}>
                {primary.typed ? <TypedNote testId={p.idPrefix === 'vr2' ? undefined : `${p.idPrefix}-typed-note`} /> : (
                    <TalkVoice rec={primary} clipKey={p.clip?.id ?? null} durationSec={p.clip ? p.durationSec : null} playing={p.playing}
                        onToggle={p.onTogglePlay} heard={p.heard} testId={`${p.idPrefix}-play`} />
                )}
            </div>
            {primary.legacyPartial && <LegacyNote testId={`${p.idPrefix}-legacy-note`} />}
            <SavedUnderstood talk={p.talk} kit={p.kit} verdicts={p.verdicts} onOpenProduct={p.onOpenProduct} onTellMore={p.onTellMore}
                testId={`${p.idPrefix}-understood`} />
        </>
    );
};

export interface TalkViewProps extends Omit<TalkBodyProps, 'wordsTitle' | 'idPrefix' | 'onTellMore' | 'unclear'> {
    /** The talk he just made (its closing line says so). */
    now: boolean;
    /** The lines Sathi could not place — only for the talk he just made (the screen's own `unclear`). */
    unclear?: readonly string[];
    onClose: () => void;
}

export const TalkView: React.FC<TalkViewProps> = ({ now, onClose, unclear = [], ...body }) => {
    const { t } = useLanguage();
    const FW = finalResultWords(useOptionalLanguage()?.language);
    useBackDismiss(true, onClose);
    const { primary } = body;
    return (
        <div className="fixed inset-0 z-[46] flex justify-center bg-stone-100" data-testid="vr2-talk-view" data-talk={primary.id} style={{ fontFamily: SANS }}>
            <div className={`flex h-full min-h-0 flex-col bg-[#FAFAF7] ${PHONE_COLUMN}`}>
                <div className="flex shrink-0 items-center px-3 pb-1.5 pt-2" style={{ paddingTop: `calc(0.5rem + ${SAFE_TOP})` }}>
                    <button type="button" onClick={onClose} data-testid="vr2-talk-view-back" aria-label={t('common.back')}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E5E7E1] bg-white pl-1.5 pr-3.5 text-[#1C1917] shadow-sm active:scale-95">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-100"><ArrowLeft size={18} strokeWidth={2.75} aria-hidden="true" /></span>
                        <span className="text-[14px] font-extrabold">{t('common.back')}</span>
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-6" data-testid="vr2-talk-view-body">
                    <section className="flex flex-col gap-2.5 rounded-2xl border-2 border-[#059669] bg-white p-3.5">
                        <div className="flex items-center gap-2.5">
                            <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full text-[19px] font-extrabold text-white"
                                style={{ background: primary.who.you ? '#0F6B3A' : '#1D4ED8' }} aria-hidden="true">{initialOf(primary.who.name)}</span>
                            <span className="flex flex-col items-start gap-1">
                                <b className="text-[18px] font-extrabold leading-[1.2]" data-testid="vr2-tv-who">{primary.who.name}</b>
                                {primary.timeLabel && <span className="whitespace-nowrap rounded-full bg-[#065F46] px-2.5 py-px text-[12.5px] font-extrabold text-white">{primary.timeLabel}</span>}
                            </span>
                        </div>
                        <TalkBody {...body} unclear={unclear} wordsTitle={FW.whatSaid} idPrefix="vr2-tv" />
                    </section>
                    <p className="m-0 mt-2 px-2 text-center text-[12px] text-[#78716C]" data-testid="vr2-tv-foot">{now ? FW.talkIsNow : FW.talkKept}</p>
                </div>
            </div>
        </div>
    );
};

export default TalkView;
