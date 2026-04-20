import { useRef, useCallback, useEffect } from 'react';

interface Props {
  src: string;
  alt: string;
  label: string;
  sublabel: string;
  badge?: string;
  delay?: number;        // float animation phase offset (ms)
  tiltMultiplier?: number; // 1 = full tilt, 0.5 = half
  initialRotateY?: number; // pre-baked Y rotation for idle pose
  floatDir?: 'up' | 'down'; // idle float direction
}

export default function AppScreen3D({
  src,
  alt,
  label,
  sublabel,
  badge,
  delay = 0,
  tiltMultiplier = 1,
  initialRotateY = 0,
  floatDir = 'up',
}: Props) {
  const cardRef  = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const imgRef   = useRef<HTMLImageElement>(null);

  const rafId = useRef<number | null>(null);
  const current = useRef({ rx: 0, ry: initialRotateY, gx: 50, gy: 50, scale: 1, shadow: 28 });
  const target  = useRef({ rx: 0, ry: initialRotateY, gx: 50, gy: 50, scale: 1, shadow: 28 });
  const isHovered = useRef(false);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const applyTransform = useCallback(() => {
    const c = current.current;
    if (!cardRef.current) return;
    cardRef.current.style.transform =
      `perspective(900px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale(${c.scale}) translateZ(0)`;
    cardRef.current.style.boxShadow =
      `0 ${c.shadow}px ${c.shadow * 2.4}px rgba(0,0,0,0.30),
       0 ${c.shadow * 0.4}px ${c.shadow * 0.8}px rgba(0,0,0,0.18),
       0 0 0 1px rgba(255,255,255,0.06)`;
    if (glareRef.current) {
      glareRef.current.style.background =
        `radial-gradient(circle at ${c.gx}% ${c.gy}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 38%, transparent 62%)`;
    }
  }, []);

  const tick = useCallback(() => {
    const c = current.current;
    const t = target.current;
    const speed = isHovered.current ? 0.12 : 0.06;

    c.rx = lerp(c.rx, t.rx, speed);
    c.ry = lerp(c.ry, t.ry, speed);
    c.gx = lerp(c.gx, t.gx, speed);
    c.gy = lerp(c.gy, t.gy, speed);
    c.scale = lerp(c.scale, t.scale, speed);
    c.shadow = lerp(c.shadow, t.shadow, speed);

    applyTransform();

    const stillMoving =
      Math.abs(c.rx - t.rx) > 0.01 ||
      Math.abs(c.ry - t.ry) > 0.01 ||
      Math.abs(c.scale - t.scale) > 0.001 ||
      Math.abs(c.shadow - t.shadow) > 0.1;

    if (stillMoving) {
      rafId.current = requestAnimationFrame(tick);
    } else {
      rafId.current = null;
    }
  }, [applyTransform]);

  const startTick = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(tick);
  }, [tick]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width  / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);

    const MAX_RX = 14 * tiltMultiplier;
    const MAX_RY = 18 * tiltMultiplier;

    target.current.rx = -dy * MAX_RX;
    target.current.ry = initialRotateY + dx * MAX_RY;
    target.current.gx = 50 + dx * 40;
    target.current.gy = 50 + dy * 40;
    startTick();
  }, [tiltMultiplier, initialRotateY, startTick]);

  const handleMouseEnter = useCallback(() => {
    isHovered.current = true;
    target.current.scale = 1.045;
    target.current.shadow = 52;
    startTick();
  }, [startTick]);

  const handleMouseLeave = useCallback(() => {
    isHovered.current = false;
    target.current.rx = 0;
    target.current.ry = initialRotateY;
    target.current.gx = 50;
    target.current.gy = 50;
    target.current.scale = 1;
    target.current.shadow = 28;
    startTick();
  }, [initialRotateY, startTick]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.addEventListener('mousemove',  handleMouseMove,  { passive: true });
    el.addEventListener('mouseenter', handleMouseEnter, { passive: true });
    el.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    applyTransform();
    return () => {
      el.removeEventListener('mousemove',  handleMouseMove);
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [handleMouseMove, handleMouseEnter, handleMouseLeave, applyTransform]);

  return (
    <div className="app3d-wrapper" style={{ '--float-delay': `${delay}ms`, '--float-dir': floatDir === 'up' ? '-1' : '1' } as React.CSSProperties}>
      {/* The 3D card itself */}
      <div
        ref={cardRef}
        className="app3d-card"
        aria-label={alt}
        role="img"
      >
        {/* Glare layer — moves with mouse */}
        <div ref={glareRef} className="app3d-glare" aria-hidden="true" />

        {/* The actual phone screenshot */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="app3d-img"
          loading="lazy"
          decoding="async"
          draggable={false}
        />

        {/* Bottom info strip */}
        <div className="app3d-caption" aria-hidden="true">
          {badge && (
            <span className="app3d-badge">{badge}</span>
          )}
          <span className="app3d-label">{label}</span>
          <span className="app3d-sub">{sublabel}</span>
        </div>
      </div>

      <style>{`
        .app3d-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: app3d-float 5.8s ease-in-out infinite;
          animation-delay: var(--float-delay, 0ms);
          will-change: transform;
        }

        @keyframes app3d-float {
          0%,  100% { transform: translateY(0px); }
          50%        { transform: translateY(calc(var(--float-dir, -1) * 10px)); }
        }

        .app3d-card {
          position: relative;
          border-radius: 2.2rem;
          overflow: hidden;
          cursor: pointer;
          transform-style: preserve-3d;
          will-change: transform;
          /* Initial shadow */
          box-shadow:
            0 28px 56px rgba(0,0,0,0.28),
            0 8px 18px rgba(0,0,0,0.16),
            0 0 0 1px rgba(255,255,255,0.06);
          transition: border-radius 0.22s ease;
          /* width is set per instance via parent */
        }

        .app3d-card:hover {
          border-radius: 2.5rem;
        }

        .app3d-glare {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
          border-radius: inherit;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18) 0%, transparent 60%);
          transition: background 0.05s linear;
          mix-blend-mode: screen;
        }

        .app3d-img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: inherit;
          user-select: none;
          -webkit-user-drag: none;
        }

        .app3d-caption {
          position: absolute;
          inset-x: 0;
          bottom: 0;
          z-index: 5;
          padding: 2.4rem 1.4rem 1.2rem;
          background: linear-gradient(to top, rgba(10,18,12,0.82) 0%, rgba(10,18,12,0.42) 52%, transparent 100%);
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          pointer-events: none;
        }

        .app3d-badge {
          display: inline-flex;
          align-self: flex-start;
          align-items: center;
          padding: 0.22rem 0.65rem;
          border-radius: 999px;
          background: rgba(22,163,74,0.90);
          color: #fff;
          font-size: 0.62rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          margin-bottom: 0.3rem;
        }

        .app3d-label {
          color: rgba(242,233,219,0.95);
          font-size: clamp(0.9rem, 1.6vw, 1.1rem);
          font-weight: 800;
          line-height: 1.2;
          font-family: var(--font-sans, 'DM Sans', sans-serif);
        }

        .app3d-sub {
          color: rgba(242,233,219,0.60);
          font-size: 0.78rem;
          font-weight: 500;
          font-family: var(--font-sans, 'DM Sans', sans-serif);
        }

        @media (prefers-reduced-motion: reduce) {
          .app3d-wrapper { animation: none; }
          .app3d-card    { transition: none; transform: none !important; }
        }
      `}</style>
    </div>
  );
}
