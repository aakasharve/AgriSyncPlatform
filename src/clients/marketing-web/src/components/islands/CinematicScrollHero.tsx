import { useEffect, useRef } from 'react';
import { useFrameSequence } from './useFrameSequence';

interface Props {
  lang?: 'en' | 'mr';
}

const SETTLE_START = 0.58;
const HINT_DONE    = 0.60;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const remap = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
const ease = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
const easeOut3 = (t: number) => 1 - Math.pow(1 - t, 3);

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (ir > cr) { sw = sh * cr; sx = (img.naturalWidth - sw) / 2; }
  else          { sh = sw / cr; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

export default function CinematicScrollHero({ lang = 'en' }: Props) {
  const isEN = lang === 'en';

  const sectionRef   = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const vigRef       = useRef<HTMLDivElement>(null);
  const hintRef      = useRef<HTMLDivElement>(null);
  const progressRef  = useRef(0);
  const lastFrameRef = useRef(-1);

  const { getFrame, loadedCount, totalFrames } = useFrameSequence(240);

  const paint = (p: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fp = p < SETTLE_START
      ? (p / SETTLE_START) * 0.82
      : 0.82 + easeOut3(remap(p, SETTLE_START, 1)) * 0.18;
    const idx = Math.round(fp * (totalFrames - 1));
    if (lastFrameRef.current === idx) return;
    const img = getFrame(idx);
    if (!img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    lastFrameRef.current = idx;
    drawCover(ctx, img, canvas.width, canvas.height);
  };

  const update = (p: number) => {
    paint(p);

    // Vignette deepens slightly in the final third
    if (vigRef.current) {
      const v = ease(remap(p, SETTLE_START, 1));
      vigRef.current.style.opacity = String(0.32 + v * 0.28);
    }

    // Scroll hint fades out mid-way
    if (hintRef.current) {
      const t = 1 - ease(remap(p, 0.36, HINT_DONE));
      hintRef.current.style.opacity = String(Math.max(0, t) * 0.72);
    }
  };

  useEffect(() => {
    const section = sectionRef.current;
    const canvas  = canvasRef.current;
    if (!section || !canvas) return;

    const setSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width  = '100vw';
      canvas.style.height = '100vh';
      lastFrameRef.current = -1;
      update(progressRef.current);
    };
    setSize();
    window.addEventListener('resize', setSize, { passive: true });

    let trigger: { kill: () => void } | null = null;
    const initScroll = async () => {
      const { gsap }          = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);
      trigger = ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: '+=340%',
        pin: true,
        scrub: 1.2,
        anticipatePin: 1,
        onUpdate: (self: { progress: number }) => {
          progressRef.current = self.progress;
          update(self.progress);
        },
      });
      requestAnimationFrame(() => ScrollTrigger.refresh());
    };

    update(0);
    initScroll();

    return () => {
      window.removeEventListener('resize', setSize);
      trigger?.kill();
    };
  }, []);

  useEffect(() => {
    update(progressRef.current);
  }, [loadedCount]);

  const loadPct = Math.round((loadedCount / totalFrames) * 100);

  return (
    <div
      ref={sectionRef}
      data-scene="hero"
      data-cursor="kite"
      className="ssfilm-shell"
    >
      <canvas ref={canvasRef} aria-hidden="true" className="ssfilm-canvas" />

      {/* Depth vignette */}
      <div ref={vigRef} aria-hidden="true" className="ssfilm-vignette" />

      {/* Top sky haze */}
      <div aria-hidden="true" className="ssfilm-tophaze" />

      {/* Scroll hint */}
      <div ref={hintRef} className="ssfilm-hint" aria-hidden="true">
        <span className="ssfilm-hint__line" />
        <span>{isEN ? 'Scroll to enter' : 'आत या'}</span>
      </div>

      {/* Loading counter */}
      {loadedCount < totalFrames && (
        <div aria-hidden="true" className="ssfilm-loading">{loadPct}%</div>
      )}

      <style>{`
        .ssfilm-shell {
          position: relative;
          width: 100%;
          height: 100vh;
          overflow: hidden;
          background: #0F1A10;
        }
        @media (max-width: 640px) {
          .ssfilm-shell { height: 100svh; }
        }
        .ssfilm-canvas {
          position: absolute;
          inset: 0;
          z-index: 0;
          display: block;
        }
        .ssfilm-vignette {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          opacity: 0.32;
          background:
            radial-gradient(ellipse 110% 70% at 50% 110%, rgba(9,16,11,0.88) 0%, rgba(9,16,11,0.38) 42%, transparent 68%),
            linear-gradient(to bottom, rgba(9,16,11,0.22) 0%, transparent 20%, transparent 58%, rgba(9,16,11,0.48) 82%, rgba(9,16,11,0.72) 100%);
        }
        .ssfilm-tophaze {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background: radial-gradient(ellipse 60% 32% at 68% 8%, rgba(212,169,106,0.12) 0%, transparent 64%);
        }
        .ssfilm-hint {
          position: absolute;
          bottom: 2.4rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10;
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.65rem 1.1rem;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(9,16,11,0.28);
          color: rgba(220,208,188,0.70);
          font-family: var(--font-sans);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          pointer-events: none;
          will-change: opacity;
          white-space: nowrap;
        }
        .ssfilm-hint__line {
          display: inline-block;
          width: 2.4rem;
          height: 1px;
          background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.58));
        }
        .ssfilm-loading {
          position: absolute;
          right: 1.2rem;
          bottom: 1.2rem;
          z-index: 10;
          color: rgba(220,208,188,0.32);
          font-family: var(--font-sans);
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
