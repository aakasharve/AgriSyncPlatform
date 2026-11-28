/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — his voice in the talk card, as the final design draws it
 * (result-v12-final.html `clip()` and `heardAsk()`):
 *   - "हा तुमचा आवाज" (his own talk) or "<name> यांचा आवाज" over the existing player (`SavedClip`: the clip on this phone, its own
 *     length, never a made-up one);
 *   - once a clip has played to its END (the container's `heard`, the same evidence the owner's confirm uses), Sathi asks ONCE
 *     "तुम्ही तुमचा आवाज ऐकलात का?" ("तुम्ही हा आवाज ऐकलात का?" for someone else's): "हो, ऐकला" puts "ऐकलं" on the clip, "पुन्हा ऐका"
 *     plays it again. The answer is only a mark on this screen: nothing is saved and nothing waits on it (P9).
 */
import React from 'react';
import { useBackDismiss } from '../../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { PHONE_COLUMN } from '../phoneColumn';
import type { RecordingView } from '../voiceResult/resultModel';
import { finalResultWords } from './finalResultWords';
import { SANS, Tick } from './savedBits';
import SavedClip from './SavedClip';

const SERIF = "'Noto Serif Devanagari', serif";
/** The app's one picture of Sathi. */
const SATHI = '/images/sathi/sathi-points-down-both.png';

const SathiFace: React.FC<{ px: number }> = ({ px }) => (
    <img src={SATHI} alt="" width={px} height={px} draggable={false} aria-hidden="true"
        className="flex-none select-none rounded-full bg-[#FFF6C6] object-cover object-top" style={{ width: px, height: px }} />
);

export interface TalkVoiceProps {
    rec: RecordingView;
    clipKey: string | null;
    durationSec: number | null;
    playing: boolean;
    onToggle: () => void;
    /** He answered "हो, ऐकला" for this clip. */
    heard: boolean;
    testId: string;
}

export const TalkVoice: React.FC<TalkVoiceProps> = ({ rec, clipKey, durationSec, playing, onToggle, heard, testId }) => {
    const FW = finalResultWords(useOptionalLanguage()?.language);
    return (
        <div className="flex flex-col gap-1.5" data-testid={`${testId}-voice`} style={{ fontFamily: SANS }}>
            <div className="flex items-center gap-2">
                <SathiFace px={34} />
                <b className="text-[15.5px] font-bold text-[#065F46]" style={{ fontFamily: SERIF }} data-testid={`${testId}-voice-title`}>
                    {rec.who.you ? FW.yourVoice : FW.theirVoice(rec.who.name)}
                </b>
            </div>
            <SavedClip clipKey={clipKey} durationSec={durationSec} playing={playing} onToggle={onToggle} testId={testId} />
            {heard && (
                <span className="inline-flex items-center gap-[5px] self-start rounded-full border-[1.5px] border-[#9FD9B5] bg-[#E9F8EE] px-2.5 py-px text-[12.5px] font-extrabold text-[#0F6B3A]"
                    data-testid={`${testId}-heard`}>
                    <i className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#1E9E5A]" aria-hidden="true"><Tick size={9} /></i>{FW.heardChip}
                </span>
            )}
        </div>
    );
};

export interface HeardSheetProps {
    /** His own talk ("तुमचा आवाज") or someone else's ("हा आवाज"). */
    mine: boolean;
    onYes: () => void;
    onAgain: () => void;
    onClose: () => void;
}

/** Sathi's one question after a clip played to its end. The phone's back closes it (an overlay: the screen's close clock holds). */
export const HeardSheet: React.FC<HeardSheetProps> = ({ mine, onYes, onAgain, onClose }) => {
    const FW = finalResultWords(useOptionalLanguage()?.language);
    useBackDismiss(true, onClose);
    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" data-testid="vr2-heard-sheet" style={{ fontFamily: SANS }}>
            <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-[rgba(10,20,15,0.35)]" data-testid="vr2-heard-backdrop" />
            <div role="dialog" aria-modal="true" aria-labelledby="vr2-heard-q"
                className={`relative rounded-t-[24px] bg-white px-4 pb-[calc(1.125rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pt-4 shadow-[0_-10px_30px_rgba(0,0,0,0.18)] ${PHONE_COLUMN}`}>
                <div className="flex items-center gap-3">
                    <SathiFace px={60} />
                    <b id="vr2-heard-q" className="text-[19px] leading-[1.35] text-[#1C1917]" style={{ fontFamily: SERIF }} data-testid="vr2-heard-question">
                        {mine ? FW.heardMine : FW.heardOther}
                    </b>
                </div>
                <div className="mt-3.5 flex gap-2.5">
                    <button type="button" onClick={onYes} data-testid="vr2-heard-yes"
                        className="min-h-[48px] flex-1 rounded-[14px] bg-[#0F6B3A] text-[16px] font-extrabold text-white active:scale-[0.99]">{FW.heardYes}</button>
                    <button type="button" onClick={onAgain} data-testid="vr2-heard-again"
                        className="min-h-[48px] flex-1 rounded-[14px] border-[1.5px] border-[#E5E7E1] bg-white text-[16px] font-extrabold text-[#1C1917] active:scale-[0.99]">{FW.heardAgain}</button>
                </div>
            </div>
        </div>
    );
};
