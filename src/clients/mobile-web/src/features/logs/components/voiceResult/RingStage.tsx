/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-09) — the "मला किती समजलं" reveal on
 * the result screen, ported from the approved preview (postVoiceResult/RingStage.tsx, founder 2026-10-25):
 *   - the reveal plays FULL SCREEN like the video, then shrinks into the card (one ring instance throughout);
 *   - the reward words are page text under the ring once it has landed, with a ↓ to his words;
 *   - a tap during the full-screen part skips to the small one;
 *   - it plays again ONLY for a new recording (`saveKey`): opening the same result again lands on the final
 *     frame (remembered for this app session), and there is no replay button.
 * OPEN (founder): the preview plays the reveal even when the phone's "reduce motion" setting is on, and so
 * does this port, so the PC test shows the animation he approved. Whether the real app should honour that
 * setting is his call (preview RingStage.tsx :14-15).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { UnderstandingRing, defaultMessage, digits, type RingNodeData } from '../shramsathi/understandingRing';
import { CINEMATIC_PACING, plan } from '../shramsathi/understandingRing/timeline';

export const SHRINK_MS = 900;
const HOLD_AFTER_LOCK_MS = 1300;
const SMALL_W = 230;
const RATIO = 600 / 440;

/** Recordings whose reveal already played in this app session. */
const played = new Set<string>();
/** Test seam: forget what played. */
export const forgetPlayedReveals = (): void => { played.clear(); };

interface Props {
    score: number | null;
    nodes: RingNodeData[];
    variant: 'cinematic' | 'flat';
    /** One per recording: a new one plays the reveal again. */
    saveKey: string;
    onMissedTap: (n: RingNodeData) => void;
    onSettled?: () => void;
    onReadMore?: () => void;
    fallback: React.ReactNode;
}
type Phase = 'full' | 'shrink' | 'small';
interface Box { left: number; top: number; width: number }

export const RingStage: React.FC<Props> = ({ score, nodes, variant, saveKey, onMissedTap, onSettled, onReadMore, fallback }) => {
    const [seenBefore] = useState(() => played.has(saveKey));
    const cinematic = variant === 'cinematic' && score != null && score > 0 && !seenBefore;
    const [phase, setPhase] = useState<Phase>(cinematic ? 'full' : 'small');
    const [box, setBox] = useState<Box | null>(null);
    const slot = useRef<HTMLDivElement>(null);
    const timers = useRef<number[]>([]);
    const latest = useRef({ nodes, score });
    const settledCb = useRef(onSettled);
    useEffect(() => { latest.current = { nodes, score }; settledCb.current = onSettled; });

    const clear = () => { timers.current.forEach(id => window.clearTimeout(id)); timers.current = []; };

    const shrink = useCallback(() => {
        const el = slot.current;
        if (!el) return;
        clear();
        el.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior });
        const r = el.getBoundingClientRect();
        setBox({ left: r.left, top: r.top, width: r.width });
        setPhase('shrink');
        timers.current.push(window.setTimeout(() => {
            setPhase('small');
            timers.current.push(window.setTimeout(() => settledCb.current?.(), 1100));
        }, SHRINK_MS + 60));
    }, []);

    useEffect(() => {
        if (!cinematic) { setPhase('small'); return undefined; }
        played.add(saveKey);
        setPhase('full');
        const { nodes: ns, score: sc } = latest.current;
        const lock = plan(ns.map(n => ({ state: n.state })), sc ?? 0, 10, 'gauge', CINEMATIC_PACING).lock;
        clear();
        timers.current.push(window.setTimeout(shrink, lock + HOLD_AFTER_LOCK_MS));
        return clear;
    }, [saveKey, cinematic, shrink]);

    useLayoutEffect(() => {
        if (phase !== 'full') return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const width = Math.max(SMALL_W, Math.min(vw - 16, Math.floor((vh - 24) / RATIO), 460));
        setBox({ left: Math.round((vw - width) / 2), top: Math.max(8, Math.round((vh - width * RATIO) / 2)), width });
    }, [phase, saveKey]);

    const moving = phase !== 'small' && box != null;
    const missed = nodes.filter(n => n.state === 'missed').length;
    const showsScore = score != null && score > 0;
    return (
        <>
            <div ref={slot} data-testid="vr-ring" data-phase={phase} className="mx-auto w-full max-w-[min(230px,24vh)] [&_.ssc-card]:!hidden"
                style={variant === 'cinematic' && showsScore ? { minHeight: `calc(min(${SMALL_W}px, 24vh) * ${RATIO.toFixed(3)})` } : undefined}>
                {cinematic && phase !== 'small' && (
                    <div data-testid="vr-ring-backdrop" onClick={phase === 'full' ? shrink : undefined} aria-hidden="true"
                        className="fixed inset-0 z-[200] bg-gradient-to-b from-white via-emerald-50 to-white"
                        style={{ opacity: phase === 'full' ? 1 : 0, transition: `opacity ${SHRINK_MS}ms ease`, pointerEvents: phase === 'full' ? 'auto' : 'none' }} />
                )}
                <div data-testid="vr-ring-box"
                    style={moving ? { position: 'fixed', zIndex: 201, left: box.left, top: box.top, width: box.width, transition: phase === 'shrink' ? `left ${SHRINK_MS}ms cubic-bezier(.65,0,.35,1), top ${SHRINK_MS}ms cubic-bezier(.65,0,.35,1), width ${SHRINK_MS}ms cubic-bezier(.65,0,.35,1)` : undefined } : undefined}>
                    <UnderstandingRing score={score} nodes={nodes} variant={variant} haptics={false} ignoreReducedMotion settled={seenBefore}
                        replayKey={saveKey} onMissedTap={onMissedTap} fallback={fallback} />
                </div>
            </div>
            {showsScore && phase === 'small' && <RingMessage score={score ?? 0} missed={missed} onReadMore={onReadMore} />}
        </>
    );
};

/** The ring's reward words as page text (the module's own words and rules: never a 0, missing things are an invitation). */
const RingMessage: React.FC<{ score: number; missed: number; onReadMore?: () => void }> = ({ score, missed, onReadMore }) => {
    const [title, sub] = defaultMessage(score, 10, missed);
    const [before, after] = sub.split('{n}');
    return (
        <div data-testid="vr-ring-message" className="mt-2 flex animate-plr-pop items-center gap-2.5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-lime-50 px-3 py-2">
            <div className="min-w-0 flex-1">
                <p className="m-0 text-[16px] font-extrabold leading-snug text-emerald-900">{title}</p>
                <p className="m-0 mt-0.5 text-[14px] font-medium leading-snug text-stone-700">
                    {before}{after != null && <b className="font-extrabold text-red-600">{digits(missed)}</b>}{after}
                </p>
            </div>
            {onReadMore && (
                // PROPOSED (Marathi) — the preview's label for the ↓ ("read or listen below").
                <button type="button" onClick={onReadMore} aria-label="खाली वाचा किंवा ऐका" data-testid="vr-ring-readmore"
                    className="grid h-10 w-10 shrink-0 animate-bounce place-items-center rounded-full bg-emerald-700 text-white shadow active:scale-95"><ChevronDown size={26} aria-hidden="true" /></button>
            )}
        </div>
    );
};

export default RingStage;
