/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4, amendments B1 / Verifier 3 / H1 / L3) — the mic card's 7-second ring.
 *
 * It fires ONCE per plot tap (`armSeq`), and only when all of this holds:
 *   - he tapped a plot on this screen (`armSeq > 0`; arriving with a plot already chosen never arms);
 *   - the microphone is ALREADY granted: read without prompting (`readDevicePermission`), or the mic already opened in
 *     this session. The read is async: no ring until it answers, and the 7 s start at the answer. Prompt / denied /
 *     unknown = no ring, the card waits for a tap (no permission prompt ever appears by itself);
 *   - the level could be measured in this session (an auto-start that cannot hear speech is not started at all);
 *   - nothing blocks it: the typing sheet, a recording, no plot. Blocked once, it stays held until the next plot tap
 *     (closing the typing sheet without sending does NOT restart it); so does a hidden page and `hold()`.
 * Deadline-based (P11): a late timer still fires against `Date.now()`, never by counting ticks.
 *
 * The consumed `armSeq` lives in a ref of the component that calls this — `RecorderFace`, above its recording branch —
 * so a cancel, a mic error or any recording holds the ring until the NEXT plot tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readDevicePermission } from '../../../consent/separation/devicePermissions';
import { logger } from '../../../../infrastructure/observability/Logger';

export const AUTO_START_SEC = 7;
const TICK_MS = 250;

let micGranted = false;
let levelUnmeasurable = false;
/** A recorder opened the microphone in this session (so the OS has granted it). */
export const noteMicGranted = (): void => { micGranted = true; };
export const micGrantedThisSession = (): boolean => micGranted;
/** The level could not be measured: no auto-start for the rest of the session (it could not tell speech from silence). */
export const noteLevelUnmeasurable = (): void => { levelUnmeasurable = true; };
export function resetAutoStartForTests(): void { micGranted = false; levelUnmeasurable = false; }

export interface AutoStartOptions {
    /** Bumps on every plot tap; 0 = never armed. */
    armSeq: number;
    /** Something stands in the way right now (typing sheet, a recording, no plot). */
    blocked: boolean;
    seconds?: number;
    onFire: () => void;
}

export interface AutoStartCountdown {
    /** Whole seconds left while the ring runs; null when it does not run. */
    secondsLeft: number | null;
    /** Stop it until the next plot tap. */
    hold: (reason: string) => void;
}

export function useAutoStartCountdown({ armSeq, blocked, seconds = AUTO_START_SEC, onFire }: AutoStartOptions): AutoStartCountdown {
    const consumedRef = useRef(0);
    const seenUnblockedRef = useRef(0);
    const permRef = useRef<{ seq: number; ok: boolean | null }>({ seq: 0, ok: null });
    const [permVersion, setPermVersion] = useState(0);
    const [deadline, setDeadline] = useState<{ seq: number; at: number } | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const onFireRef = useRef(onFire);
    onFireRef.current = onFire;
    const armRef = useRef(armSeq);
    armRef.current = armSeq;

    const hold = useCallback((reason: string) => {
        const seq = armRef.current;
        if (seq > consumedRef.current) {
            consumedRef.current = seq;
            logger.info('voice_v2.mic.autostart_held', { reason, armSeq: seq });
        }
        setDeadline(null);
    }, []);

    useEffect(() => {
        if (armSeq <= 0 || armSeq <= consumedRef.current) return;
        if (blocked) {
            if (seenUnblockedRef.current === armSeq) hold('blocked');
            return;
        }
        seenUnblockedRef.current = armSeq;
        if (levelUnmeasurable) return;
        if (permRef.current.seq !== armSeq) {
            permRef.current = { seq: armSeq, ok: micGranted ? true : null };
            if (!micGranted) {
                void readDevicePermission('microphone')
                    .then((answer) => answer === 'granted', () => false)
                    .then((ok) => {
                        if (permRef.current.seq !== armSeq) return;
                        permRef.current = { seq: armSeq, ok: ok || micGranted };
                        setPermVersion((v) => v + 1);
                    });
            }
        }
        if (permRef.current.ok !== true) return;
        if (typeof document !== 'undefined' && document.hidden) { hold('hidden'); return; }
        setDeadline((d) => (d && d.seq === armSeq ? d : { seq: armSeq, at: Date.now() + seconds * 1000 }));
    }, [armSeq, blocked, permVersion, seconds, hold]);

    useEffect(() => {
        if (!deadline) return undefined;
        let timer = 0;
        const fire = () => {
            const left = deadline.at - Date.now();
            if (left > 0) { timer = window.setTimeout(fire, left); return; }
            if (deadline.seq <= consumedRef.current) return;
            consumedRef.current = deadline.seq;
            setDeadline(null);
            logger.info('voice_v2.mic.autostart_fired', { armSeq: deadline.seq });
            onFireRef.current();
        };
        timer = window.setTimeout(fire, Math.max(0, deadline.at - Date.now()));
        setNow(Date.now());
        const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
        return () => { window.clearTimeout(timer); window.clearInterval(tick); };
    }, [deadline]);

    useEffect(() => {
        if (armSeq <= 0 || typeof document === 'undefined') return undefined;
        const onVisibility = () => { if (document.hidden) hold('hidden'); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [armSeq, hold]);

    const secondsLeft = deadline ? Math.min(seconds, Math.max(0, Math.ceil((deadline.at - now) / 1000))) : null;
    return { secondsLeft, hold };
}
