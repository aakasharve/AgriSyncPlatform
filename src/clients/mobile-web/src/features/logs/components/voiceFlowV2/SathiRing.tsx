/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A3 + A4; the founder approved 28 Nov: "Approve the latest design with
 * haptick feed back and listening waves") — Sathi's ring, as the approved recording-redesign page draws it (Mode A, "listening wave"):
 * Sathi's face in the middle with its soft glow, a faint grain halo round it (the blackboard's own grain, `chalkBoard.GRAIN`), the
 * 9 part icons with NO names, turning calmly (0.2 rad/s), and the fine dotted circle in one green-to-teal shade turning the other way
 * at 1.5x. Built at 272 px and shown at 0.86, as on the page.
 *
 * Three uses, one ring:
 *   - `listen` (the recording screen): a slow, low-contrast tint wave goes round the icons, a little stronger while he speaks and fainter
 *     in his pauses, from the phone's own mic level only, smoothed heavily so it never flashes. Every icon gets the same wave whatever he
 *     says: it never claims a part was understood (P4). The halo breathes gently with his voice. `pulse` bumps once per finished
 *     sentence: one soft ring pulse.
 *   - `chase` (the screen after stop, while his words are understood): a quiet light steps round the icons, calm, in the same tint.
 *   - `reveal` (once the real answer is back): `told` icons light in their colour with a tick, `missed` icons are gently marked; the
 *     ring stands still. The caller decides both sets from the real records; this draws only what it is given (P5).
 * Motion runs in one animation frame loop writing styles straight to the nodes (React does not re-render 60 times a second). Reduced
 * motion: the ring, the halo and the dots stand still and the icons hold one soft tint (the page's calm still version).
 */
import React, { useEffect, useRef, useState } from 'react';
import { CategoryIcon } from '../shramsathi/understandingRing/CategoryIcon';
import { CATEGORY_META, type CategoryId, type Tone } from '../shramsathi/understandingRing/categories';
import { GRAIN } from '../shramsathi/chalkBoard';
import { RING_V2_ORDER } from '../voiceResult/resultModel';

const SATHI = '/images/sathi/sathi-points-down-both.png';
/** The page's geometry: built at 272 px, the icons on a 0.3 radius, shown at 0.86 (234 px). */
const SIZE = 272;
const C = SIZE / 2;
const R = SIZE * 0.3;
const TAU = Math.PI * 2;
/** One full turn of the ring every ~31 s; the dotted circle the other way at 1.5x. */
const TURN_RAD_PER_S = 0.2;
/** The chase: one icon about every 0.7 s. */
const CHASE_RAD_PER_S = (TAU / 9) / 0.7;
/** Reduced motion: every icon holds this soft tint while it is in use. */
const STILL_TINT = 0.3;

const TONE: Readonly<Record<Tone, string>> = { g: '#1E9E5A', b: '#2D7FF9', o: '#EA580C' };
/** 10% of the tone on white, pre-mixed (old Android WebViews have no `color-mix`). */
const TINT: Readonly<Record<Tone, string>> = { g: '#E9F5EE', b: '#EAF2FE', o: '#FDEEE6' };
/** The dotted circle's and the wave's one quiet shade: green to teal and back. */
const TPAL: readonly (readonly [number, number, number])[] = [[30, 158, 90], [20, 184, 166], [30, 158, 90]];
const WPAL: readonly (readonly [number, number, number])[] = [[30, 158, 90], [20, 170, 150], [30, 158, 90]];
const DOTS = 44;

const palAt = (p: readonly (readonly [number, number, number])[], u: number): [number, number, number] => {
    const v = ((u % 1) + 1) % 1;
    const x = v * (p.length - 1);
    const i = Math.min(p.length - 2, Math.floor(x));
    const f = x - i;
    return [0, 1, 2].map(j => p[i][j] + (p[i + 1][j] - p[i][j]) * f) as [number, number, number];
};
const rgb = (c: readonly number[], a?: number): string => (a === undefined
    ? `rgb(${c.map(n => Math.round(n)).join(',')})`
    : `rgba(${c.map(n => Math.round(n)).join(',')},${a.toFixed(3)})`);
/** Where icon `k` stands when the ring has turned `th`. */
const spot = (k: number, th: number): { x: number; y: number } => {
    const a = -Math.PI / 2 + (k * TAU) / RING_V2_ORDER.length + th;
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
};
const at = (k: number, th: number): string => {
    const p = spot(k, th);
    return `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`;
};

const RING_CSS = `
@keyframes srSpin{to{transform:rotate(360deg)}}
@keyframes srPulse{0%{transform:scale(.96);opacity:.65}100%{transform:scale(1.5);opacity:0}}
@keyframes srPulseStill{0%{opacity:.55;transform:scale(1.2)}100%{opacity:0;transform:scale(1.2)}}
@keyframes srG1{0%,100%{opacity:.2;transform:scale(.85)}45%{opacity:.85;transform:scale(1.12)}}
@keyframes srG2{0%,100%{opacity:.2;transform:scale(.92)}55%{opacity:.9;transform:scale(1.16)}}
@keyframes srIn{0%{transform:scale(.88);opacity:.35}100%{transform:none;opacity:1}}
.sr-box{position:relative;width:234px;height:234px;flex:none}
.sr-ring{position:absolute;left:0;top:0;width:${SIZE}px;height:${SIZE}px;transform:scale(.86);transform-origin:0 0;--wave:#1E9E5A}
.sr-aura{position:absolute;left:-14px;top:-14px;width:300px;height:300px;z-index:0;pointer-events:none;opacity:.72;
  -webkit-mask-image:radial-gradient(circle closest-side,transparent 37%,#000 48%,rgba(0,0,0,.7) 64%,rgba(0,0,0,.2) 82%,transparent 100%);
  mask-image:radial-gradient(circle closest-side,transparent 37%,#000 48%,rgba(0,0,0,.7) 64%,rgba(0,0,0,.2) 82%,transparent 100%)}
.sr-aura i{position:absolute;inset:0;border-radius:50%}
.sr-aura .c{background:conic-gradient(from .4rad,rgba(104,166,132,.3),rgba(104,174,166,.3),rgba(150,192,182,.3),rgba(206,188,146,.3),rgba(104,174,166,.3),rgba(104,166,132,.3));animation:srSpin 140s linear infinite}
.sr-aura .g{background-image:${GRAIN};background-size:140px 140px;opacity:.45;mix-blend-mode:soft-light}
.sr-track{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;transform-origin:50% 50%;overflow:visible}
.sr-pz{position:absolute;left:50%;top:50%;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;border:1.5px solid rgba(30,158,90,.5);pointer-events:none;opacity:0;z-index:1;animation:srPulse .9s ease-out}
.sr-node{position:absolute;left:0;top:0;width:0;height:0;z-index:2}
.sr-hl{position:absolute;left:-24px;top:-24px;width:48px;height:48px;border-radius:50%;border:2px solid var(--wave);opacity:0;pointer-events:none}
.sr-nb{position:absolute;left:-20px;top:-20px;width:40px;height:40px;border-radius:50%;background:#fff;border:1.5px solid #E3E7E2;display:grid;place-items:center;box-shadow:0 1px 2px rgba(20,60,40,.05)}
.sr-tint{position:absolute;inset:0;border-radius:50%;background:var(--wave);opacity:0}
.sr-g{position:relative;opacity:.35;filter:grayscale(1)}
.sr-c{position:absolute;left:19%;top:19%;opacity:0}
.sr-badge{position:absolute;right:-4px;bottom:-4px;width:15px;height:15px;border-radius:50%;border:1.5px solid #fff;display:grid;place-items:center}
.sr-node[data-state="told"] .sr-nb{background:var(--tint);border-color:var(--tone);animation:srIn .45s cubic-bezier(.3,1.4,.5,1) both;animation-delay:var(--d)}
.sr-node[data-state="told"] .sr-c{opacity:1}
.sr-node[data-state="told"] .sr-g{opacity:0}
.sr-node[data-state="told"] .sr-badge{background:var(--tone)}
.sr-node[data-state="missed"] .sr-nb{background:#FFF5F4;border-color:#F6B8B5;animation:srIn .45s ease both;animation-delay:var(--d)}
.sr-node[data-state="missed"] .sr-g{opacity:.55}
.sr-node[data-state="missed"] .sr-badge{background:#E5484D}
.sr-orbw{position:absolute;left:50%;top:50%;width:118px;height:118px;margin:-59px 0 0 -59px;z-index:3}
.sr-glow{position:absolute;border-radius:50%;filter:blur(14px);pointer-events:none;opacity:.75}
.sr-glow.a{left:22%;top:-6%;width:56%;height:56%;background:radial-gradient(circle,rgba(22,178,78,.7),transparent 67%);animation:srG1 3.8s ease-in-out infinite}
.sr-glow.b{left:58%;top:28%;width:52%;height:52%;background:radial-gradient(circle,rgba(28,108,240,.65),transparent 65%);animation:srG2 4.9s ease-in-out .6s infinite}
.sr-glow.c{left:-6%;top:48%;width:50%;height:50%;background:radial-gradient(circle,rgba(26,185,84,.6),transparent 64%);animation:srG2 4.4s ease-in-out 1.6s infinite}
.sr-orb{position:absolute;inset:6px;border-radius:50%;overflow:hidden;background:rgb(255,246,198);box-shadow:0 4px 16px rgba(0,0,0,.07),0 0 20px rgba(16,185,129,.18);border:3px solid #CDEBD7}
.sr-orb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
@media (prefers-reduced-motion: reduce){
  .sr-aura .c,.sr-glow,.sr-nb{animation:none!important}
  .sr-pz{animation:srPulseStill .7s steps(1,end) forwards}
}
`;

/** True while the phone asks for reduced motion (follows the setting live). */
export function useReducedMotion(): boolean {
    const query = '(prefers-reduced-motion: reduce)';
    const read = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    const [reduced, setReduced] = useState(read);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia(query);
        const on = () => setReduced(mq.matches);
        mq.addEventListener?.('change', on);
        return () => mq.removeEventListener?.('change', on);
    }, []);
    return reduced;
}

