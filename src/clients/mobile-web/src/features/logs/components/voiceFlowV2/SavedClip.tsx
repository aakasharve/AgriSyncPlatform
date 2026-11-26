/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — his recording as the approved design draws it (`.clip`, `.clip.big`):
 * one wide button, the round green ▶, "तुमचा आवाज ऐका / जसं बोललात तसंच" (big only), a row of thin bars and the length.
 *
 * The bars are a stable PICTURE seeded from the clip's id (as `ClipPlayer` draws them), never a loudness measure; the length is the
 * clip's own, else "—" (never a made-up length). The caller owns the audio. The playback switch rules stand (`playbackSwitch`): known
 * OFF = no ▶, the founder's D-31 words in the same frame. No clip on this phone = the same frame, greyed, with those words; nothing plays.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { toDevanagariDigits } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import { mmss } from '../voiceResult/ClipPlayer';
import { usePlaybackSwitch, usePlaybackUnavailableWords } from '../voiceResult/playbackSwitch';
import { useResultStr } from '../voiceResult/resultStrings';
import { SANS } from './savedBits';
import { savedWords } from './savedWords';

/** The design's bar heights (6–22 px), seeded from the clip so the same clip always draws the same picture. */
const barsOf = (seed: string, n: number): number[] => {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 97;
    return Array.from({ length: n }, (_, k) => 6 + Math.round(Math.abs(Math.sin((k + h) * 1.7)) * 16));
};

export interface SavedClipProps {
    /** The clip on this phone; absent = no clip here (the frame says so, nothing plays). */
    clipKey: string | null;
    durationSec: number | null;
    playing: boolean;
    big?: boolean;
    onToggle: () => void;
    testId: string;
}

export const SavedClip: React.FC<SavedClipProps> = ({ clipKey, durationSec, playing, big = false, onToggle, testId }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const SW = savedWords(language);
    const allowed = usePlaybackSwitch();
    const unavailable = usePlaybackUnavailableWords();
    const bars = React.useMemo(() => barsOf(clipKey ?? testId, big ? 20 : 24), [clipKey, testId, big]);
    const can = !!clipKey && allowed !== false;
    const clock = durationSec != null ? (language === 'en' ? mmss(durationSec) : toDevanagariDigits(mmss(durationSec))) : '—';
    const frame = `flex w-full items-center gap-2.5 rounded-[14px] border-[1.5px] text-left text-[#1C1917] ${big ? 'border-[#86C9A0] bg-[#F3FBF6] px-3 py-2.5' : 'border-[#DDE3DA] bg-[#FBFBF7] px-2.5 py-2'}`;
    const circle = `grid shrink-0 place-items-center rounded-full text-white ${big ? 'h-[46px] w-[46px] text-[16px]' : 'h-[34px] w-[34px] text-[13px]'}`;
    const wave = (lit: boolean) => (
        <span className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true" data-moving={playing ? 'yes' : 'no'}>
            {bars.map((px, k) => (
                <i key={k} className={`w-[3px] flex-none rounded-sm ${playing ? 'motion-safe:animate-plr-eq' : ''}`}
                    style={{ height: px, background: lit ? (playing ? '#1E9E5A' : '#9CC9AE') : '#D6D3D1', animationDelay: `${((k % 9) * 0.08).toFixed(2)}s` }} />
            ))}
        </span>
    );
    if (!can) {
        // No ▶ at all: the clip is not on this phone, or the playback switch is known OFF.
        return (
            <div className={`${frame} opacity-90`} data-testid={clipKey ? `${testId}-off` : `${testId}-none`} data-playback-off={clipKey ? 'yes' : undefined} style={{ fontFamily: SANS }}>
                <span className={`${circle} bg-stone-300`} aria-hidden="true">▶</span>
                <span className="min-w-0 flex-1">
                    <b className="block text-[14px] font-extrabold leading-[1.3] text-stone-700">{unavailable}</b>
                    {big && <small className="block text-[11.5px] font-bold text-[#5F6B63]">{W.listenTitle}</small>}
                </span>
            </div>
        );
    }
    return (
        <button type="button" onClick={onToggle} aria-label={playing ? RS.stop : RS.play} data-testid={testId} data-playing={playing ? 'yes' : 'no'}
            className={`${frame} active:scale-[0.99]`} style={{ fontFamily: SANS }}>
            <span className={`${circle} bg-[#0F6B3A]`} aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
            {big && (
                <span className="flex flex-none flex-col">
                    <b className="text-[16px] font-bold leading-[1.2]">{playing ? SW.playing : W.listenTitle}</b>
                    <small className="text-[11.5px] font-bold text-[#5F6B63]">{W.listenSub}</small>
                </span>
            )}
            {wave(true)}
            <span className="flex-none text-[13px] font-extrabold tabular-nums text-[#5F6B63]" data-testid={`${testId}-length`}>{clock}</span>
        </button>
    );
};

export default SavedClip;
