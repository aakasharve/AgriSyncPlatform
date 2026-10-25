// Shared timeline for both renderers (cinematic canvas + flat DOM fallback): when each point lands,
// when each category lights, when missed ones show, when the score locks. Pure functions of the data.
import type { NodeState } from './categories';

export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const prog = (t: number, t0: number, d: number) => clamp((t - t0) / d);
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;
export const ease = {
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  outQuint: (x: number) => 1 - Math.pow(1 - x, 5),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutSine: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
export function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export interface TimelineNode { state: NodeState }
export interface Step { t: number; spinDur: number; loops: number; seg: number }
export interface Light { ni: number; t: number }
export interface Miss { ni: number; t: number; seg: number | null }
export interface Plan { steps: Step[]; lights: Light[]; misses: Miss[]; countEnd: number; lock: number; card: number; duration: number; mapped: boolean }
export interface Pacing { count0: number; step: number; spin: number; lastSpin: number; lastLoops: number; missGap: number; tail: number }

export const FLAT_PACING: Pacing = { count0: 1900, step: 430, spin: 400, lastSpin: 1150, lastLoops: 2, missGap: 280, tail: 2900 };
export const CINEMATIC_PACING: Pacing = { count0: 3400, step: 560, spin: 470, lastSpin: 1750, lastLoops: 3, missGap: 360, tail: 3600 };

export function plan(nodes: TimelineNode[], score: number, total: number, mode: 'gauge' | 'mapped', pace: Pacing): Plan {
  const told: number[] = [], missed: number[] = [];
  nodes.forEach((nd, i) => { if (nd.state === 'told') told.push(i); else if (nd.state === 'missed') missed.push(i); });
  const s = Math.round(clamp(score, 0, total));
  const mapped = mode === 'mapped' && nodes.length === total && told.length === s;
  const steps: Step[] = [];
  for (let k = 0; k < s; k++) {
    const last = k === s - 1;
    steps.push({ t: pace.count0 + k * pace.step, spinDur: last ? pace.lastSpin : pace.spin, loops: last ? pace.lastLoops : 1, seg: mapped ? told[k] : k });
  }
  const lastStep = steps[steps.length - 1];
  const countEnd = lastStep ? lastStep.t + 80 + lastStep.spinDur : pace.count0 + 900;
  const span = lastStep ? lastStep.t - pace.count0 : 900;
  const lights = told.map((ni, k) => ({ ni, t: mapped ? steps[k].t : pace.count0 + (told.length > 1 ? (k * span) / (told.length - 1) : 0) }));
  const missed0 = countEnd + 250;
  const misses = missed.map((ni, j) => ({ ni, t: missed0 + j * pace.missGap, seg: mapped ? ni : null }));
  const lock = missed0 + missed.length * pace.missGap + (missed.length ? 150 : 0);
  return { steps, lights, misses, countEnd, lock, card: lock + 300, duration: lock + pace.tail, mapped };
}
/** reel position in digit steps: each point spins `loops` full turns plus one */
export function reelPos(P: Plan, t: number): number {
  return P.steps.reduce((p, st) => p + (10 * st.loops + 1) * ease.outQuint(prog(t, st.t + 80, st.spinDur)), 0);
}
export function landed(P: Plan, t: number): number { return P.steps.filter((st) => t >= st.t + 80 + st.spinDur * 0.9).length; }
