/* Shram Safal – "मला किती समजलं" reward animation engine (framework-free, no dependencies).
 *
 * Every frame is a pure function of time: frame(t) draws the exact state at t ms. The React wrapper, the demo
 * page and the MP4 recorder all use this same file, so they always show the same motion.
 *
 * Sequence: ring and resting nodes appear → the told categories light up one by one (dotted line flows in,
 * sparkle) while the ring fills one segment per point and the score reel spins a full turn and lands on the
 * next number – a casino roll, the last one spins longest → missed categories turn soft coral with a ✗ →
 * the score locks with a glow, leaves burst and the reward card rises.
 *
 * Ring modes: 'gauge' (default for the app) fills `score` segments from the top, independent of which nodes
 * were told – right for the server's /10. 'mapped' ties node i to segment i (needs nodes.length === total and
 * told count === score), so a missed node leaves its own segment empty.
 */
import { ICONS, type IconName } from './icons';
import { makeSound } from './sound';
import { defaultMessage, digits, type MessageFn, type Numerals } from './messages';
import type { NodeState, Tone } from './categories';
import { ease, FLAT_PACING, landed, mix, plan, prog, reelPos, rng } from './timeline';

export interface RingNode { id: string; label: string; state: NodeState; tone?: Tone; hint?: string; /** an IconName or raw SVG markup */ icon?: IconName | string }
export interface RingData { nodes: RingNode[]; score: number; total: number }
export type HapticKind = 'land' | 'lock';
export interface RingOptions {
  numerals?: Numerals;
  ringMode?: 'gauge' | 'mapped';
  sound?: boolean;
  /** true = navigator.vibrate; or pass the app's own (e.g. hapticFeedback from shared/utils/haptics.ts) */
  haptics?: boolean | ((kind: HapticKind) => void);
  autoplay?: boolean;
  ignoreReducedMotion?: boolean;
  message?: MessageFn;
  onMissedTap?: (node: RingNode) => void;
}
export interface RingHandle { play(): void; seek(ms: number): void; readonly duration: number; setSound(on: boolean): void; destroy(): void }

// ---------------------------------------------------------------- stage geometry (scaled to the container)
const W = 440, H = 520, CX = 220, CY = 262, RX = 150, RY = 190;
const RING_R = 76, RING_W = 13, GAP_DEG = 5, NODE_R = 27, CELL_EM = 1.25;
const SVG_NS = 'http://www.w3.org/2000/svg';

