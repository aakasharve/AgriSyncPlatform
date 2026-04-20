import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

type TiltTone = 'emerald' | 'gold' | 'neutral';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: TiltTone;
  tilt?: number;
  scale?: number;
  glare?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function TiltCard({
  children,
  className = '',
  style,
  tone = 'emerald',
  tilt = 9,
  scale = 1.015,
  glare = true,
}: TiltCardProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const reset = () => {
    const shell = shellRef.current;
    if (!shell) return;

    shell.style.setProperty('--tilt-x', '0deg');
    shell.style.setProperty('--tilt-y', '0deg');
    shell.style.setProperty('--tilt-scale', '1');
    shell.style.setProperty('--glare-x', '50%');
    shell.style.setProperty('--glare-y', '35%');
  };

  const updateTilt = (clientX: number, clientY: number) => {
    const shell = shellRef.current;
    if (!shell || reducedMotionRef.current) return;

    const rect = shell.getBoundingClientRect();
    const percentX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const percentY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const offsetX = (percentX - 0.5) * 2;
    const offsetY = (percentY - 0.5) * 2;

    shell.style.setProperty('--tilt-x', `${(-offsetY * tilt).toFixed(2)}deg`);
    shell.style.setProperty('--tilt-y', `${(offsetX * tilt).toFixed(2)}deg`);
    shell.style.setProperty('--tilt-scale', scale.toFixed(3));
    shell.style.setProperty('--glare-x', `${(percentX * 100).toFixed(1)}%`);
    shell.style.setProperty('--glare-y', `${(percentY * 100).toFixed(1)}%`);
  };

  const focusTilt = () => {
    const shell = shellRef.current;
    if (!shell || reducedMotionRef.current) return;

    shell.style.setProperty('--tilt-x', '-1.5deg');
    shell.style.setProperty('--tilt-y', '1.5deg');
    shell.style.setProperty('--tilt-scale', scale.toFixed(3));
    shell.style.setProperty('--glare-x', '50%');
    shell.style.setProperty('--glare-y', '35%');
  };

  const toneLabel = tone === 'gold' ? 'gold' : tone === 'neutral' ? 'neutral' : 'emerald';

  return (
    <>
      <style>{`
        .tilt-card {
          position: relative;
          transform-style: preserve-3d;
          transform: perspective(1200px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) scale(var(--tilt-scale, 1));
          transition: transform 180ms var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 180ms var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
          will-change: transform;
          border-radius: inherit;
        }

        .tilt-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.06), transparent 35%),
            radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08), transparent 35%);
          opacity: 0.9;
        }

        .tilt-card__glare {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          opacity: 0.58;
          mix-blend-mode: screen;
          background: radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 35%), rgba(255,255,255,0.20), transparent 48%);
        }

        .tilt-card__body {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          transform: translateZ(0);
        }

        .tilt-card[data-tone='emerald'] {
          box-shadow:
            0 28px 80px rgba(0, 0, 0, 0.28),
            0 0 0 1px rgba(16, 185, 129, 0.14);
        }

        .tilt-card[data-tone='gold'] {
          box-shadow:
            0 28px 80px rgba(0, 0, 0, 0.30),
            0 0 0 1px rgba(245, 158, 11, 0.16);
        }

        .tilt-card[data-tone='neutral'] {
          box-shadow:
            0 28px 80px rgba(0, 0, 0, 0.24),
            0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        @media (prefers-reduced-motion: reduce) {
          .tilt-card {
            transform: none !important;
            transition: none;
          }

          .tilt-card__glare {
            display: none;
          }
        }
      `}</style>

      <div
        ref={shellRef}
        className={`tilt-card ${className}`.trim()}
        data-tone={toneLabel}
        style={style}
        onPointerMove={(event) => updateTilt(event.clientX, event.clientY)}
        onPointerLeave={reset}
        onFocusCapture={focusTilt}
        onBlurCapture={reset}
      >
        {glare ? <div className="tilt-card__glare" aria-hidden="true" /> : null}
        <div className="tilt-card__body">{children}</div>
      </div>
    </>
  );
}
