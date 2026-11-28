/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4, amendments B1 / Verifier 3 / H1 / L3) — the mic card's countdown ring.
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A1; the founder's final design, 28 Nov) — 3 seconds, on the mic page
 * he opened himself (one swipe up or a tap on the green bar), and the microphone is asked for THERE when it is not granted yet.
 *
 * It fires ONCE per opening of the mic page (`armSeq`), and only when all of this holds:
 *   - he opened the mic page (`armSeq > 0`; arriving on it with a plot already chosen never arms);
 *   - the microphone is granted: read without prompting (`readDevicePermission`), or the mic already opened in this session.
 *     Not granted yet (`prompt`, or a phone that cannot say): it is asked for now (`requestDevicePermission`, the OS question):
 *     he has just invoked the feature that needs it. A refusal (`denied`, read or answered) is never asked again here: no ring,
 *     the card waits for a tap, and the recorder's own refusal path offers typing. The answer is async: no ring until it comes,
 *     and the 3 s start at the answer;
 *   - the level could be measured in this session (an auto-start that cannot hear speech is not started at all);
 *   - nothing blocks it: the typing sheet, a recording, no plot. Blocked once, it stays held until the next opening (closing the
 *     typing sheet without sending does NOT restart it); so does a hidden page and `hold()`. The OS permission question may
 *     hide the page for a moment: that is not him leaving, so it does not hold it.
 * Deadline-based (P11): a late timer still fires against `Date.now()`, never by counting ticks.
 *
 * The consumed `armSeq` lives in a ref of the component that calls this — `RecorderFace`, above its recording branch —
 * so a cancel, a mic error or any recording holds the ring until the NEXT opening.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readDevicePermission, requestDevicePermission } from '../../../consent/separation/devicePermissions';
import { logger } from '../../../../infrastructure/observability/Logger';

/** The founder's final design: one big number, ३ २ १, then it listens by itself. */
export const AUTO_START_SEC = 3;
const TICK_MS = 250;

let micGranted = false;
let levelUnmeasurable = false;
/** A recorder opened the microphone in this session (so the OS has granted it). */
export const noteMicGranted = (): void => { micGranted = true; };
export const micGrantedThisSession = (): boolean => micGranted;
/** The level could not be measured: no auto-start for the rest of the session (it could not tell speech from silence). */
export const noteLevelUnmeasurable = (): void => { levelUnmeasurable = true; };
export function resetAutoStartForTests(): void { micGranted = false; levelUnmeasurable = false; }

/**
 * May the microphone be used now? Read first (no prompt); only when the phone has not been answered yet, ask (the OS question).
 * Never throws: any failure is "no" (no ring; a tap on the mic still tries, and the recorder says what went wrong).
 */
async function microphoneAllowed(): Promise<boolean> {
    try {
        const read = await readDevicePermission('microphone');
        if (read === 'granted') return true;
        if (read === 'denied') return false;
        const asked = await requestDevicePermission('microphone');
        logger.info('voice_v2.mic.permission_asked', { read, answer: asked });
        return asked === 'granted';
    } catch {
        return false;
    }
}

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
                void microphoneAllowed().then((ok) => {
                    if (ok) micGranted = true;
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
        const onVisibility = () => {
            if (!document.hidden) return;
            // The OS permission question can cover the page while it is asked: his answer is awaited, he has not left.
            if (permRef.current.seq === armRef.current && permRef.current.ok === null) return;
            hold('hidden');
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [armSeq, hold]);

    const secondsLeft = deadline ? Math.min(seconds, Math.max(0, Math.ceil((deadline.at - now) / 1000))) : null;
    return { secondsLeft, hold };
}
