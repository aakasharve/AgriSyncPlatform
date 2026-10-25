/* Shram Safal – "मला किती समजलं" CINEMATIC renderer (canvas 2D, no dependencies).
 *
 * A small real-time scene, drawn every frame as a pure function of time:
 *   · a 3D camera (pitch / yaw / dolly / shake) over a light field with faint crop rows and soft motes at many depths
 *   · glass orbs for the categories, a glass ring, energy beams that travel from each orb into the ring
 *   · soft coloured glow (a blurred emissive layer), drop shadows and depth of field – white glass on the light panel
 *   · Sathi's brain: pops out above the ring, takes in packets of information from every told orb (fills with colour
 *     from the bottom up, gulps, synapses fire), then settles into the core after the lock
 *   · a slot-machine drum for the score with true cylinder perspective and motion blur
 *   · the lock: soft flash, shockwave, pale-lime light rays, a teal streak, a burst of leaves and sparks, the reward card
 *
 * Same data, timeline and handle as the flat renderer (understandingEngine.ts); pick with `variant`.
 */
import { ICONS, type IconName } from './icons';
import { defaultMessage, digits, type MessageFn, type Numerals } from './messages';
import type { NodeState, Tone } from './categories';
import { CINEMATIC_PACING, clamp, ease, landed, mix, plan, prog, reelPos, rng, type Plan } from './timeline';
import { makeSound } from './sound';
import { BRAIN_EMPTY, BRAIN_FULL, BRAIN_H, BRAIN_LOBE, BRAIN_SPARKS, BRAIN_W } from './brain';

export interface CineNode { id: string; label: string; state: NodeState; tone?: Tone; hint?: string; icon?: IconName | string }
export interface CineData { nodes: CineNode[]; score: number; total: number }
export type HapticKind = 'land' | 'lock';
export interface CineOptions {
  numerals?: Numerals;
  ringMode?: 'gauge' | 'mapped';
  quality?: 'high' | 'lite' | 'auto';
  sound?: boolean;
  haptics?: boolean | ((kind: HapticKind) => void);
  autoplay?: boolean;
  ignoreReducedMotion?: boolean;
  /** device pixel ratio for the canvas (default: min(devicePixelRatio, 2)); the recorder passes its own */
  dpr?: number;
  message?: MessageFn;
  onMissedTap?: (node: CineNode) => void;
}
export interface CineHandle { ready: Promise<void>; play(): void; seek(ms: number): void; readonly duration: number; setSound(on: boolean): void; destroy(): void }

// ---------------------------------------------------------------- scene constants (logical px; canvas scales to the container)
const LW = 440, LH = 600;                        // scene box; the frosted card sits below it in the DOM
const SCX = 220, SCY = 292;                       // screen centre of the ring
const RX = 1.95, RY = 2.5, ORB = 0.36, RING = 1, RING_W = 0.17, GAP = 0.09, CORE = 0.76;
const GROUND_Y = 3.35;
const BUILD = 1500;                              // the brain is alone on the panel until here, then the world builds round it
const BURST_Y = -1.6;                            // world height of the hovering brain: the celebration bursts from here
const TONE_RGB: Record<Tone, [number, number, number]> = { g: [30, 158, 90], b: [45, 127, 249], o: [240, 138, 36] };
const EMBER: [number, number, number] = [229, 72, 77];
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
function segRGB(s: number, n: number): [number, number, number] {
  const k = s / Math.max(1, n - 1), c0 = [23, 163, 74], c1 = [19, 168, 160], c2 = [30, 86, 230];   // the app's ramp
  const [a, b, kk] = k < 0.5 ? [c0, c1, k * 2] : [c1, c2, (k - 0.5) * 2];
  return [0, 1, 2].map((i) => Math.round(mix(a[i], b[i], kk))) as [number, number, number];
}
function noise(t: number, seed: number) { return Math.sin(t * 0.0017 + seed) * 0.6 + Math.sin(t * 0.0041 + seed * 2.3) * 0.4; }

interface Cam { pitch: number; yaw: number; dist: number; f: number; px: number; py: number; sx: number; sy: number }
interface P2 { x: number; y: number; k: number; z: number }
interface BrainPose { x: number; y: number; w: number; lift: number; home: number; homeY: number; homeW: number; cx: number; cy: number; cr: number }
function project(x: number, y: number, z: number, c: Cam): P2 {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
  const zc = Math.max(0.5, z2 + c.dist), k = c.f / zc;
  return { x: SCX + c.sx + (x1 + c.px) * k, y: SCY + c.sy + (y2 + c.py) * k, k, z: zc };
}