function nodeXY(i: number, n: number) {
  const a = (-90 + (i * 360) / n) * (Math.PI / 180);
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
}
function arcPath(r: number, a0: number, a1: number): string {
  const x0 = CX + r * Math.cos(a0), y0 = CY + r * Math.sin(a0), x1 = CX + r * Math.cos(a1), y1 = CY + r * Math.sin(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function segAngles(s: number, n: number): [number, number] {
  const span = 360 / n, a0 = -90 + s * span - span / 2 + GAP_DEG / 2;
  return [(a0 * Math.PI) / 180, ((a0 + span - GAP_DEG) * Math.PI) / 180];
}
/** the app's ramp: green (23,163,74) → teal → blue (30,86,230) */
function segColor(s: number, n: number): string {
  const k = s / Math.max(1, n - 1), c0 = [23, 163, 74], c1 = [19, 168, 160], c2 = [30, 86, 230];
  const [a, b, kk] = k < 0.5 ? [c0, c1, k * 2] : [c1, c2, (k - 0.5) * 2];
  return `rgb(${a.map((v, i) => Math.round(mix(v, b[i], kk))).join(',')})`;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; return e;
}
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

// ---------------------------------------------------------------- mount
interface NodeEl { btn: HTMLButtonElement; label: HTMLDivElement; badge: HTMLSpanElement; sparks: HTMLSpanElement[]; x: number; y: number;
                   link: SVGLineElement; linkX: SVGGElement }

export function mountUnderstandingRing(container: HTMLElement, data: RingData, options: RingOptions = {}): RingHandle {
  const opts: Required<Omit<RingOptions, 'onMissedTap' | 'message'>> & Pick<RingOptions, 'onMissedTap' | 'message'> = {
    numerals: 'deva', ringMode: 'gauge', sound: false, haptics: true, autoplay: true, ignoreReducedMotion: false, ...options,
  };
  const n = data.nodes.length, total = data.total, P = plan(data.nodes, data.score, data.total, opts.ringMode, FLAT_PACING);
  const missedCount = data.nodes.filter((nd) => nd.state === 'missed').length;
  const [title, sub] = (opts.message ?? defaultMessage)(P.steps.length, total, missedCount);

  container.innerHTML = '';
  container.classList.add('ssu');
  const stage = el('div', 'ssu-stage'); container.appendChild(stage);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ssu-svg' });
  svg.innerHTML = '<defs><radialGradient id="ssuGlow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#FFFFFF"/>' +
    '<stop offset=".75" stop-color="#F3FBF7"/><stop offset="1" stop-color="#E3F4EC"/></radialGradient></defs>';
  stage.appendChild(svg);

  // connectors, ring, pulse, core
  const gLinks = svgEl('g'); svg.appendChild(gLinks);
  const nodes: NodeEl[] = data.nodes.map((nd, i) => {
    const p = nodeXY(i, n), dx = CX - p.x, dy = CY - p.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const x0 = p.x + ux * (NODE_R + 6), y0 = p.y + uy * (NODE_R + 6);
    const x1 = CX - ux * (RING_R + RING_W / 2 + 7), y1 = CY - uy * (RING_R + RING_W / 2 + 7);
    const link = svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'ssu-link' }); gLinks.appendChild(link);
    const xo = svgEl('g', { transform: `translate(${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)})` });
    const linkX = svgEl('g', { class: 'ssu-linkx' });
    linkX.innerHTML = '<circle r="8" fill="#fff"/><path d="M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5"/>';
    xo.appendChild(linkX); gLinks.appendChild(xo);

    const tone = nd.tone ?? 'g';
    const btn = el('button', `ssu-node tone-${tone}`); btn.type = 'button';
    btn.style.left = `${(p.x / W) * 100}%`; btn.style.top = `${(p.y / H) * 100}%`;
    const iconSvg = nd.icon && nd.icon in ICONS ? ICONS[nd.icon as IconName] : (nd.icon ?? '');
    btn.innerHTML = `<span class="ssu-node-icon">${iconSvg}</span><span class="ssu-node-badge">${ICONS.cross}</span>`;
    btn.setAttribute('aria-label', nd.label.replace(/<br\s*\/?>/g, ' '));
    const label = el('div', `ssu-label${p.y < CY - 100 ? ' up' : ''}`);
    label.innerHTML = nd.label; label.style.left = btn.style.left; label.style.top = btn.style.top;
    const sparks = Array.from({ length: 7 }, () => { const s = el('span', `ssu-spark tone-${tone}`); stage.appendChild(s); return s; });
    stage.appendChild(btn); stage.appendChild(label);
    const node: NodeEl = { btn, label, badge: btn.querySelector('.ssu-node-badge') as HTMLSpanElement, sparks, x: p.x, y: p.y, link, linkX };
    if (nd.state === 'missed') btn.addEventListener('click', () => { if (ready) { showHint(node, nd); opts.onMissedTap?.(nd); } });
    return node;
  });
  const halo = svgEl('circle', { cx: CX, cy: CY, r: RING_R + 22, class: 'ssu-halo' }); svg.appendChild(halo);
  const segTrack: SVGPathElement[] = [], segFill: { el: SVGPathElement; a0: number; a1: number }[] = [];
  for (let s = 0; s < total; s++) {
    const [a0, a1] = segAngles(s, total);
    const tr = svgEl('path', { d: arcPath(RING_R, a0, a1), class: 'ssu-seg-track', 'stroke-width': RING_W });
    const fl = svgEl('path', { class: 'ssu-seg-fill', 'stroke-width': RING_W, stroke: segColor(s, total) });
    svg.appendChild(tr); svg.appendChild(fl); segTrack.push(tr); segFill.push({ el: fl, a0, a1 });
  }
  const pulse = svgEl('circle', { cx: CX, cy: CY, r: RING_R, class: 'ssu-pulse' }); svg.appendChild(pulse);
  const core = svgEl('circle', { cx: CX, cy: CY, r: RING_R - RING_W / 2 - 6, fill: 'url(#ssuGlow)', class: 'ssu-core' }); svg.appendChild(core);

  // centre: word + rolling score
  const center = el('div', 'ssu-center'); stage.appendChild(center);
  const cells = Array.from({ length: 40 }, (_, c) => `<span>${digits(c % 10, opts.numerals)}</span>`).join('');
  center.innerHTML = `<div class="ssu-brain">${ICONS.understand}</div><div class="ssu-word">समजलं</div>` +
    `<div class="ssu-score"><span class="ssu-reel ssu-reel-t"><span class="ssu-strip"><span></span><span>${digits(1, opts.numerals)}</span></span></span>` +
    `<span class="ssu-reel ssu-reel-u"><span class="ssu-strip">${cells}</span></span><span class="ssu-of">&nbsp;/&nbsp;${digits(total, opts.numerals)}</span></div>`;
  const [stripT, stripU] = Array.from(center.querySelectorAll<HTMLSpanElement>('.ssu-strip'));
  const reelT = center.querySelector<HTMLSpanElement>('.ssu-reel-t')!, score = center.querySelector<HTMLDivElement>('.ssu-score')!;
  const brain = center.querySelector<HTMLDivElement>('.ssu-brain')!;
  const ofEl = center.querySelector<HTMLSpanElement>('.ssu-of')!;

  // leaves, card, hint
  const leafLayer = el('div', 'ssu-leaves'); stage.appendChild(leafLayer);
  const r = rng(7), colors = ['#2BB673', '#82BE1E', '#13B5B1', '#1E9E5A', '#A9D84E', '#2D7FF9'];
  const leaves = Array.from({ length: 44 }, (_, l) => {
    const lf = el('span', 'ssu-leaf'); lf.innerHTML = ICONS.leaf; lf.style.color = colors[l % colors.length]; leafLayer.appendChild(lf);
    return { el: lf, a: r() * Math.PI * 2, v: 120 + r() * 170, spin: (r() - 0.5) * 540, size: 13 + r() * 13, delay: r() * 220 };
  });
  const card = el('div', 'ssu-card');
  card.innerHTML = `<div class="ssu-card-icon">${ICONS.sprout}</div><div class="ssu-card-text"><b class="ssu-card-title"></b><span class="ssu-card-sub"></span></div>`;
  (card.querySelector('.ssu-card-title') as HTMLElement).textContent = title;
  (card.querySelector('.ssu-card-sub') as HTMLElement).innerHTML = sub.replace('{n}', '<b class="ssu-roll"></b>');
  const roll = card.querySelector<HTMLElement>('.ssu-roll');
  container.appendChild(card);
  const hint = el('div', 'ssu-hint'); stage.appendChild(hint);
  let hintTimer = 0, ready = false;
  function showHint(node: NodeEl, nd: RingNode) {
    if (!nd.hint) return;
    hint.innerHTML = `<b>हे सांगायचं राहिलं</b><span>${nd.hint}</span>`;
    hint.style.left = node.btn.style.left; hint.style.top = node.btn.style.top;
    hint.classList.remove('show'); void hint.offsetWidth; hint.classList.add('show');
    window.clearTimeout(hintTimer); hintTimer = window.setTimeout(() => hint.classList.remove('show'), 2600);
  }

  const lightOf = new Map(P.lights.map((l) => [l.ni, l])), missOf = new Map(P.misses.map((m) => [m.ni, m]));

  // ---------------------------------------------------------------- draw one frame
  function frame(t: number, fx: Fx | null) {
    for (let s = 0; s < total; s++) {
      const a = ease.outCubic(prog(t, 700 + s * 45, 380));
      segTrack[s].style.opacity = String(a); segTrack[s].style.transform = `scale(${mix(0.85, 1, a)})`;
    }
    const c = ease.outBack(prog(t, 820, 520));
    core.style.transform = `scale(${mix(0.6, 1, c)})`; core.style.opacity = String(prog(t, 820, 300));
    center.style.opacity = String(prog(t, 1000, 400));
    center.style.transform = `translate(-50%,-50%) scale(${mix(0.85, 1, ease.outCubic(prog(t, 1000, 500)))})`;
    brain.style.transform = `scale(${t > 1400 ? 1 + Math.sin(t / 900) * 0.025 : 1})`;

    data.nodes.forEach((nd, i) => {
      const N = nodes[i], appear = ease.outCubic(prog(t, 950 + i * 70, 420));
      const lt = lightOf.get(i), ms = missOf.get(i);
      const lit = lt ? prog(t, lt.t, 360) : 0, miss = ms ? prog(t, ms.t, 420) : 0;
      let scale = mix(0.7, 1, appear);
      if (lt && lit > 0 && lit < 1) scale *= mix(0.92, 1, ease.outBack(lit)) + Math.sin(lit * Math.PI) * 0.1;
      if (ms && miss > 0) scale *= 1 + Math.sin(miss * Math.PI * 3) * (1 - miss) * 0.06;
      if (ms && t > ms.t + 500) scale *= 1 + Math.sin((t - ms.t) / 520) * 0.025;
      N.btn.style.opacity = String(appear);
      N.btn.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(4)})`;
      N.btn.classList.toggle('is-lit', lit > 0.15);
      N.btn.classList.toggle('is-missed', miss > 0.15);
      N.btn.classList.toggle('is-neutral', nd.state === 'neutral' && t > P.countEnd);
      N.btn.style.setProperty('--lit', lit.toFixed(3));
      const bp = ms ? ease.outBack(prog(t, ms.t + 140, 360)) : 0;
      N.badge.style.transform = `scale(${bp})`; N.badge.style.opacity = bp > 0 ? '1' : '0';
      N.label.style.opacity = String(appear);
      N.label.classList.toggle('is-missed', miss > 0.3);
      // connector
      if (lt && t >= lt.t) {
        N.link.setAttribute('class', `ssu-link told tone-${nd.tone ?? 'g'}`);
        N.link.style.strokeDasharray = '2 6'; N.link.style.strokeDashoffset = (-(t - lt.t) / 30).toFixed(1);
        N.link.style.opacity = String(mix(0.25, 1, ease.outCubic(prog(t, lt.t, 360))));
      } else if (ms && miss > 0) {
        N.link.setAttribute('class', 'ssu-link missed');
        N.link.style.strokeDasharray = '5 5'; N.link.style.strokeDashoffset = '0';
        N.link.style.opacity = String(mix(0.25, 1, miss));
      } else {
        N.link.setAttribute('class', 'ssu-link');
        N.link.style.strokeDasharray = '2 6'; N.link.style.strokeDashoffset = '0';
        N.link.style.opacity = String(0.25 * appear);
      }
      const xp = ms ? ease.outBack(prog(t, ms.t + 220, 320)) : 0;
      N.linkX.style.opacity = xp > 0 ? '1' : '0'; N.linkX.style.transform = `scale(${xp})`;
      const sk = lt ? prog(t, lt.t + 60, 650) : 0;
      N.sparks.forEach((d, q) => {
        if (sk <= 0 || sk >= 1) { d.style.opacity = '0'; return; }
        const a = (q / 7) * Math.PI * 2 + i, rr = NODE_R + 4 + 22 * ease.outCubic(sk);
        d.style.left = `${((N.x + Math.cos(a) * rr) / W) * 100}%`; d.style.top = `${((N.y + Math.sin(a) * rr) / H) * 100}%`;
        d.style.opacity = (1 - sk).toFixed(3); d.style.transform = `translate(-50%,-50%) scale(${(1.2 - sk * 0.8).toFixed(3)})`;
      });
    });

    // ring: points sweep in; in mapped mode a missed node's own segment breathes coral, in gauge mode the room left breathes softly
    P.steps.forEach((st) => {
      const f = segFill[st.seg], k = ease.inOutSine(prog(t, st.t + 150, 340));
      if (k <= 0) { f.el.setAttribute('d', ''); return; }
      f.el.setAttribute('d', arcPath(RING_R, f.a0, f.a0 + (f.a1 - f.a0) * k));
      const glint = t > P.lock ? Math.max(0, Math.sin((t - P.lock) / 260 - st.seg * 0.5)) * 0.25 : 0;
      f.el.style.filter = glint > 0 ? `brightness(${1 + glint})` : '';
    });
    if (P.mapped) {
      P.misses.forEach((ms) => {
        if (ms.seg === null) return;
        const m = prog(t, ms.t, 420), tr = segTrack[ms.seg];
        tr.classList.toggle('is-missed', m > 0.2);
        if (m > 0) tr.style.opacity = String(0.55 + 0.35 * (0.5 + 0.5 * Math.sin((t - ms.t) / 520)));
      });
    } else if (t > P.lock) {
      for (let s = P.steps.length; s < total; s++) {
        segTrack[s].classList.add('is-room');
        segTrack[s].style.opacity = String(0.6 + 0.3 * (0.5 + 0.5 * Math.sin((t - P.lock) / 600 - s * 0.4)));
      }
    }

    // the score reel (casino roll)
    const p = reelPos(P, t), speed = Math.abs(p - reelPos(P, t - 16)) * 60, v = landed(P, t);
    stripU.style.transform = `translateY(${(-(10 + (p % 10)) * CELL_EM).toFixed(3)}em)`;
    stripU.style.filter = speed > 4 ? `blur(${Math.min(2.2, speed / 22).toFixed(2)}px)` : '';
    const tensK = P.steps.length >= 10 ? ease.outCubic(prog(t, P.steps[9].t + 80 + P.steps[9].spinDur * 0.55, 300)) : 0;
    stripT.style.transform = `translateY(${(-tensK * CELL_EM).toFixed(3)}em)`;
    reelT.style.width = `${(tensK * 0.62).toFixed(3)}em`;
    const lockK = prog(t, P.lock, 520);
    score.style.transform = `scale(${1 + Math.sin(lockK * Math.PI) * 0.16})`;
    score.classList.toggle('is-locked', t >= P.lock);
    const ofK = ease.outCubic(prog(t, P.lock, 600));                 // "/ १०" arrives at the lock, not before
    ofEl.style.opacity = ofK.toFixed(3); ofEl.style.maxWidth = `${(ofK * 2.6).toFixed(3)}em`;

    // lock: pulse ring, halo, leaves
    const pk = prog(t, P.lock, 1100);
    pulse.style.opacity = String(pk > 0 && pk < 1 ? (1 - pk) * 0.55 : 0);
    pulse.setAttribute('r', (RING_R + 4 + pk * 70).toFixed(1));
    halo.style.opacity = (prog(t, P.lock, 500) * 0.9 + (t > P.lock ? Math.sin((t - P.lock) / 700) * 0.1 : 0)).toFixed(3);
    const full = P.steps.length >= total;
    leaves.forEach((lf, i) => {
      const lt = (t - P.lock - lf.delay) / 1700;
      if (lt <= 0 || lt >= 1 || (!full && i % 4 === 3)) { lf.el.style.opacity = '0'; return; }
      const d = lf.v * ease.outCubic(lt) * (full ? 1.25 : 1);
      const x = CX + Math.cos(lf.a) * (RING_R + d), y = CY + Math.sin(lf.a) * (RING_R + d) + 60 * lt * lt;
      lf.el.style.opacity = (lt < 0.15 ? lt / 0.15 : 1 - Math.pow((lt - 0.15) / 0.85, 2)).toFixed(3);
      lf.el.style.width = `${((lf.size / W) * 100).toFixed(2)}%`;
      lf.el.style.left = `${(x / W) * 100}%`; lf.el.style.top = `${(y / H) * 100}%`;
      lf.el.style.transform = `translate(-50%,-50%) rotate(${(lf.a * 57 + lf.spin * lt).toFixed(1)}deg)`;
    });

    // reward card; its number rolls from the total down to what is left to tell
    const ck = ease.outCubic(prog(t, P.card, 650));
    card.style.opacity = String(ck); card.style.transform = `translateY(${((1 - ck) * 26).toFixed(1)}px)`;
    if (roll) roll.textContent = digits(Math.round(mix(total, missedCount, ease.outQuint(prog(t, P.card + 250, 900)))), opts.numerals);
    ready = t >= P.card;

    if (fx) {
      const cellNow = Math.floor(p);
      if (cellNow !== fx.lastCell) { if (speed > 1 && fx.sound) fx.snd.tick(); fx.lastCell = cellNow; }
      if (v > fx.lastV) { if (fx.sound) fx.snd.land(v); haptic('land'); }
      fx.lastV = v;
      P.misses.forEach((ms) => { if (!fx.missDone.has(ms.ni) && t >= ms.t) { fx.missDone.add(ms.ni); if (fx.sound) fx.snd.miss(); } });
      if (!fx.locked && t >= P.lock) { fx.locked = true; if (fx.sound) fx.snd.chime(); haptic('lock'); }
    }
  }
  function haptic(kind: HapticKind) {
    if (typeof opts.haptics === 'function') opts.haptics(kind);
    else if (opts.haptics && navigator.vibrate) navigator.vibrate(kind === 'lock' ? [10, 60, 18] : 12);
  }

  // ---------------------------------------------------------------- playback
  interface Fx { sound: boolean; snd: ReturnType<typeof makeSound>; lastCell: number; lastV: number; missDone: Set<number>; locked: boolean }
  let raf = 0, t0 = 0, fx: Fx | null = null;
  const snd = makeSound();
  const reduce = !opts.ignoreReducedMotion && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const fit = () => container.style.setProperty('--ssu-s', ((container.clientWidth || W) / W).toFixed(4));
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  ro?.observe(container);
  const loop = (now: number) => {
    const t = now - t0; frame(t, fx);
    if (t < P.duration + 30000) raf = requestAnimationFrame(loop);
  };
  const handle: RingHandle = {
    duration: P.duration,
    seek: (ms) => frame(ms, null),
    play: () => {
      cancelAnimationFrame(raf);
      if (reduce) { frame(P.duration, null); return; }
      fx = { sound: opts.sound, snd, lastCell: 0, lastV: 0, missDone: new Set(), locked: false };
      if (opts.sound) snd.unlock();
      t0 = performance.now(); raf = requestAnimationFrame(loop);
    },
    setSound: (on) => { opts.sound = on; if (fx) fx.sound = on; if (on) snd.unlock(); },
    destroy: () => { cancelAnimationFrame(raf); window.clearTimeout(hintTimer); ro?.disconnect(); container.innerHTML = ''; container.classList.remove('ssu'); },
  };
  frame(0, null);
  if (opts.autoplay) handle.play();
  return handle;
}
