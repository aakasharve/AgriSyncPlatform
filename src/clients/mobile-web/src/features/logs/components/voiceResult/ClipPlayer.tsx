/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-12) — the big play button with a
 * waveform, ported from the approved preview (postVoiceResult/PostVoiceResult.tsx `Player`). It plays the
 * REAL clip of the log on this phone; the caller owns the audio (`useClipPlayback`).
 *
 * The bars are a stable PICTURE of the clip (seeded from its id, solid green/blue runs of the logo), not a
 * measurement of loudness; they move while it plays, the heard part stays bright, a playhead marks the place.
 */
import React from 'react';
import { Pause, Play } from 'lucide-react';
import { useResultStr } from './resultStrings';

const WAVE_BARS = 64;
const WAVE_GREEN = 'rgb(34, 176, 72)';
const WAVE_BLUE = 'rgb(20, 72, 230)';

export const mmss = (sec: number): string => {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** One solid colour per run of 2-4 bars (green, blue, green...), the same for the same clip every time. */
const colourRuns = (seed: string, n: number): string[] => {
    let h = 11;
    for (let i = 0; i < seed.length; i += 1) h = (h * 17 + seed.charCodeAt(i)) % 7919;
    const out: string[] = [];
    let green = true;
    for (let k = 0; out.length < n; k += 1) {
        const left = n - out.length;
        let size = 2 + ((h + k * 5) % 3);
        if (left - size === 1) size += size < 4 ? 1 : -1;
        size = Math.min(size, left);
        for (let j = 0; j < size; j += 1) out.push(green ? WAVE_GREEN : WAVE_BLUE);
        green = !green;
    }
    return out;
};

/** A speech-like envelope, the same picture for the same clip every time. */
const envelopeOf = (seed: string, n: number): number[] => {
    let h = 7;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 9973;
    return Array.from({ length: n }, (_, i) => {
        const phrase = 0.55 + 0.45 * Math.sin(i * 0.23 + h * 0.01);
        const syll = 0.5 + 0.5 * Math.abs(Math.sin(i * 0.9 + h * 0.37) * Math.cos(i * 0.31 + h * 0.11));
        return Math.min(1, 0.2 + 0.8 * phrase * syll);
    });
};

/** The preview's flowing trace under the bars while the clip plays (postVoiceResult `ElectricWave`), same picture. */
const electricPath = (env: number[]): string => {
    const W = 320, H = 22, n = 80;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
        const e = env[Math.min(env.length - 1, Math.floor((i / n) * env.length))];
        const jag = (i % 2 === 0 ? -1 : 1) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.83))) * e * (H / 2 - 2);
        return `${((i / n) * W).toFixed(1)},${(H / 2 + jag).toFixed(1)}`;
    });
    return `M${pts.join(' L')}`;
};

const ElectricWave: React.FC<{ env: number[]; testId: string }> = ({ env, testId }) => {
    const d = React.useMemo(() => electricPath(env), [env]);
    return (
        <svg viewBox="0 0 320 22" preserveAspectRatio="none" aria-hidden="true" data-testid={testId} className="mt-1 block h-[18px] w-full overflow-visible" style={{ filter: 'drop-shadow(0 0 3px rgba(20,72,230,0.55))' }}>
            <defs>
                <linearGradient id={`${testId}-g`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor={WAVE_GREEN} /><stop offset="0.5" stopColor="#1FA6A0" /><stop offset="1" stopColor={WAVE_BLUE} />
                </linearGradient>
            </defs>
            <path d={d} fill="none" stroke={`url(#${testId}-g)`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.45" />
            <path d={d} fill="none" stroke={`url(#${testId}-g)`} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" strokeDasharray="30 42" className="animate-plr-flow" />
            <path d={d} fill="none" stroke="#FFFFFF" strokeWidth="0.9" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" strokeDasharray="5 67" className="animate-plr-flow-fast" />
        </svg>
    );
};

export interface ClipPlayerProps {
    /** Seeds the picture (the clip's id). */
    clipKey: string;
    /** Length in seconds, when known; the clock shows "—" otherwise (never a made-up length). */
    durationSec: number | null;
    playing: boolean;
    /** 0..1 of the playing clip. */
    progress: number;
    big?: boolean;
    onToggle: () => void;
    testId: string;
}

export const ClipPlayer: React.FC<ClipPlayerProps> = ({ clipKey, durationSec, playing, progress, big, onToggle, testId }) => {
    const RS = useResultStr();
    const env = React.useMemo(() => envelopeOf(clipKey, WAVE_BARS), [clipKey]);
    const colours = React.useMemo(() => colourRuns(clipKey, WAVE_BARS), [clipKey]);
    const prog = playing ? progress : 0;
    const lit = Math.round(prog * WAVE_BARS);
    return (
        <div className="relative flex items-center gap-2.5 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-2" data-testid={`${testId}-wave`}>
            <button type="button" onClick={onToggle} aria-label={playing ? RS.stop : RS.play} data-testid={testId} data-playing={playing ? 'yes' : 'no'}
                className={`${big ? 'h-16 w-16' : 'h-11 w-11'} relative z-10 grid shrink-0 place-items-center rounded-full bg-[#1448E6] text-white shadow-[0_6px_16px_rgba(20,72,230,0.38)] ring-4 ring-white active:scale-95`}>
                {playing ? <Pause size={big ? 26 : 18} fill="currentColor" /> : <Play size={big ? 26 : 18} fill="currentColor" className="ml-0.5" />}
            </button>
            <div className="relative z-10 min-w-0 flex-1">
                <div className={`relative flex items-center justify-between gap-[2px] ${big ? 'h-10' : 'h-8'}`} aria-hidden="true" data-moving={playing ? 'yes' : 'no'}>
                    {env.map((h, i) => (
                        <i key={i} className={`min-w-[2px] flex-1 origin-center rounded-full ${playing ? 'animate-plr-eq' : ''}`}
                            style={{
                                height: `${Math.round(14 + h * 66)}%`, background: colours[i], opacity: !playing || i < lit ? 1 : 0.38, maxWidth: 4,
                                animationDuration: `${(1.9 + ((i * 3) % 5) * 0.25).toFixed(2)}s`, animationDelay: `${((i % 9) * 0.08).toFixed(2)}s`,
                            }} />
                    ))}
                    {playing && <span className="absolute -bottom-0.5 -top-0.5 w-0.5 rounded bg-blue-700" style={{ left: `calc(${prog * 100}% - 1px)` }} />}
                </div>
                {playing && <ElectricWave env={env} testId={`${testId}-electric`} />}
                <div className="mt-1 flex items-center justify-between text-[12px] font-bold tabular-nums text-stone-700">
                    <span>{durationSec != null ? mmss(prog * durationSec) : '—'}</span>
                    <span data-testid={`${testId}-length`}>{durationSec != null ? mmss(durationSec) : '—'}</span>
                </div>
            </div>
        </div>
    );
};

export default ClipPlayer;