function svgImage(markup: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  });
}
function sprite(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

export function mountCinematicRing(container: HTMLElement, data: CineData, options: CineOptions = {}): CineHandle {
  const opts = { numerals: 'deva' as Numerals, ringMode: 'gauge' as const, quality: 'auto' as const, sound: false, haptics: true as CineOptions['haptics'],
                 autoplay: true, ignoreReducedMotion: false, ...options };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const high = opts.quality === 'high' || (opts.quality === 'auto' && !((nav.deviceMemory ?? 4) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 4));
  const N = data.nodes.length, total = data.total;
  const P: Plan = plan(data.nodes, data.score, total, opts.ringMode, CINEMATIC_PACING);
  const missedCount = data.nodes.filter((n) => n.state === 'missed').length;
  const [title, sub] = (opts.message ?? defaultMessage)(P.steps.length, total, missedCount);
  const lightOf = new Map(P.lights.map((l) => [l.ni, l])), missOf = new Map(P.misses.map((m) => [m.ni, m]));
  const lastStep = P.steps[P.steps.length - 1];

  // ---- DOM: canvas scene + frosted card + hint + a hidden live summary for screen readers
  container.innerHTML = '';
  container.classList.add('ssc');
  const scene = document.createElement('div'); scene.className = 'ssc-scene'; container.appendChild(scene);
  const cv = document.createElement('canvas'); cv.className = 'ssc-canvas'; scene.appendChild(cv);
  const ctx = cv.getContext('2d')!;
  const glow = document.createElement('canvas'), gx = glow.getContext('2d')!;
  const card = document.createElement('div'); card.className = 'ssc-card';
  card.innerHTML = `<div class="ssc-card-glow"></div><div class="ssc-card-icon">${ICONS.sprout}</div><div class="ssc-card-text"><b></b><span></span></div>`;
  (card.querySelector('b') as HTMLElement).textContent = title;
  (card.querySelector('.ssc-card-text span') as HTMLElement).innerHTML = sub.replace('{n}', '<b class="ssc-roll"></b>');
  const roll = card.querySelector<HTMLElement>('.ssc-roll');
  container.appendChild(card);
  const hint = document.createElement('div'); hint.className = 'ssc-hint'; scene.appendChild(hint);
  const live = document.createElement('p'); live.className = 'ssc-sr'; live.setAttribute('aria-live', 'polite');
  live.textContent = `समजलं ${digits(P.steps.length, opts.numerals)} / ${digits(total, opts.numerals)}. ${title}`;
  container.appendChild(live);

  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  let scale = 1;
  function fit() {
    const w = scene.clientWidth || LW; scale = w / LW;
    cv.width = Math.round(w * dpr); cv.height = Math.round((w * LH / LW) * dpr);
    glow.width = Math.round(cv.width / 2); glow.height = Math.round(cv.height / 2);
    container.style.setProperty('--ssc-s', scale.toFixed(4));
  }
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { fit(); if (lastT >= 0) frame(lastT, null); }) : null;
  ro?.observe(scene);

  // ---- assets: icon bitmaps, sprites, particles
  const iconKey = (n: CineNode) => (n.icon && n.icon in ICONS ? (n.icon as IconName) : null);
  // SVGs are rasterised once to bitmaps (drawing an SVG image every frame at a changing size is slow on cheap phones)
  const imgs = new Map<string, HTMLCanvasElement>();
  const bake = async (key: string, markup: string, w: number, h: number) => {
    const img = await svgImage(markup); if (!img) return;
    const b = document.createElement('canvas'); b.width = w; b.height = h; b.getContext('2d')!.drawImage(img, 0, 0, w, h); imgs.set(key, b);
  };
  const fontsLoad = document.fonts
    ? document.fonts.load('800 24px "Noto Sans Devanagari"').then(() => document.fonts.load('600 13px "Noto Sans Devanagari"')).then(() => undefined, () => undefined)
    : Promise.resolve();
  const ready = Promise.all([
    ...data.nodes.map((n) => { const k = iconKey(n); return bake(n.id, k ? ICONS[k] : n.icon && n.icon.trim().startsWith('<svg') ? n.icon : ICONS.work, 128, 128); }),
    bake('__brainE', BRAIN_EMPTY, 480, 416), bake('__brainF', BRAIN_FULL, 480, 416), bake('__cross', ICONS.cross, 96, 96),
    Promise.race([fontsLoad, new Promise<void>((r) => window.setTimeout(r, 700))]),   // never hold the first paint on a slow font
  ]).then(() => undefined);
  const bokehSprite = sprite(128, [[0, 'rgba(255,255,255,.9)'], [0.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
  const r0 = rng(3);
  const dust = Array.from({ length: high ? 70 : 34 }, () => ({
    x: (r0() - 0.5) * 12, y: (r0() - 0.5) * 11, z: -3 + r0() * 17, s: 0.03 + r0() * 0.09, sp: 0.4 + r0(), ph: r0() * 6.28,
    c: r0() < 0.15 ? [240, 190, 90] : r0() < 0.55 ? [43, 182, 115] : [45, 127, 249] as number[],
  }));
  const r1 = rng(19);
  const burst = Array.from({ length: high ? 80 : 40 }, (_, i) => {
    const a = r1() * Math.PI * 2, el = (r1() - 0.3) * 1.2, v = 1.6 + r1() * 2.6;
    return { leaf: i % 3 !== 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.9 - 1.2, vz: el * v * 0.6, spin: (r1() - 0.5) * 14, rot: r1() * 6.28,
             size: 0.08 + r1() * 0.1, delay: r1() * 180, col: [[30, 158, 90], [130, 190, 30], [19, 168, 160], [240, 190, 90], [45, 127, 249]][i % 5] as [number, number, number] };
  });
  // information packets: a burst from each told orb as it lights, then a trickle until the lock
  const FEED_MS = 720;
  const r2 = rng(47);
  const feed = P.lights.map(() => Array.from({ length: high ? 12 : 6 }, (_, j) => ({ d: j * 55 + r2() * 30, bend: (r2() - 0.5) * 0.9, sz: 0.75 + r2() * 0.55, chip: j % 3 === 1 })));
  const arrivals = P.lights.map((l) => l.t + 120 + FEED_MS);
  const lobe = new Path2D(BRAIN_LOBE), brainPath = new Path2D();
  brainPath.addPath(lobe); brainPath.addPath(lobe, new DOMMatrix([-1, 0, 0, 1, BRAIN_W, 0]));
  const orbAt: ({ x: number; y: number; r: number } | undefined)[] = [];
  const orbSeed = data.nodes.map((_, i) => ({ rise: BUILD + 700 + i * 85 + (rng(i + 5)() * 120), bob: rng(i + 31)() * 6.28 }));

  // ---- camera choreography
  function camera(t: number): Cam {
    const intro = ease.inOutCubic(prog(t, BUILD - 700, 2600));
    const settleEnd = lastStep ? lastStep.t : P.countEnd;
    let pitch = mix(1.02, 0.3, intro);
    pitch = mix(pitch, 0.13, ease.inOutSine(prog(t, BUILD + 1100, Math.max(600, settleEnd - BUILD - 1100))));
    pitch = mix(pitch, 0.0, ease.inOutSine(prog(t, P.lock - 700, 1500)));
    let yaw = mix(-0.26, 0.09, ease.inOutSine(prog(t, 0, P.countEnd)));
    yaw = mix(yaw, 0, ease.inOutSine(prog(t, P.lock - 400, 1600))) + noise(t, 1.3) * 0.012;
    let dist = mix(14.5, 9.7, ease.inOutCubic(prog(t, BUILD - 700, 2800)));
    if (lastStep) dist = mix(dist, 8.35, ease.inOutSine(prog(t, lastStep.t, P.lock - lastStep.t)));
    dist = mix(dist, 9.15, ease.outCubic(prog(t, P.lock + 80, 1300)));
    // shake: small kick per landed point, a bigger one at the lock
    let sx = 0, sy = 0;
    P.steps.forEach((st, i) => {
      const k = prog(t, st.t + 80 + st.spinDur * 0.9, 260); if (k > 0 && k < 1) { const a = (1 - k) * 2.2 * scale; sx += Math.sin(k * 40 + i) * a; sy += Math.cos(k * 33 + i) * a; }
    });
    const kl = prog(t, P.lock, 520); if (kl > 0 && kl < 1) { const a = (1 - kl) * 5 * scale; sx += Math.sin(kl * 50) * a; sy += Math.cos(kl * 41) * a; }
    return { pitch, yaw, dist, f: 700, px: 0, py: mix(0.55, 0, intro) + noise(t, 4.1) * 0.01, sx: sx / scale, sy: sy / scale };
  }

  // ---- the brain's place and size over time: alone in the middle → above the ring (between it and the top orb) →
  // home at the top of the core after the celebration
  const BRAIN_HOME = P.lock + 420, BRAIN_LAND = BRAIN_HOME + 1000;
  function brainPose(tt: number): BrainPose {
    const cam = camera(tt), cp = project(0, 0, 0, cam), cr = CORE * cp.k * mix(0.6, 1, ease.outBack(prog(tt, BUILD + 500, 700)));
    const ringTop = project(0, -(RING + RING_W / 2), 0, cam).y, orbBot = project(0, -(RY - ORB * 1.05), 0, cam).y;
    // sized to the gap with room for its growth, so at full power it still clears the top orb and the ring
    const gapH = Math.max(cr * 0.7, (ringTop - orbBot - cr * 0.18) / 1.1), hoverW = gapH * BRAIN_W / BRAIN_H, hoverY = (ringTop + orbBot) / 2;
    const lift = ease.inOutCubic(prog(tt, BUILD + 150, 1150)), home = ease.inOutCubic(prog(tt, BRAIN_HOME, 1000));
    const homeY = cp.y - cr * 0.5, homeW = cr * 0.8;
    const x = mix(mix(SCX, cp.x, lift), cp.x, home), y = mix(mix(SCY - 6, hoverY, lift), homeY, home);
    const w = mix(mix(92, hoverW, lift), homeW, home);   // on the panel from the very first frame, never popped in
    return { x, y, w, lift, home, homeY, homeW, cx: cp.x, cy: cp.y, cr };
  }

  // time integrals of the eased ramps, so phases driven by a changing rate stay continuous
  function rampArea(tt: number, a: number, d: number) {          // ∫ outCubic(prog(τ, a, d)) dτ up to tt
    if (tt <= a) return 0;
    if (tt >= a + d) return d * 0.75 + (tt - a - d);
    const x = (tt - a) / d; return d * (x + (Math.pow(1 - x, 4) - 1) / 4);
  }
  function chargeArea(tt: number) {                              // ∫ of the brain's charge curve up to tt
    const x = prog(tt, P.lock - 600, 600), y = prog(tt, P.lock, 160);
    return tt <= P.lock ? 600 * (x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI)) : 300 + 160 * (y - (y * y) / 2);
  }

  // ---- drawing helpers (all in logical px; ctx is pre-scaled)
  function polyArc(c: Cam, r: number, a0: number, a1: number, steps = 18) {
    const pts: P2[] = [];
    for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * (i / steps); pts.push(project(Math.cos(a) * r, Math.sin(a) * r, 0, c)); }
    return pts;
  }
  function strokePts(g: CanvasRenderingContext2D, pts: P2[], width: number, style: string | CanvasGradient) {
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.lineWidth = width; g.strokeStyle = style; g.stroke();
  }
  const segA = (s: number): [number, number] => { const span = (Math.PI * 2) / total, a0 = -Math.PI / 2 + s * span - span / 2 + GAP / 2; return [a0, a0 + span - GAP]; };

  // ---------------------------------------------------------------- one frame
  let lastT = -1, bx_ = SCX, by_ = SCY, cx_ = SCX, cy_ = SCY;
  function frame(t: number, fx: Fx | null) {
    lastT = t;
    const c = camera(t), S = dpr * scale;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    gx.setTransform(S / 2, 0, 0, S / 2, 0, 0);
    gx.clearRect(0, 0, LW, LH);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.setLineDash([]);

    // background: the app's light panel, warming a touch as the score locks
    const lift = ease.outCubic(prog(t, P.lock, 1400));
    const bg = ctx.createRadialGradient(SCX, SCY - 30, 20, SCX, SCY, 520);
    bg.addColorStop(0, '#FFFFFF');
    bg.addColorStop(0.6, `rgb(${Math.round(mix(246, 244, lift))},${Math.round(mix(250, 251, lift))},${Math.round(mix(246, 240, lift))})`);
    bg.addColorStop(1, '#E9F3EA');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, LW, LH);
    const fadeIn = prog(t, BUILD - 200, 900);

    // ground: crop rows receding into fog
    ctx.save(); ctx.globalAlpha = fadeIn;
    for (let z = -2; z <= 26; z += 0.9) {
      const a = project(-14, GROUND_Y, z, c), b = project(14, GROUND_Y, z, c);
      const fog = clamp(1 - (z + 2) / 28); ctx.strokeStyle = `rgba(30,140,80,${(0.12 * fog).toFixed(3)})`; ctx.lineWidth = Math.max(0.4, 0.02 * a.k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let x = -12; x <= 12; x += 1.5) {
      const a = project(x, GROUND_Y, -2, c), b = project(x, GROUND_Y, 26, c);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, 'rgba(30,140,80,.11)'); g.addColorStop(1, 'rgba(30,140,80,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    // dust & bokeh, far ones first (depth of field: far = bigger, softer, dimmer)
    const drawDust = (front: boolean) => {
      dust.forEach((d) => {
        if ((d.z < 0) !== front) return;
        const p = project(d.x + Math.sin(t / 3000 * d.sp + d.ph) * 0.25, d.y - (t / 1000) * 0.06 * d.sp, d.z, c);
        const blur = Math.abs(p.z - c.dist) / 6, size = d.s * p.k * (1 + blur * 1.6) * 2;
        const a = fadeIn * (0.18 + 0.5 / (1 + blur * 2)) * (0.6 + 0.4 * Math.sin(t / 700 + d.ph)) * (front ? 0.55 : 1);
        ctx.globalAlpha = clamp(a * 0.3);
        ctx.drawImage(tint(d.c as [number, number, number]), p.x - size / 2, p.y - size / 2, size, size);
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
    drawDust(false);

    // ring: glass track draws on with a light head, then the points ignite
    const draw = ease.inOutCubic(prog(t, BUILD + 250, 900));
    const ringIn = prog(t, BUILD + 250, 400);
    for (let s = 0; s < total; s++) {
      const [a0, a1] = segA(s), sweepEnd = -Math.PI / 2 + draw * Math.PI * 2 - Math.PI / total;
      if (a0 > sweepEnd) continue;
      const pts = polyArc(c, RING, a0, Math.min(a1, sweepEnd));
      const k = pts[0].k;
      strokePts(ctx, pts, RING_W * k, `rgba(206,214,208,${ringIn.toFixed(3)})`);
      strokePts(ctx, pts, RING_W * k * 0.18, `rgba(255,255,255,${(0.3 * ringIn).toFixed(3)})`);
    }
    if (draw > 0 && draw < 1) {                        // the light head drawing the ring
      const a = -Math.PI / 2 + draw * Math.PI * 2, p = project(Math.cos(a), Math.sin(a), 0, c);
      glowDot(p.x, p.y, 0.5 * p.k, [130, 190, 30], 0.9);
    }
    P.steps.forEach((st) => {
      const k = ease.inOutSine(prog(t, st.t + 150, 360)); if (k <= 0) return;
      const [a0, a1] = segA(st.seg), pts = polyArc(c, RING, a0, a0 + (a1 - a0) * k), col = segRGB(st.seg, total), w = RING_W * pts[0].k;
      const after = t > P.lock ? Math.max(0, Math.sin((t - P.lock) / 300 - st.seg * 0.55)) : 0;
      strokePts(ctx, pts, w, rgba(col, 0.95));
      strokePts(ctx, pts, w * 0.32, `rgba(235,255,245,${(0.2 + after * 0.18).toFixed(3)})`);
      strokePts(gx, pts, w * 1.8, rgba(col, 0.3 + after * 0.15));
      const ig = prog(t, st.t + 150, 420);
      if (ig > 0 && ig < 1) { const p = pts[pts.length - 1]; glowDot(p.x, p.y, 0.55 * p.k, col, (1 - ig) * 1.2); }
    });
    // empty slots: mapped → the missed node's own slot breathes ember; gauge → room left shimmers after the lock
    if (P.mapped) {
      P.misses.forEach((m) => {
        if (m.seg === null) return; const k = prog(t, m.t, 420); if (k <= 0) return;
        const [a0, a1] = segA(m.seg), pts = polyArc(c, RING, a0, a1), br = 0.5 + 0.5 * Math.sin((t - m.t) / 520);
        strokePts(ctx, pts, RING_W * pts[0].k * 0.55, rgba(EMBER, 0.25 + 0.25 * br));
        strokePts(gx, pts, RING_W * pts[0].k * 1.4, rgba(EMBER, 0.18 * k * br));
      });
    } else if (t > P.lock) {
      for (let s = P.steps.length; s < total; s++) {
        const [a0, a1] = segA(s), pts = polyArc(c, RING, a0, a1), sh = 0.5 + 0.5 * Math.sin((t - P.lock) / 650 - s * 0.6);
        strokePts(ctx, pts, RING_W * pts[0].k * 0.5, `rgba(43,182,115,${(0.07 + 0.1 * sh).toFixed(3)})`);
      }
    }
    // a comet travels round the ring after the lock
    if (t > P.lock + 600) {
      const ph = ((t - P.lock - 600) % 3600) / 3600, a = -Math.PI / 2 + ph * Math.PI * 2;
      for (let j = 0; j < 14; j++) {
        const aj = a - j * 0.06, p = project(Math.cos(aj) * RING, Math.sin(aj) * RING, 0, c);
        glowDot(p.x, p.y, (0.22 - j * 0.012) * p.k, [130, 190, 30], (1 - j / 14) * 0.8);
      }
    }

    // orbs + beams, depth-sorted
    const order = data.nodes.map((nd, i) => {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / N, sd = orbSeed[i];
      const rise = ease.outCubic(prog(t, sd.rise, 900)), bob = Math.sin(t / 1300 + sd.bob) * 0.06 * rise;
      const wx = Math.cos(ang) * RX, wy = Math.sin(ang) * RY + (1 - rise) * 0.9 + bob, wz = (1 - rise) * 1.4 + Math.sin(t / 1700 + sd.bob) * 0.08;
      return { nd, i, ang, rise, p: project(wx, wy, wz, c), w: { x: wx, y: wy, z: wz } };
    }).sort((a, b) => b.p.z - a.p.z);
    hitTargets.length = 0;
    order.forEach(({ nd, i, ang, rise, p, w }) => {
      const lt = lightOf.get(i), ms = missOf.get(i), tone = TONE_RGB[nd.tone ?? 'g'];
      const lit = lt ? prog(t, lt.t, 380) : 0, miss = ms ? prog(t, ms.t, 450) : 0;
      // beam: arcs out of the plane towards the camera, from the orb to the ring
      const ring = { x: Math.cos(ang) * (RING + 0.22), y: Math.sin(ang) * (RING + 0.22), z: 0 };
      const ctrl = { x: (w.x + ring.x) / 2, y: (w.y + ring.y) / 2, z: -0.9 };
      const bez = (u: number) => project(
        (1 - u) * (1 - u) * w.x + 2 * (1 - u) * u * ctrl.x + u * u * ring.x,
        (1 - u) * (1 - u) * w.y + 2 * (1 - u) * u * ctrl.y + u * u * ring.y,
        (1 - u) * (1 - u) * w.z + 2 * (1 - u) * u * ctrl.z + u * u * ring.z, c);
      const beamPts = Array.from({ length: 22 }, (_, j) => bez(0.12 + (j / 21) * 0.88));
      if (lt && t >= lt.t) {
        const head = ease.inOutSine(prog(t, lt.t, 340)), settle = prog(t, lt.t + 340, 500);
        const shown = beamPts.slice(0, Math.max(2, Math.round(head * beamPts.length)));
        strokePts(ctx, shown, 1.1, rgba(tone, 0.35 + 0.25 * settle));
        strokePts(gx, shown, 3, rgba(tone, 0.5 * (1 - settle) + 0.15));
        if (head < 1) { const hp = shown[shown.length - 1]; glowDot(hp.x, hp.y, 0.3 * hp.k, tone, 1.1); }
        for (let q = 0; q < 3; q++) {                // energy keeps flowing in
          const u = ((t - lt.t) / 1400 + q / 3) % 1, fp = bez(0.12 + u * 0.88);
          glowDot(fp.x, fp.y, 0.09 * fp.k, tone, 0.55 * settle);
        }
      } else if (ms && miss > 0) {
        const fl = 0.55 + 0.45 * Math.sin((t - ms.t) / 90) * Math.sin((t - ms.t) / 37);
        ctx.setLineDash([3, 5]); strokePts(ctx, beamPts, 1, rgba(EMBER, 0.45 * miss * (0.6 + 0.4 * fl))); ctx.setLineDash([]);
      } else {
        ctx.setLineDash([1.5, 5]); strokePts(ctx, beamPts, 1, `rgba(150,170,158,${(0.45 * rise).toFixed(3)})`); ctx.setLineDash([]);
      }

      // orb
      const rad = ORB * p.k * (0.65 + 0.35 * rise) * (lt && lit > 0 && lit < 1 ? 1 + Math.sin(lit * Math.PI) * 0.16 : 1);
      orbAt[i] = rise > 0.5 ? { x: p.x, y: p.y, r: rad } : undefined;
      if (rise <= 0) return;
      ctx.globalAlpha = rise;
      const pre = lt ? prog(t, lt.t - 160, 160) : 0;          // anticipation: a breath before it ignites
      if (lit > 0) glowDot(p.x, p.y, rad * 1.6, tone, 0.14 * lit + (lit < 1 ? Math.sin(lit * Math.PI) * 0.4 : 0));
      if (miss > 0) glowDot(p.x, p.y, rad * 1.9, EMBER, 0.32 * miss * (0.7 + 0.3 * Math.sin((t - ms!.t) / 420)));
      const body = ctx.createRadialGradient(p.x, p.y - rad * 0.15, rad * 0.2, p.x, p.y, rad);   // nearly flat fill
      if (lit > 0) {
        body.addColorStop(0, rgba(tone.map((v) => mix(255, v, 0.07 + 0.05 * lit)) as [number, number, number], 1));
        body.addColorStop(1, rgba(tone.map((v) => mix(255, v, 0.13 + 0.07 * lit)) as [number, number, number], 1));
      } else if (miss > 0) {
        body.addColorStop(0, '#FFF6F5'); body.addColorStop(1, '#FFE9E7');
      } else {
        body.addColorStop(0, '#FBFCFB'); body.addColorStop(1, '#F1F5F2');
      }
      ctx.save(); ctx.shadowColor = 'rgba(23,50,31,.07)'; ctx.shadowBlur = rad * 0.35; ctx.shadowOffsetY = rad * 0.12;
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.lineWidth = Math.max(0.8, rad * 0.07);
      ctx.strokeStyle = lit > 0 ? rgba(tone, 0.45 + 0.4 * lit) : miss > 0 ? rgba(EMBER, 0.45 + 0.3 * miss) : `rgba(196,208,200,${(0.9 + pre * 0.1).toFixed(3)})`;
      ctx.stroke();
      // icon inside the orb
      const img = imgs.get(nd.id);
      if (img) {
        const s2 = rad * 1.22;
        ctx.save(); ctx.globalAlpha = rise * (lit > 0 ? 1 : miss > 0 ? 0.75 : 0.45 + pre * 0.3);
        if (lit <= 0) ctx.filter = miss > 0 ? 'grayscale(1) sepia(1) hue-rotate(-30deg) saturate(3)' : 'grayscale(1)';
        ctx.drawImage(img, p.x - s2 / 2, p.y - s2 / 2, s2, s2); ctx.restore();
      }
      // a faint highlight (kept low: no glassy gloss)
      const hl = ctx.createRadialGradient(p.x - rad * 0.38, p.y - rad * 0.48, 0, p.x - rad * 0.38, p.y - rad * 0.48, rad * 0.55);
      hl.addColorStop(0, `rgba(255,255,255,${(0.12 * rise).toFixed(3)})`); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // ignition ring + sparkles
      if (lt) {
        const ir = prog(t, lt.t, 600);
        if (ir > 0 && ir < 1) {
          ctx.strokeStyle = rgba(tone, (1 - ir) * 0.8); ctx.lineWidth = 2 * (1 - ir) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, rad * (1 + ir * 1.3), 0, Math.PI * 2); ctx.stroke();
          for (let q = 0; q < 8; q++) {
            const a = (q / 8) * Math.PI * 2 + i, rr = rad * (1.1 + ir * 1.6);
            glowDot(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, rad * 0.16 * (1 - ir), q % 2 ? [255, 230, 150] : tone, 1 - ir);
          }
        }
      }
      // ✗ badge on missed
      if (ms) {
        const bp = ease.outBack(prog(t, ms.t + 140, 360));
        const cx = imgs.get('__cross');
        if (bp > 0 && cx) { const bs = rad * 0.42 * bp; ctx.drawImage(cx, p.x + rad * 0.62 - bs, p.y + rad * 0.62 - bs, bs * 2, bs * 2); }
      }
      // label
      const lines = nd.label.split(/<br\s*\/?>/), fs = 13 * Math.min(1.2, p.k / 72);
      ctx.font = `600 ${fs.toFixed(2)}px "Noto Sans Devanagari", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const up = Math.sin(ang) < -0.55, lh = fs * 1.25;
      const y0 = up ? p.y - rad - 8 - (lines.length - 0.5) * lh : p.y + rad + 8 + lh * 0.5;
      ctx.fillStyle = lit > 0 ? `rgba(23,50,31,${(rise * (0.75 + 0.25 * lit)).toFixed(3)})`
        : miss > 0 ? `rgba(180,55,59,${(rise * (0.7 + 0.3 * miss)).toFixed(3)})` : `rgba(42,68,52,${(rise * 0.62).toFixed(3)})`;
      ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 5;
      lines.forEach((ln, j) => ctx.fillText(ln, p.x, y0 + j * lh));
      ctx.shadowBlur = 0;
      hitTargets.push({ x: p.x, y: p.y, r: rad * 1.3, node: nd, missed: !!ms });
    });

    // core: glass disc that fills with light as the score climbs
    const coreIn = ease.outBack(prog(t, BUILD + 500, 700)), cp = project(0, 0, 0, c), cr = CORE * cp.k * mix(0.6, 1, coreIn);
    const v = landed(P, t), energy = v / Math.max(1, total);
    const bp = brainPose(t), home = bp.home;
    if (coreIn > 0) {
      ctx.globalAlpha = clamp(coreIn);
      const cg = ctx.createRadialGradient(cp.x, cp.y - cr * 0.3, cr * 0.1, cp.x, cp.y, cr);
      cg.addColorStop(0, '#FFFFFF');
      cg.addColorStop(0.72, `rgb(${Math.round(mix(243, 236, energy))},${Math.round(mix(251, 250, energy))},${Math.round(mix(247, 238, energy))})`);
      cg.addColorStop(1, '#E3F4EC');
      ctx.save(); ctx.shadowColor = 'rgba(20,82,37,.07)'; ctx.shadowBlur = cr * 0.18; ctx.shadowOffsetY = cr * 0.05;
      ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(cp.x, cp.y, cr, cr * Math.cos(c.pitch) * 0.98 + cr * 0.02, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.strokeStyle = `rgba(43,182,115,${(0.18 + energy * 0.3).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
      glowDot(cp.x, cp.y, cr * 1.1, [40, 214, 160], 0.07 + energy * 0.16);
      ctx.font = `800 ${(cr * 0.27).toFixed(2)}px "Noto Sans Devanagari", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1E7F4F'; ctx.fillText('समजलं', cp.x, cp.y + cr * mix(-0.24, 0.12, home));
      drawDrum(cp.x, cp.y + cr * mix(0.24, 0.52, home), cr * mix(0.5, 0.42, home), t);
      ctx.globalAlpha = 1;
    }
    drawBrain(bp);

    // the lock: flash, shockwave, god rays, anamorphic streak
    if (t >= P.lock - 40) {
      const k = prog(t, P.lock, 1200), rays = ease.outCubic(prog(t, P.lock, 600)) * (1 - prog(t, P.lock + 1800, 1600) * 0.75);
      const lo = brainPose(P.lock), ox = lo.x, oy = lo.y, rx = bx_, ry = by_;   // burst from where it charged; rays travel with it
      ctx.save();
      for (let q = 0; q < 14; q++) {
        const a = (q / 14) * Math.PI * 2 + (t - P.lock) / 5200, w = 0.09 + 0.05 * Math.sin(q * 2.1), len = 300;
        const g = ctx.createRadialGradient(rx, ry, bp.w * 0.45, rx, ry, len);
        g.addColorStop(0, `rgba(169,216,78,${(0.22 * rays).toFixed(3)})`); g.addColorStop(1, 'rgba(169,216,78,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(rx, ry);
        ctx.arc(rx, ry, len, a - w, a + w); ctx.closePath(); ctx.fill();
      }
      if (k > 0 && k < 1) {
        const sw = polyArc(c, RING + 0.15 + ease.outCubic(k) * 2.8, 0, Math.PI * 2, 64);
        strokePts(ctx, sw, (1 - k) * 3 + 0.5, `rgba(43,182,115,${((1 - k) * 0.35).toFixed(3)})`);
        for (let q = 0; q < 2; q++) {                  // the brain's own shockwaves
          const kq = prog(t, P.lock + q * 140, 1100); if (kq <= 0 || kq >= 1) continue;
          const rr = mix(lo.w * 0.5, 300, ease.outCubic(kq));
          ctx.strokeStyle = q ? `rgba(45,127,249,${((1 - kq) * 0.45).toFixed(3)})` : `rgba(30,158,90,${((1 - kq) * 0.65).toFixed(3)})`;
          ctx.lineWidth = (1 - kq) * 6 + 0.5; ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.stroke();
        }
        const fl = 1 - prog(t, P.lock, 320);
        if (fl > 0) { ctx.globalAlpha = fl * 0.4; ctx.drawImage(tint([169, 216, 78]), ox - 210, oy - 210, 420, 420); ctx.globalAlpha = 1; }
        const st = Math.sin(Math.min(1, k * 1.6) * Math.PI);
        const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        sg.addColorStop(0, `rgba(19,168,160,${(0.4 * st).toFixed(3)})`); sg.addColorStop(1, 'rgba(19,168,160,0)');
        ctx.setTransform(S * 230, 0, 0, S * 5, ox * S, oy * S); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
        ctx.setTransform(S, 0, 0, S, 0, 0);
      }
      ctx.restore();
    }

    // burst of leaves and sparks (3D, gravity, drag, depth of field)
    const bt = (t - P.lock) / 1000;
    if (bt > 0 && bt < 3) {
      const full = P.steps.length >= total;
      burst.forEach((b, i) => {
        if (!full && i % 4 === 3) return;
        const tt = bt - b.delay / 1000; if (tt <= 0) return;
        const drag = (1 - Math.exp(-tt * 1.6)) / 1.6, a0 = Math.atan2(b.vy, b.vx);
        const x = Math.cos(a0) * 0.45 + b.vx * drag, y = BURST_Y + Math.sin(a0) * 0.38 + b.vy * drag + 1.1 * tt * tt * 0.5, z = b.vz * drag;
        const p = project(x, y, z, c), life = clamp(1 - tt / 2.6), a = (tt < 0.12 ? tt / 0.12 : 1) * life;
        const blur = Math.abs(p.z - c.dist) / 4, sz = b.size * p.k * (1 + blur * 0.8);
        ctx.save(); ctx.globalAlpha = clamp(a * (1 - blur * 0.25)); ctx.translate(p.x, p.y);
        if (b.leaf) {
          ctx.rotate(b.rot + b.spin * tt); ctx.scale(Math.cos(tt * 6 + i), 1); ctx.fillStyle = rgba(b.col, 1);
          if (blur > 0.6 && high) ctx.filter = `blur(${Math.min(3, blur).toFixed(1)}px)`;
          ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.quadraticCurveTo(0, -sz * 0.75, sz, 0); ctx.quadraticCurveTo(0, sz * 0.75, -sz, 0); ctx.fill();
        } else {
          ctx.drawImage(tint(b.col), -sz, -sz, sz * 2, sz * 2);
        }
        ctx.restore();
      });
    }

    drawDust(true);

    // bloom: the emissive layer, blurred twice and added
    if (high) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${(5 * dpr).toFixed(1)}px)`; ctx.globalAlpha = 0.6; ctx.drawImage(glow, 0, 0, cv.width, cv.height);
      ctx.filter = `blur(${(16 * dpr).toFixed(1)}px)`; ctx.globalAlpha = 0.38; ctx.drawImage(glow, 0, 0, cv.width, cv.height);
      ctx.restore();
    } else {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.45;
      ctx.drawImage(glow, 0, 0, cv.width, cv.height); ctx.restore();
    }
    // vignette
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const vg = ctx.createRadialGradient(SCX, SCY, 170, SCX, SCY, 470);
    vg.addColorStop(0, 'rgba(20,60,35,0)'); vg.addColorStop(1, 'rgba(20,60,35,.05)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, LW, LH);
    // edges melt into the white panel (no seam with the card area below)
    const eb = ctx.createLinearGradient(0, LH - 80, 0, LH); eb.addColorStop(0, 'rgba(255,255,255,0)'); eb.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = eb; ctx.fillRect(0, LH - 80, LW, 80);
    const et = ctx.createLinearGradient(0, 0, 0, 36); et.addColorStop(0, '#FFFFFF'); et.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = et; ctx.fillRect(0, 0, LW, 36);

    // frosted card (DOM): rises after the lock, its number rolls down to what is left to tell
    const ck = ease.outCubic(prog(t, P.card + 200, 800));
    card.style.opacity = String(ck); card.style.transform = `translateY(${((1 - ck) * 28).toFixed(1)}px)`;
    if (roll) roll.textContent = digits(Math.round(mix(total, missedCount, ease.outQuint(prog(t, P.card + 500, 1000)))), opts.numerals);
    isReady = t >= P.card;

    if (fx) {
      const pos = reelPos(P, t), cell = Math.floor(pos), speed = Math.abs(pos - reelPos(P, t - 16)) * 60;
      if (cell !== fx.lastCell) { if (speed > 1 && fx.sound) fx.snd.tick(); fx.lastCell = cell; }
      if (v > fx.lastV) { if (fx.sound) fx.snd.land(v); haptic('land'); }
      fx.lastV = v;
      P.misses.forEach((m) => { if (!fx.missDone.has(m.ni) && t >= m.t) { fx.missDone.add(m.ni); if (fx.sound) fx.snd.miss(); } });
      if (!fx.locked && t >= P.lock) { fx.locked = true; if (fx.sound) fx.snd.chime(); haptic('lock'); }
    }

    // -- helpers that need the frame state
    function glowDot(x: number, y: number, r: number, col: [number, number, number], a: number) {
      if (a <= 0 || r <= 0) return;
      gx.globalCompositeOperation = 'lighter'; gx.globalAlpha = clamp(a); gx.drawImage(tint(col), x - r, y - r, r * 2, r * 2);
      gx.globalAlpha = 1; gx.globalCompositeOperation = 'source-over';
    }
    // the brain: pops out big and empty, takes in every told item (fills from the bottom up, gulps, synapses fire),
    // then settles into its place in the core once the blast has gone off
    // Sathi's brain. Alone on the panel at first, faintly coloured; it rises above the ring as the world builds;
    // every told item streams in and adds power – it fills, its aura and heartbeat grow, orbits of energy appear,
    // it crackles; at the lock it charges, fires the celebration and settles into the centre of the ring.
    function drawBrain(bp: BrainPose) {
      const eF = imgs.get('__brainE'), fF = imgs.get('__brainF'); if (!eF || !fF) return;
      const up = 1 - bp.home;
      let power = 0;
      P.steps.forEach((st) => { power += ease.outCubic(prog(t, st.t + 80 + st.spinDur * 0.5, 520)); });
      power /= Math.max(1, total);
      let gulp = 0;
      arrivals.forEach((ta) => { const g = prog(t, ta, 320); if (g > 0 && g < 1) gulp += Math.sin(g * Math.PI) * 0.08; });
      gulp = Math.min(gulp, 0.14);
      const ch = ease.inOutSine(prog(t, P.lock - 600, 600)) * (1 - prog(t, P.lock, 160));        // charging, just before the lock
      const bl = prog(t, P.lock, 560), blast = bl > 0 && bl < 1 ? Math.sin(bl * Math.PI) * 0.24 : 0;
      const sq = prog(t, BRAIN_LAND - 80, 380), squash = sq > 0 && sq < 1 ? Math.sin(sq * Math.PI) : 0;
      let beatPh = t / 560;                                                                        // a heartbeat that quickens
      P.steps.forEach((st) => { beatPh += (1 / 240 - 1 / 560) * rampArea(t, st.t + 80 + st.spinDur * 0.5, 520) / Math.max(1, total); });
      const beat = Math.sin(beatPh) * 0.022 * (0.35 + power) * up;
      const grow = 1 + 0.12 * power * up + gulp + blast + ch * 0.13 + beat;
      const bw = bp.w * grow * (1 + squash * 0.12), bh = bp.w * grow * (1 - squash * 0.1) * BRAIN_H / BRAIN_W;
      const jit = ch * 1.5;
      const bx = bp.x + Math.sin(t / 1300) * bp.w * 0.02 * up + Math.sin(t * 0.11) * jit;
      const by = bp.y + Math.sin(t / 760) * bp.w * 0.025 * up + squash * bh * 0.05 + Math.cos(t * 0.13) * jit;
      const rot = Math.sin(t / 1500) * 0.05 * up;
      bx_ = bx; by_ = by; cx_ = bp.cx; cy_ = bp.cy;
      // presence: faint and alone on the first frame, firmer as the world builds, more solid with every told item,
      // fully solid once it is charged and celebrating
      const firm = clamp(mix(0.4, 0.6, ease.inOutSine(prog(t, BUILD, 1400))) + power * 0.4 + ch);
      const fade = mix(firm, 1, prog(t, P.lock, 300));
      // aura: faint at first, stronger with every told item, blazing while it charges
      glowDot(bx, by, bw * (0.8 + 0.45 * power + 0.25 * ch), [40, 214, 160],
        fade * (0.14 + 0.45 * power + 0.05 * Math.sin(t / 600)) * (0.55 + 0.45 * up) + gulp * 2.2 + ch * 0.35 + blast * 0.9);
      if (power > 0.4 || ch > 0) glowDot(bx, by, bw * (0.6 + 0.2 * ch), [130, 190, 30], (power - 0.4) * 0.4 * up + ch * 0.25);
      // power-up: each arrival sends a ring out of the brain in the colour of what was told
      arrivals.forEach((ta, k) => {
        const g = prog(t, ta, 600); if (g <= 0 || g >= 1) return;
        const tone = TONE_RGB[data.nodes[P.lights[k].ni].tone ?? 'g'], e = ease.outCubic(g);
        ctx.strokeStyle = rgba(tone, (1 - g) * 0.65); ctx.lineWidth = 2.8 * (1 - g) + 0.5;
        ctx.beginPath(); ctx.ellipse(bx, by, bw * (0.55 + 0.55 * e), bh * (0.55 + 0.55 * e), 0, 0, Math.PI * 2); ctx.stroke();
      });
      orbits(bx, by, bw, power, ch, up, false);
      // landing ripple in the core
      const rp = prog(t, BRAIN_LAND - 40, 620);
      if (rp > 0 && rp < 1) {
        ctx.strokeStyle = `rgba(43,182,115,${((1 - rp) * 0.55).toFixed(3)})`; ctx.lineWidth = 2.2 * (1 - rp) + 0.4;
        ctx.beginPath(); ctx.ellipse(bp.cx, bp.homeY + bp.homeW * 0.3, bp.cr * (0.3 + rp * 0.65), bp.cr * (0.3 + rp * 0.65) * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.save(); ctx.translate(bx, by); ctx.rotate(rot);
      ctx.shadowColor = `rgba(20,82,37,${(0.14 + 0.12 * up * bp.lift).toFixed(3)})`; ctx.shadowBlur = bw * (0.08 + 0.12 * up); ctx.shadowOffsetY = bw * (0.03 + 0.1 * up * bp.lift);
      ctx.globalAlpha = fade;
      ctx.drawImage(eF, -bw / 2, -bh / 2, bw, bh);
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = fade * (0.3 + 0.12 * Math.sin(t / 700) * (1 - power));                  // the faint colour it starts with
      ctx.drawImage(fF, -bw / 2, -bh / 2, bw, bh);
      ctx.globalAlpha = fade;
      ctx.scale(bw / BRAIN_W, bh / BRAIN_H); ctx.translate(-BRAIN_W / 2, -BRAIN_H / 2);
      const lvl = mix(99, -3, power), amp = (power < 0.995 ? 1.8 : 0) + gulp * 24;
      const wave = (x: number) => lvl + Math.sin(x / 11 + t / 240) * amp + Math.sin(x / 5.3 - t / 410) * amp * 0.35;
      if (power > 0) {                               // what has been understood so far, in full colour
        ctx.save(); ctx.beginPath(); ctx.moveTo(0, BRAIN_H + 2);
        for (let x = 0; x <= BRAIN_W; x += 4) ctx.lineTo(x, wave(x));
        ctx.lineTo(BRAIN_W, BRAIN_H + 2); ctx.closePath(); ctx.clip();
        ctx.drawImage(fF, 0, 0, BRAIN_W, BRAIN_H); ctx.restore();
        if (power < 0.995) {
          ctx.save(); ctx.clip(brainPath); ctx.beginPath();
          for (let x = 0; x <= BRAIN_W; x += 4) { if (x) ctx.lineTo(x, wave(x)); else ctx.moveTo(x, wave(x)); }
          ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
          ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(170,255,220,.3)'; ctx.stroke(); ctx.restore();
        }
      }
      // while it charges, light runs through the whole brain
      if (ch > 0) { ctx.save(); ctx.clip(brainPath); ctx.globalAlpha = ch * 0.22; ctx.fillStyle = '#EFFFF6'; ctx.fillRect(0, 0, BRAIN_W, BRAIN_H); ctx.restore(); }
      // synapses: each arrival fires three, linked; the blast fires them all; a soft twinkle once it has landed
      const fire: [number, number, number][] = [];
      arrivals.forEach((ta, k) => { for (let j = 0; j < 3; j++) { const g = prog(t, ta + j * 70, 460); if (g > 0 && g < 1) fire.push([(k * 5 + j * 3) % BRAIN_SPARKS.length, 1 - g, k]); } });
      if (ch > 0.3) BRAIN_SPARKS.forEach((_, q) => { if ((q + Math.floor(t / 90)) % 3 === 0) fire.push([q, ch, -3]); });
      if (bl > 0 && bl < 1) BRAIN_SPARKS.forEach((_, q) => fire.push([q, 1 - bl, -1]));
      if (bp.home > 0.95) { const q = Math.floor(t / 520) % BRAIN_SPARKS.length, g = (t % 520) / 520; if (BRAIN_SPARKS[q][1] > lvl) fire.push([q, Math.sin(g * Math.PI) * 0.6, -2]); }
      ctx.lineCap = 'round';
      for (let f = 1; f < fire.length; f++) {
        if (fire[f][2] !== fire[f - 1][2]) continue;
        const a = BRAIN_SPARKS[fire[f - 1][0]], b = BRAIN_SPARKS[fire[f][0]];
        ctx.strokeStyle = `rgba(255,255,255,${(0.75 * Math.min(fire[f][1], fire[f - 1][1])).toFixed(3)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      fire.forEach(([q, a]) => {
        const [sx, sy] = BRAIN_SPARKS[q];
        ctx.fillStyle = `rgba(255,255,255,${clamp(a).toFixed(3)})`; ctx.beginPath(); ctx.arc(sx, sy, 2.8 * (0.6 + 0.4 * a), 0, Math.PI * 2); ctx.fill();
        glowDot(bx + (sx - BRAIN_W / 2) * bw / BRAIN_W, by + (sy - BRAIN_H / 2) * bh / BRAIN_H, bw * 0.1, sx < BRAIN_W / 2 ? [60, 220, 140] : [90, 160, 255], a);
      });
      ctx.restore();
      orbits(bx, by, bw, power, ch, up, true);
      crackle(bx, by, bw, bh, power, ch, up);
      // the descent: a trail of light as it settles into the centre
      if (bp.home > 0 && bp.home < 1) {
        for (let j = 1; j <= 8; j++) { const q = brainPose(t - j * 38); glowDot(q.x, q.y, bw * 0.16 * (1 - j / 9), [169, 216, 78], (1 - j / 9) * 0.8); }
      }
      drawFeed();
    }
    // orbits of energy round the brain – one more appears as the power builds (green, teal, blue); back halves are
    // drawn behind the brain and front halves in front, so they wrap round it
    function orbits(bx: number, by: number, bw: number, power: number, ch: number, up: number, front: boolean) {
      const cols: [number, number, number][] = [[30, 158, 90], [19, 168, 160], [45, 127, 249]];
      for (let r = 0; r < 3; r++) {
        const va = clamp(clamp((power - (0.12 + r * 0.26)) * 4) * (0.35 + 0.65 * up) + ch * 0.7); if (va <= 0) continue;
        const a = bw * (0.64 + r * 0.09), b = a * 0.27, tilt = [-0.42, 0.36, 0.04][r] + Math.sin(t / 2600 + r * 2) * 0.12;
        const ct = Math.cos(tilt), st = Math.sin(tilt);
        const pt = (th: number): [number, number] => { const ex = Math.cos(th) * a, ey = Math.sin(th) * b; return [bx + ex * ct - ey * st, by + ex * st + ey * ct]; };
        ctx.beginPath(); let on = false;
        for (let i = 0; i <= 48; i++) {
          const th = (i / 48) * Math.PI * 2;
          if ((Math.sin(th) > 0) !== front) { on = false; continue; }
          const [x, y] = pt(th); if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; }
        }
        ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(cols[r], va * (front ? 0.8 : 0.35)); ctx.stroke();
        const th = (t + 2.5 * chargeArea(t)) / (820 - r * 140) + r * 2.1;     // the spark riding the orbit
        if ((Math.sin(th) > 0) === front) {
          const [x, y] = pt(th); glowDot(x, y, bw * 0.08, cols[r], va);
          ctx.fillStyle = `rgba(255,255,255,${va.toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 1.9, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // electric crackle at the rim once it is powerful, wild while it charges
    function crackle(bx: number, by: number, bw: number, bh: number, power: number, ch: number, up: number) {
      if (!high) return;
      ctx.save();
      const n = Math.floor((power > 0.45 ? (power - 0.45) * 5 : 0) * up + ch * 5);
      const slot = Math.floor(t / 110), ph = (t % 110) / 110;
      for (let q = 0; q < n; q++) {
        const h = (x: number) => { const v = Math.sin(slot * 7.13 + q * 13.7 + x * 3.1) * 43758.5453; return v - Math.floor(v); };
        const a = h(1) * Math.PI * 2, len = bw * (0.16 + h(2) * 0.16);
        let x = bx + Math.cos(a) * bw * 0.47, y = by + Math.sin(a) * bh * 0.47;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 1; k <= 4; k++) { const j = (h(3 + k) - 0.5) * 1.1; x += Math.cos(a + j) * len / 4; y += Math.sin(a + j) * len / 4; ctx.lineTo(x, y); }
        const al = (1 - ph) * 0.9;
        ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = `rgba(19,168,160,${(al * 0.7).toFixed(3)})`; ctx.stroke();
        ctx.lineWidth = 0.8; ctx.strokeStyle = `rgba(255,255,255,${al.toFixed(3)})`; ctx.stroke();
        glowDot(x, y, bw * 0.07, [40, 214, 160], al);
      }
      ctx.restore();
    }
    // packets of what the farmer told: stream out of the orb, arc round the ring (never across the number) and get
    // pulled into the brain
    function drawFeed() {
      if (t > P.lock + FEED_MS) return;
      P.lights.forEach((l, k) => {
        const o = orbAt[l.ni]; if (!o) return;
        const tone = TONE_RGB[data.nodes[l.ni].tone ?? 'g'];
        feed[k].forEach((pk) => { const u = prog(t, l.t + 120 + pk.d, FEED_MS); if (u > 0 && u < 1) packet(o, u, pk.bend, pk.sz, pk.chip, tone); });
        for (let q = 0; q < (high ? 3 : 1); q++) {   // the trickle: the orb keeps feeding until the lock
          const start = l.t + 1000 + q * 380, period = 1150; if (t < start) continue;
          const ph = (t - start) % period, cyc = t - ph; if (cyc > P.lock - FEED_MS) continue;
          const u = ph / FEED_MS; if (u < 1) packet(o, u, (q - 1) * 0.35, 0.7, q === 1, tone);
        }
      });
    }
    function packet(o: { x: number; y: number; r: number }, u: number, bend: number, sz: number, chip: boolean, tone: [number, number, number]) {
      // control point out on the far side of the ring, half-way (by angle) between the orb and the brain
      const aO = Math.atan2(o.y - cy_, o.x - cx_), aB = Math.atan2(by_ - cy_, bx_ - cx_);
      let da = aB - aO; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(Math.abs(da) - Math.PI) < 0.35) da = (bend >= 0 ? 1 : -1) * Math.abs(da);   // straight below: split both ways
      const aM = aO + da / 2 + bend * 0.12, R = Math.max(Math.hypot(o.x - cx_, o.y - cy_), Math.hypot(bx_ - cx_, by_ - cy_)) * (1.08 + Math.abs(bend) * 0.12);
      const kx = cx_ + Math.cos(aM) * R, ky = cy_ + Math.sin(aM) * R;
      const at = (e: number) => { const m = 1 - e; return [m * m * o.x + 2 * m * e * kx + e * e * bx_, m * m * o.y + 2 * m * e * ky + e * e * by_]; };
      const e = Math.pow(u, 1.3), [x, y] = at(e), a = Math.min(1, u * 6) * (u > 0.8 ? (1 - u) / 0.2 : 1);
      const s = (2.3 + 1.7 * Math.sin(u * Math.PI)) * sz * (u > 0.8 ? 0.45 + 0.55 * (1 - u) / 0.2 : 1);
      for (let j = 1; j <= 6; j++) {                 // comet trail
        const [tx, ty] = at(Math.max(0, e - j * 0.03));
        ctx.fillStyle = rgba(tone, a * 0.4 * (1 - j / 7)); ctx.beginPath(); ctx.arc(tx, ty, s * (1 - j * 0.12), 0, Math.PI * 2); ctx.fill();
      }
      glowDot(x, y, s * 3.6, tone, a * 0.9);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
      if (chip) {                                    // a little card of information
        const [px, py] = at(Math.max(0, e - 0.02)); ctx.rotate(Math.atan2(y - py, x - px));
        ctx.fillStyle = rgba(tone, 1); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-s * 1.4, -s * 0.9, s * 2.8, s * 1.8, s * 0.5); else ctx.rect(-s * 1.4, -s * 0.9, s * 2.8, s * 1.8);   // roundRect: Chrome 99+
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(-s * 0.9, -s * 0.42, s * 1.8, s * 0.32); ctx.fillRect(-s * 0.9, s * 0.1, s * 1.1, s * 0.32);
      } else {
        ctx.fillStyle = rgba(tone, 1); ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(0, 0, s * 0.48, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    function drawDrum(x: number, y: number, size: number, tt: number) {
      const pos = reelPos(P, tt), samples = Math.min(6, 1 + Math.floor(Math.abs(pos - reelPos(P, tt - 16)) * 1.2));
      const lockK = prog(tt, P.lock, 520), pop = 1 + Math.sin(lockK * Math.PI) * 0.18, fs = size * 1.25 * pop;
      const tens = P.steps.length >= 10 ? ease.outCubic(prog(tt, P.steps[9].t + 80 + P.steps[9].spinDur * 0.55, 300)) : 0;
      const ofText = ` / ${digits(total, opts.numerals)}`, ofK = ease.outCubic(prog(tt, P.lock, 600));
      ctx.font = `800 ${fs.toFixed(2)}px "Noto Sans Devanagari", sans-serif`;
      const ofW = ctx.measureText(ofText).width, dW = fs * 0.62, tW = dW * tens, wTot = tW + dW + ofW * ofK, x0 = x - wTot / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0 - 4, y - fs * 0.62, tW + dW + 8, fs * 1.24); ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const idle = !P.steps.length || tt < P.steps[0].t + 80;
      if (idle) { ctx.fillStyle = 'rgba(31,79,168,.45)'; ctx.fillText('–', x0 + tW + dW / 2, y); }
      for (let s = 0; s < (idle ? 0 : samples); s++) {             // temporal motion blur
        const ps = reelPos(P, tt - (s * 16) / samples);
        for (let cell = Math.floor(ps) - 2; cell <= Math.floor(ps) + 2; cell++) {
          const th = (cell - ps) * 0.9; if (Math.abs(th) > 1.45 || cell < 0) continue;
          const yy = y + Math.sin(th) * fs * 0.95, sc = Math.cos(th);
          ctx.save(); ctx.globalAlpha = (sc * sc) / samples; ctx.translate(x0 + tW + dW / 2, yy); ctx.scale(1, sc);
          ctx.fillStyle = '#1F4FA8'; ctx.shadowColor = 'rgba(130,190,30,.5)'; ctx.shadowBlur = 8 * (0.3 + lockK * 0.7);
          ctx.fillText(cell === 0 ? '–' : digits(((cell % 10) + 10) % 10, opts.numerals), 0, 0); ctx.restore();
        }
      }
      if (tens > 0) { ctx.globalAlpha = tens; ctx.fillStyle = '#1F4FA8'; ctx.fillText(digits(1, opts.numerals), x0 + tW / 2, y + (1 - tens) * fs); }
      ctx.restore();
      if (ofK > 0) {
        ctx.save(); ctx.globalAlpha *= ofK; ctx.textAlign = 'left'; ctx.fillStyle = '#1F4FA8';
        ctx.fillText(ofText, x0 + tW + dW + (1 - ofK) * fs * 0.35, y); ctx.restore();
      }
      // drum glass edges: darker top and bottom
      const eg = ctx.createLinearGradient(0, y - fs * 0.62, 0, y + fs * 0.62);
      eg.addColorStop(0, 'rgba(244,251,247,.95)'); eg.addColorStop(0.3, 'rgba(244,251,247,0)'); eg.addColorStop(0.7, 'rgba(244,251,247,0)'); eg.addColorStop(1, 'rgba(244,251,247,.95)');
      ctx.fillStyle = eg; ctx.fillRect(x0 - 4, y - fs * 0.62, tW + dW + 8, fs * 1.24);
      if (tt >= P.lock) glowDot(x0 + tW + dW / 2, y, fs * 0.9, [130, 190, 30], 0.35 * (1 - prog(tt, P.lock, 1600)) + 0.1);
    }
  }

  // tinted copies of the soft sprite (cached per colour)
  const tints = new Map<string, HTMLCanvasElement>();
  function tint(col: [number, number, number]) {
    const key = col.join(','); let c = tints.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!; g.drawImage(bokehSprite, 0, 0, 64, 64);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = `rgb(${key})`; g.fillRect(0, 0, 64, 64);
      tints.set(key, c);
    }
    return c;
  }
  function haptic(kind: HapticKind) {
    if (typeof opts.haptics === 'function') opts.haptics(kind);
    else if (opts.haptics && navigator.vibrate) navigator.vibrate(kind === 'lock' ? [10, 60, 18] : 12);
  }

  // ---- taps on missed orbs show a spoken example
  const hitTargets: { x: number; y: number; r: number; node: CineNode; missed: boolean }[] = [];
  let isReady = false, hintTimer = 0;
  const onTap = (e: PointerEvent) => {
    if (!isReady) return;
    const b = cv.getBoundingClientRect(), x = (e.clientX - b.left) / scale, y = (e.clientY - b.top) / scale;
    const hit = hitTargets.find((h) => h.missed && Math.hypot(h.x - x, h.y - y) < h.r);
    if (!hit || !hit.node.hint) return;
    hint.innerHTML = `<b>हे सांगायचं राहिलं</b><span>${hit.node.hint}</span>`;
    hint.style.left = `${(hit.x / LW) * 100}%`; hint.style.top = `${(hit.y / LH) * 100}%`;
    hint.classList.remove('show'); void hint.offsetWidth; hint.classList.add('show');
    window.clearTimeout(hintTimer); hintTimer = window.setTimeout(() => hint.classList.remove('show'), 2600);
    opts.onMissedTap?.(hit.node);
  };
  cv.addEventListener('pointerup', onTap);

  // ---- playback
  interface Fx { sound: boolean; snd: ReturnType<typeof makeSound>; lastCell: number; lastV: number; missDone: Set<number>; locked: boolean }
  let raf = 0, t0 = 0, fx: Fx | null = null;
  const snd = makeSound();
  const reduce = !opts.ignoreReducedMotion && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let alive = true, loaded = false, warned = false;
  void ready.then(() => { loaded = true; });
  const loop = (now: number) => {
    if (!alive) return;
    const t = now - t0;
    try { frame(t, fx); } catch (e) { if (!warned) { warned = true; console.error(e); } }
    if (t < P.duration + 8000) raf = requestAnimationFrame(loop);    // a few seconds of ambient motion, then hold
  };
  const handle: CineHandle = {
    ready,
    duration: P.duration,
    seek: (ms) => { if (loaded) frame(ms, null); else void ready.then(() => { if (alive) frame(ms, null); }); },
    play: () => {
      cancelAnimationFrame(raf);
      void ready.then(() => {
        if (!alive) return;
        if (reduce) { frame(P.duration, null); return; }
        fx = { sound: opts.sound, snd, lastCell: 0, lastV: 0, missDone: new Set(), locked: false };
        if (opts.sound) snd.unlock();
        t0 = performance.now(); raf = requestAnimationFrame(loop);
      });
    },
    setSound: (on) => { opts.sound = on; if (fx) fx.sound = on; if (on) snd.unlock(); },
    destroy: () => {
      alive = false; snd.close();
      cancelAnimationFrame(raf); window.clearTimeout(hintTimer); ro?.disconnect(); cv.removeEventListener('pointerup', onTap);
      container.innerHTML = ''; container.classList.remove('ssc');
    },
  };
  void ready.then(() => { if (alive) frame(0, null); });
  if (opts.autoplay) handle.play();
  return handle;
}