export type RingMode = 'listen' | 'chase' | 'reveal';

export interface SathiRingProps {
    mode: RingMode;
    /** `listen`: the live mic level 0..1, read every frame; undefined = not measurable (the wave rests at its faint floor). */
    levelRef?: React.RefObject<number | undefined>;
    /** `listen`: bumps once per finished sentence (one soft ring pulse). */
    pulse?: number;
    /** `reveal`: the parts the real answer told (lit in their colour, with a tick). */
    told?: ReadonlySet<CategoryId>;
    /** `reveal`: the parts the day has not told at all (gently marked). */
    missed?: ReadonlySet<CategoryId>;
}

const EMPTY: ReadonlySet<CategoryId> = new Set();

const SathiRingView: React.FC<SathiRingProps> = ({ mode, levelRef, pulse = 0, told = EMPTY, missed = EMPTY }) => {
    const reduced = useReducedMotion();
    const ring = useRef<HTMLDivElement>(null);
    const aura = useRef<HTMLDivElement>(null);
    const track = useRef<SVGSVGElement>(null);
    const nodes = useRef<(HTMLDivElement | null)[]>([]);
    const moving = mode !== 'reveal' && !reduced;
    const still = mode !== 'reveal' && reduced ? STILL_TINT : 0;

    useEffect(() => {
        if (!moving || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return undefined;
        const root = ring.current;
        if (!root) return undefined;
        const parts = nodes.current.map(n => ({
            node: n,
            hl: n?.querySelector<HTMLElement>('.sr-hl') ?? null,
            tint: n?.querySelector<HTMLElement>('.sr-tint') ?? null,
            colour: n?.querySelector<HTMLElement>('.sr-c') ?? null,
        }));
        const last: number[] = [];
        const setI = (k: number, v: number): void => {
            if (last[k] !== undefined && Math.abs(v - last[k]) <= 0.008) return;
            last[k] = v;
            const p = parts[k];
            if (p.hl) p.hl.style.opacity = (v * 0.8).toFixed(3);
            if (p.tint) p.tint.style.opacity = (v * 0.14).toFixed(3);
            if (p.colour) p.colour.style.opacity = (v * 0.85).toFixed(3);
        };
        let raf = 0;
        let prev = -1;
        let th = 0;
        let lv = 0;
        let lvs = 0;
        let wph = 0;
        let t = 0;
        let waveAt = -1;
        const frame = (now: number): void => {
            const dt = prev < 0 ? 0 : Math.min(0.05, (now - prev) / 1000);
            prev = now;
            t += dt;
            // The listening level: quick to rise, slow to fall, then smoothed again (so a word never flashes). The chase breathes slowly.
            const heard = levelRef?.current;
            const raw = mode === 'listen' ? Math.max(0, Math.min(1, typeof heard === 'number' && Number.isFinite(heard) ? heard : 0)) : 0.35 + 0.2 * Math.sin(t * 1.1);
            const tau = raw > lv ? 0.06 : 0.28;
            lv += (raw - lv) * (1 - Math.exp(-dt / tau));
            lvs += (lv - lvs) * (1 - Math.exp(-dt / 0.9));
            th += TURN_RAD_PER_S * dt;
            parts.forEach((p, k) => { if (p.node) p.node.style.transform = at(k, th); });
            if (track.current) track.current.style.transform = `rotate(${(-th * 180 / Math.PI * 1.5).toFixed(2)}deg)`;
            if (aura.current) {
                aura.current.style.opacity = (0.72 + 0.28 * lvs).toFixed(3);
                aura.current.style.transform = `scale(${(0.99 + 0.02 * lvs).toFixed(4)})`;
            }
            if (t - waveAt > 0.2) { waveAt = t; root.style.setProperty('--wave', rgb(palAt(WPAL, t / 16))); }
            const n = parts.length;
            if (mode === 'listen') {
                wph += dt * (0.42 + 0.25 * lvs);
                const amp = 0.2 + 0.35 * lvs;
                for (let k = 0; k < n; k++) {
                    let d = (((wph - (k * TAU) / n) % TAU) + TAU) % TAU;
                    if (d > Math.PI) d -= TAU;
                    setI(k, Math.exp(-(d * d) / 1.45) * amp);
                }
            } else {
                wph += dt * CHASE_RAD_PER_S;
                for (let k = 0; k < n; k++) {
                    let d = (((wph - (k * TAU) / n) % TAU) + TAU) % TAU;
                    if (d > Math.PI) d -= TAU;
                    setI(k, Math.exp(-(d * d) / 0.35) * 0.5);
                }
            }
            raf = window.requestAnimationFrame(frame);
        };
        raf = window.requestAnimationFrame(frame);
        return () => window.cancelAnimationFrame(raf);
    }, [moving, mode, levelRef]);

    let order = 0;
    return (
        <>
        <style>{RING_CSS}</style>
        <div className="sr-box" data-testid="sathi-ring" data-mode={mode} data-lit={mode === 'reveal' ? told.size : 0} data-still={reduced ? 'yes' : 'no'} aria-hidden="true">
            <div className="sr-ring" ref={ring} style={reduced && mode !== 'reveal' ? ({ '--wave': '#1E9E7A' } as React.CSSProperties) : undefined}>
                <div className="sr-aura" ref={aura} data-testid="sathi-ring-halo"><i className="c" /><i className="g" /></div>
                <svg className="sr-track" ref={track} viewBox={`0 0 ${SIZE} ${SIZE}`} data-testid="sathi-ring-dots">
                    {Array.from({ length: DOTS }, (_, k) => {
                        const a = (k / DOTS) * TAU - Math.PI / 2;
                        return <circle key={k} cx={(C + R * Math.cos(a)).toFixed(2)} cy={(C + R * Math.sin(a)).toFixed(2)} r="1.6" fill={rgb(palAt(TPAL, k / DOTS), 0.8)} />;
                    })}
                </svg>
                {pulse > 0 && <span key={pulse} className="sr-pz" data-testid="sathi-ring-pulse" data-pulse={pulse} />}
                {RING_V2_ORDER.map((id, k) => {
                    const meta = CATEGORY_META[id];
                    // अडथळा is lit only when told; it is never marked as missed (a day without a disturbance is a normal day).
                    const state = mode !== 'reveal' ? 'quiet' : told.has(id) ? 'told' : missed.has(id) && id !== 'blockers' ? 'missed' : 'quiet';
                    const delay = state === 'quiet' ? 0 : (order++) * 160;
                    return (
                        <div key={id} className="sr-node" data-testid={`sathi-ring-${id}`} data-state={state}
                            ref={el => { nodes.current[k] = el; }}
                            style={{ transform: at(k, 0), '--tone': TONE[meta.tone], '--tint': TINT[meta.tone], '--d': `${delay}ms` } as React.CSSProperties}>
                            <span className="sr-hl" style={still ? { opacity: still * 0.8 } : undefined} />
                            <div className="sr-nb">
                                <span className="sr-tint" style={still ? { opacity: still * 0.14 } : undefined} />
                                <CategoryIcon name={meta.icon} size={25} className="sr-g" />
                                <CategoryIcon name={meta.icon} size={25} className="sr-c" style={still ? { opacity: still * 0.85 } : undefined} />
                                {state !== 'quiet' && (
                                    <span className="sr-badge">
                                        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                                            {state === 'told'
                                                ? <path d="M4 8.2l2.6 2.6L12 5.4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                                : <><path d="M8 3.6v5.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /><circle cx="8" cy="11.8" r="1.4" fill="#fff" /></>}
                                        </svg>
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div className="sr-orbw">
                    <span className="sr-glow a" /><span className="sr-glow b" /><span className="sr-glow c" />
                    <div className="sr-orb"><img src={SATHI} alt="" width={106} height={106} /></div>
                </div>
            </div>
        </div>
        </>
    );
};

/** Memoised: the recording screen re-renders with every level reading; the ring reads the level from its ref instead. */
export const SathiRing = React.memo(SathiRingView);

export default SathiRing;
