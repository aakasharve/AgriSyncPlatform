/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A4) — the short, soft success sound with the "जतन झालं" pop (the final
 * design's "Success sound"). Two quiet notes, about a third of a second, drawn with Web Audio (no file to load).
 *
 * When it plays, and when it does not:
 *   - never loudly: its peak is a small fraction of full scale, and it follows the phone's own media volume (at zero it is not heard);
 *   - only while the app's feel switch is on (`haptics.isHapticsEnabled`, the one switch for the phone's feedback) and the page is shown;
 *   - the web cannot read the phone's silent / ringer mode, so it cannot skip silent mode by itself: that is why it is kept this soft;
 *   - a phone that refuses sound before a touch, or has no Web Audio, plays nothing. It never throws.
 */
import { isHapticsEnabled } from './haptics';

/** The loudest point of the sound (0..1 of full scale). */
export const CHIME_PEAK = 0.05;
const NOTES_HZ = [880, 1318.5] as const;
const LENGTH_S = 0.42;

type AudioContextCtor = new () => AudioContext;

/** Plays the soft success sound once, when allowed. Returns whether it was started. */
export function playSoftChime(): boolean {
    try {
        if (!isHapticsEnabled()) return false;
        if (typeof document !== 'undefined' && document.hidden) return false;
        if (typeof window === 'undefined') return false;
        const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return false;
        const ctx = new Ctor();
        const start = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(CHIME_PEAK, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + LENGTH_S);
        gain.connect(ctx.destination);
        NOTES_HZ.forEach((hz, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(hz, start);
            osc.connect(gain);
            osc.start(start + i * 0.11);
            osc.stop(start + LENGTH_S);
        });
        window.setTimeout(() => { void ctx.close?.().catch?.(() => undefined); }, (LENGTH_S + 0.3) * 1000);
        return true;
    } catch {
        return false;
    }
}
