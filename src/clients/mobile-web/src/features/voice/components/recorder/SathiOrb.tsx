/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-26: "exact replication" of the approved design. Sathi's round orb in the
 * middle of the ring (the design's `.orb-wrap` / `.orb` / `.glow` / `.ripple`), showing his mood frames
 * (`public/images/sathi/moods/*.webp`, taken from the app's own shramsathi-a.mp4).
 *
 * Nothing here is simulated (P4): the mood follows the REAL microphone level — he listens while the level is up, ponders
 * after ~2 s of measured quiet, nods for a moment when the stop is pressed — and a ripple leaves the orb only while the
 * level is above speech (`SPEECH_LEVEL`). When the phone cannot measure the level, Sathi just listens and no ripple is
 * drawn. Reduced motion: no ripple, no nod, no breathing glow; the frames still change.
 */
import React, { useEffect, useRef, useState } from 'react';
import { SPEECH_LEVEL } from './silenceHelpModel';

export type SathiMood = 'listen' | 'ponder' | 'nod' | 'bright' | 'happy';
const MOODS: readonly SathiMood[] = ['listen', 'ponder', 'nod', 'bright', 'happy'];
export const moodSrc = (m: SathiMood): string => `/images/sathi/moods/${m}.webp`;

/** This long of measured quiet and Sathi ponders (the design's `mood('ponder')`). */
export const PONDER_AFTER_MS = 2000;
/** How often the mood and the ripples re-read the level (the design's ripple beat). */
const BEAT_MS = 280;
/** A ripple lives this long (the design's `rip 1.5s`). */
const RIPPLE_MS = 1500;

/** Pure: the mood for this moment. `lastLoudAt` = the last time the level was above speech, or not measurable. */
export function sathiMoodOf({ stopped, lastLoudAt, now }: { stopped: boolean; lastLoudAt: number; now: number }): SathiMood {
    if (stopped) return 'nod';
    return now - lastLoudAt >= PONDER_AFTER_MS ? 'ponder' : 'listen';
}

interface Ripple { id: number; at: number; strength: number }

/** The mood and ripples from the live level; both stop once `stopped` (the stop was pressed). */
export function useSathiMood(level: number | undefined, stopped: boolean): { mood: SathiMood; ripples: Ripple[] } {
    const levelRef = useRef(level);
    levelRef.current = level;
    const lastLoud = useRef(Date.now());
    const seq = useRef(0);
    const [mood, setMood] = useState<SathiMood>('listen');
    const [ripples, setRipples] = useState<Ripple[]>([]);
    // an unmeasurable level is never read as quiet: Sathi keeps listening rather than claim a silence he cannot hear
    useEffect(() => {
        if (level !== undefined && level < SPEECH_LEVEL) return;
        lastLoud.current = Date.now();
        setMood(m => (m === 'ponder' ? 'listen' : m)); // he speaks again: Sathi turns back to listen at once
    }, [level]);
    useEffect(() => {
        if (stopped) { setMood('nod'); setRipples([]); return undefined; }
        const beat = () => {
            const now = Date.now();
            const l = levelRef.current;
            if (l === undefined || l >= SPEECH_LEVEL) lastLoud.current = now;
            setMood(m => { const next = sathiMoodOf({ stopped: false, lastLoudAt: lastLoud.current, now }); return m === next ? m : next; });
            setRipples(rs => {
                const alive = rs.filter(r => now - r.at < RIPPLE_MS);
                if (l === undefined || l < SPEECH_LEVEL) return alive.length === rs.length ? rs : alive;
                seq.current += 1;
                return [...alive, { id: seq.current, at: now, strength: Math.min(1, l * 1.6) }].slice(-6);
            });
        };
        beat();
        const id = window.setInterval(beat, BEAT_MS);
        return () => window.clearInterval(id);
    }, [stopped]);
    return { mood, ripples };
}

const ORB_CSS = '@keyframes vfRip{0%{transform:scale(.86);opacity:var(--a,.75)}100%{transform:scale(1.55);opacity:0}}'
    + '@keyframes vfNod{0%,100%{transform:none}30%{transform:translateY(5px) rotate(1deg)}60%{transform:translateY(-2px)}}'
    + '@keyframes vfTilt{0%,100%{transform:none}50%{transform:rotate(-5deg)}}'
    + '@keyframes vfG1{0%,100%{opacity:.2;transform:scale(.85)}45%{opacity:.85;transform:scale(1.12)}}'
    + '@keyframes vfG2{0%,100%{opacity:.2;transform:scale(.92)}55%{opacity:.9;transform:scale(1.16)}}'
    + '@media (prefers-reduced-motion:no-preference){.vf-orb-nod{animation:vfNod .6s ease-in-out}.vf-orb-ponder{animation:vfTilt .7s ease-in-out}}';
/** The design's `.orb img` mask: the frame fades out at the rim. */
const MASK = 'radial-gradient(circle at 50% 44%,#000 62%,transparent 84%)';

/** The five frames stacked; only the current mood is shown (the design's `.orb .show`, an 0.18 s cross-fade). */
export const SathiFace: React.FC<{ mood: SathiMood; masked?: boolean; className?: string }> = ({ mood, masked = true, className = '' }) => (
    <>
        {MOODS.map(m => (
            <img key={m} src={moodSrc(m)} alt="" aria-hidden="true" draggable={false} data-mood-frame={m}
                className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-[180ms] ${m === mood ? 'opacity-100' : 'opacity-0'} ${className}`}
                style={masked ? { transform: 'translateY(6%) scale(.98)', WebkitMaskImage: MASK, maskImage: MASK } : undefined} />
        ))}
    </>
);

export interface SathiOrbProps {
    mood: SathiMood;
    /** Live level 0..1 (undefined = not measurable): the orb swells a little with it. */
    level?: number;
    ripples?: readonly Ripple[];
}

/** The orb (124 of the ring's 326 px, so it shrinks with the ring): three soft glows, ripples from the real level, the mood frame. */
export const SathiOrb: React.FC<SathiOrbProps> = ({ mood, level, ripples = [] }) => {
    const swell = level === undefined ? 1 : 1 + Math.min(1, level) * 0.03;
    return (
        <div data-testid="sathi-orb" data-mood={mood} className="absolute left-[30.98%] top-[30.98%] h-[38.04%] w-[38.04%]">
            <style>{ORB_CSS}</style>
            <span aria-hidden="true" className="pointer-events-none absolute left-[22%] top-[-6%] h-[56%] w-[56%] rounded-full opacity-60 motion-safe:[animation:vfG1_3.8s_ease-in-out_infinite]" style={{ background: 'radial-gradient(circle,rgba(22,178,78,.55),transparent 67%)' }} />
            <span aria-hidden="true" className="pointer-events-none absolute left-[58%] top-[28%] h-[52%] w-[52%] rounded-full opacity-60 motion-safe:[animation:vfG2_4.9s_ease-in-out_.6s_infinite]" style={{ background: 'radial-gradient(circle,rgba(28,108,240,.5),transparent 65%)' }} />
            <span aria-hidden="true" className="pointer-events-none absolute left-[-6%] top-[48%] h-[50%] w-[50%] rounded-full opacity-60 motion-safe:[animation:vfG2_4.4s_ease-in-out_1.6s_infinite]" style={{ background: 'radial-gradient(circle,rgba(26,185,84,.45),transparent 64%)' }} />
            {level !== undefined && (
                <div aria-hidden="true" data-testid="mic-level" data-level={level.toFixed(2)} className="absolute inset-0 motion-reduce:hidden">
                    {ripples.map(r => (
                        <span key={r.id} data-testid="sathi-ripple" className="absolute inset-0 rounded-full border-[1.5px] border-[rgba(30,158,90,.55)] [animation:vfRip_1.5s_ease-out_forwards]"
                            style={{ '--a': (0.35 + 0.4 * r.strength).toFixed(2) } as React.CSSProperties} />
                    ))}
                </div>
            )}
            <div className="absolute inset-[6px] transition-transform duration-[120ms] ease-out" style={{ transform: `scale(${swell.toFixed(3)})` }}>
                <div className={`absolute inset-0 overflow-hidden rounded-full bg-[#FFF6C6] shadow-[0_4px_16px_rgba(0,0,0,.07),0_0_20px_rgba(16,185,129,.18)] vf-orb-${mood}`}>
                    <SathiFace mood={mood} />
                </div>
            </div>
        </div>
    );
};

export default SathiOrb;
