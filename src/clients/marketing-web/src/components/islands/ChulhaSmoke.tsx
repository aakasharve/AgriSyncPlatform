import { useEffect, useMemo, useRef, useState } from 'react';

interface ChulhaSmokeProps {
  lang: 'en' | 'mr';
}

interface SmokeParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  vx: number;
  vy: number;
  life: number;
}

function createParticle(width: number, height: number): SmokeParticle {
  return {
    x: width * 0.5 + (Math.random() - 0.5) * 16,
    y: height - 24,
    radius: 8 + Math.random() * 16,
    alpha: 0.12 + Math.random() * 0.14,
    vx: (Math.random() - 0.5) * 0.45,
    vy: -(0.55 + Math.random() * 0.5),
    life: 70 + Math.random() * 50,
  };
}

export default function ChulhaSmoke({ lang }: ChulhaSmokeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const words = useMemo(
    () => (lang === 'mr' ? ['नोंद', 'शिस्त', 'विश्वास'] : ['Record', 'Rhythm', 'Trust']),
    [lang]
  );

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 180;
    let height = 190;
    const particles = Array.from({ length: 24 }, () => createParticle(width, height));
    let frame = 0;
    let rafId = 0;

    const resize = () => {
      width = canvas.clientWidth || 180;
      height = canvas.clientHeight || 190;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const tick = () => {
      frame += 1;
      ctx.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.vx + Math.sin((frame + index * 12) * 0.02) * 0.28;
        particle.y += particle.vy;
        particle.life -= 1;
        particle.alpha *= 0.992;
        particle.radius *= 1.006;

        if (particle.life <= 0 || particle.y < -18) {
          Object.assign(particle, createParticle(width, height));
        }

        const gradient = ctx.createRadialGradient(
          particle.x,
          particle.y,
          particle.radius * 0.15,
          particle.x,
          particle.y,
          particle.radius
        );
        gradient.addColorStop(0, `rgba(255,255,255,${particle.alpha})`);
        gradient.addColorStop(1, `rgba(148,163,184,${particle.alpha * 0.1})`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    const wordTimer = window.setInterval(() => {
      setWordIndex((current) => current + 1);
    }, 3600);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(wordTimer);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <style>{`
        .chulha-smoke {
          position: absolute;
          left: max(1rem, 4vw);
          bottom: 0;
          width: min(240px, 34vw);
          height: 270px;
          pointer-events: none;
          z-index: 0;
          opacity: 0.92;
        }

        .chulha-smoke__canvas {
          position: absolute;
          left: 50%;
          bottom: 48px;
          width: 180px;
          height: 190px;
          transform: translateX(-50%);
        }

        .chulha-smoke__hearth {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 148px;
          height: 74px;
          transform: translateX(-50%);
        }

        .chulha-smoke__stone {
          position: absolute;
          bottom: 0;
          width: 54px;
          height: 34px;
          border-radius: 18px 18px 12px 12px;
          background: linear-gradient(180deg, rgba(120, 53, 15, 0.92), rgba(41, 22, 10, 0.96));
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
        }

        .chulha-smoke__stone--left {
          left: 8px;
          transform: rotate(-6deg);
        }

        .chulha-smoke__stone--right {
          right: 8px;
          transform: rotate(6deg);
        }

        .chulha-smoke__logs {
          position: absolute;
          left: 50%;
          bottom: 16px;
          width: 72px;
          height: 28px;
          transform: translateX(-50%);
        }

        .chulha-smoke__log {
          position: absolute;
          bottom: 0;
          width: 42px;
          height: 10px;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(146, 64, 14, 0.95), rgba(120, 53, 15, 0.75));
        }

        .chulha-smoke__log:first-child {
          left: 0;
          transform: rotate(24deg);
        }

        .chulha-smoke__log:last-child {
          right: 0;
          transform: rotate(-24deg);
        }

        .chulha-smoke__flame {
          position: absolute;
          left: 50%;
          bottom: 16px;
          width: 26px;
          height: 40px;
          transform: translateX(-50%);
          border-radius: 60% 60% 52% 52%;
          background: radial-gradient(circle at 50% 18%, rgba(254, 243, 199, 0.96), rgba(249, 115, 22, 0.88) 55%, rgba(185, 28, 28, 0.24) 100%);
          filter: blur(0.2px) drop-shadow(0 0 18px rgba(249, 115, 22, 0.38));
          animation: chulhaFlame 2.2s ease-in-out infinite;
          transform-origin: 50% 100%;
        }

        .chulha-smoke__word {
          position: absolute;
          left: 50%;
          bottom: 122px;
          transform: translateX(-50%);
          color: rgba(255, 247, 237, 0.44);
          font-family: var(--font-serif, "DM Serif Display", serif);
          font-size: 1.05rem;
          letter-spacing: 0.08em;
          white-space: nowrap;
          animation: chulhaWord 3.3s ease-out forwards;
          text-shadow: 0 0 16px rgba(255, 247, 237, 0.08);
        }

        @keyframes chulhaFlame {
          0%, 100% { transform: translateX(-50%) scaleY(0.92) rotate(-2deg); }
          50% { transform: translateX(-50%) scaleY(1.08) rotate(2deg); }
        }

        @keyframes chulhaWord {
          0% { opacity: 0; transform: translate(-50%, 12px) scale(0.92); }
          18% { opacity: 0.85; }
          100% { opacity: 0; transform: translate(-50%, -62px) scale(1.08); }
        }

        @media (max-width: 767px) {
          .chulha-smoke {
            left: 50%;
            width: min(220px, 70vw);
            transform: translateX(-50%);
            opacity: 0.72;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .chulha-smoke__word {
            display: none;
          }

          .chulha-smoke__flame {
            animation: none;
          }
        }
      `}</style>

      <div className="chulha-smoke" aria-hidden="true">
        <canvas ref={canvasRef} className="chulha-smoke__canvas" />
        <span key={wordIndex} className="chulha-smoke__word">
          {words[wordIndex % words.length]}
        </span>

        <div className="chulha-smoke__hearth">
          <div className="chulha-smoke__stone chulha-smoke__stone--left" />
          <div className="chulha-smoke__stone chulha-smoke__stone--right" />
          <div className="chulha-smoke__logs">
            <div className="chulha-smoke__log" />
            <div className="chulha-smoke__log" />
          </div>
          <div className="chulha-smoke__flame" />
        </div>
      </div>
    </>
  );
}
