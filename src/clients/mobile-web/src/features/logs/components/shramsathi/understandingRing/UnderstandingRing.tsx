// <UnderstandingRing> – the animated "मला किती समजलं" reveal for the post-save success surface.
//
// Drop-in for the score block of DayUnderstandingCard. The card keeps owning the fetch (useDayUnderstanding), the
// flag gate, the pending state and the DeclaredNoWorkDay path; this component only animates a day that HAS a score.
// A null / 0 score renders `fallback` (pass the card's existing "अजून समजतंय…" line) – never a 0 on screen.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { mountCinematicRing, type CineHandle, type HapticKind } from './cinematicEngine';
import { mountUnderstandingRing, type RingHandle } from './understandingEngine';
import type { RingNodeData } from './categories';
import type { MessageFn, Numerals } from './messages';
import './cinematic.css';
import './understanding.css';

/** The app's shared/utils/haptics.ts `hapticFeedback` object fits this shape. */
export interface HapticsLike { light(): void; success(): void }

export interface UnderstandingRingProps {
  /** Server Day Understanding Score (useDayUnderstanding). null or 0 → `fallback`. */
  score: number | null;
  /** Always 10 today ("X / १०"). */
  total?: number;
  /** buildNodes(dayCategoryStates(dayLogs, date, extras)). */
  nodes: RingNodeData[];
  /** 'cinematic' = canvas 3D scene (default) · 'flat' = light DOM version for very old phones. */
  variant?: 'cinematic' | 'flat';
  /** 'gauge' (default) fills `score` segments – right for the server score, which is not a node count.
   *  'mapped' lights segment i with node i; use it only when score === told nodes. */
  ringMode?: 'gauge' | 'mapped';
  numerals?: Numerals;
  /** Off by default; the app has no sound setting yet. */
  sound?: boolean;
  /** Pass `hapticFeedback`; omit for the engine's own short vibration, `false` for none. */
  haptics?: HapticsLike | boolean;
  /** Change it to replay the reveal (e.g. the saved log id, or a "पुन्हा पाहा" tap counter). */
  replayKey?: string | number;
  /** Play the reveal even when the phone's "reduce motion" setting is on (otherwise it jumps to the final picture). */
  ignoreReducedMotion?: boolean;
  message?: MessageFn;
  /** A missed orb was tapped – e.g. open the voice recorder for that category. The engine already shows the hint. */
  onMissedTap?: (node: RingNodeData) => void;
  fallback?: ReactNode;
  className?: string;
}

export function UnderstandingRing({
  score, total = 10, nodes, variant = 'cinematic', ringMode = 'gauge', numerals = 'deva', sound = false,
  haptics, replayKey, ignoreReducedMotion, message, onMissedTap, fallback = null, className,
}: UnderstandingRingProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<CineHandle | RingHandle | null>(null);
  // Callbacks are read through refs so a new function identity on every parent render does not replay the reveal.
  const cb = useRef({ haptics, message, onMissedTap });
  cb.current = { haptics, message, onMissedTap };

  // The reveal plays once per replayKey. A later refresh of the score or the orbs (a sync tick, an answered question)
  // lands straight on the final frame instead of replaying 13 s with the number hidden. A re-mount within a second of
  // the first one (React StrictMode's mount → cleanup → mount) still plays.
  const played = useRef<{ key: unknown; at: number } | null>(null);
  const shown = score != null && score > 0;
  // Remount only when what the farmer would SEE changes.
  const nodesKey = useMemo(() => nodes.map((n) => `${n.id}:${n.state}`).join('|'), [nodes]);

  useEffect(() => {
    const el = host.current;
    if (!el || !shown) return;
    const now = performance.now(), last = played.current;
    const replay = !last || last.key !== replayKey || now - last.at < 1000;
    if (!last || last.key !== replayKey) played.current = { key: replayKey, at: now };
    const h = cb.current.haptics;
    const opts = {
      numerals, ringMode, sound, autoplay: replay, ignoreReducedMotion,
      haptics: typeof h === 'object' ? (kind: HapticKind) => (kind === 'lock' ? h.success() : h.light()) : h ?? true,
      message: cb.current.message,
      onMissedTap: (n: { id: string }) => {
        const node = nodes.find((x) => x.id === n.id);
        if (node) cb.current.onMissedTap?.(node);
      },
    };
    const data = { nodes, score: Math.min(score, total), total };
    const ring = variant === 'flat' ? mountUnderstandingRing(el, data, opts) : mountCinematicRing(el, data, opts);
    if (!replay) ring.seek(ring.duration);
    handle.current = ring;
    return () => { handle.current?.destroy(); handle.current = null; };
    // `nodes` is represented by nodesKey; `sound` is applied live below without a replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, score, total, nodesKey, variant, ringMode, numerals, replayKey, ignoreReducedMotion]);

  useEffect(() => { handle.current?.setSound(sound); }, [sound]);

  if (!shown) return <>{fallback}</>;
  return <div ref={host} className={className} data-testid="understanding-ring" />;
}

export default UnderstandingRing;
