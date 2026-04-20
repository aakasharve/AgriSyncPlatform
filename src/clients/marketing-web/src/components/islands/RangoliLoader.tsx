import { useEffect, useState } from 'react';

const STORAGE_KEY = 'shramsafal-rangoli-loader-v1';

type LoaderPhase = 'hidden' | 'enter' | 'exit';

export default function RangoliLoader() {
  const [phase, setPhase] = useState<LoaderPhase>('hidden');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;

    sessionStorage.setItem(STORAGE_KEY, '1');
    setPhase('enter');

    const exitTimer = window.setTimeout(() => setPhase('exit'), 1650);
    const hideTimer = window.setTimeout(() => setPhase('hidden'), 2300);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <>
      <style>{`
        .rangoli-loader {
          position: fixed;
          inset: 0;
          z-index: 95;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at 50% 28%, rgba(249, 115, 22, 0.26), transparent 26%),
            radial-gradient(circle at 50% 72%, rgba(5, 150, 105, 0.12), transparent 34%),
            linear-gradient(180deg, rgba(13, 26, 15, 0.96), rgba(12, 18, 13, 0.94));
          transition: opacity 0.55s ease, visibility 0.55s ease;
          opacity: 1;
        }

        .rangoli-loader--exit {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .rangoli-loader__panel {
          position: relative;
          width: min(78vw, 420px);
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .rangoli-loader__halo,
        .rangoli-loader__halo::before {
          position: absolute;
          inset: 12%;
          border-radius: 999px;
          pointer-events: none;
          content: '';
        }

        .rangoli-loader__halo {
          background: radial-gradient(circle, rgba(245, 158, 11, 0.2), transparent 68%);
          filter: blur(22px);
          animation: rangoliPulse 2.8s ease-in-out infinite;
        }

        .rangoli-loader__halo::before {
          inset: 18%;
          border: 1px solid rgba(254, 243, 199, 0.28);
          filter: blur(0.5px);
        }

        .rangoli-loader__svg {
          position: relative;
          width: 100%;
          height: 100%;
          animation: rangoliBreathe 3.2s ease-in-out infinite;
        }

        .rangoli-loader__ring,
        .rangoli-loader__petal,
        .rangoli-loader__accent {
          stroke-dasharray: 600;
          stroke-dashoffset: 600;
          animation: rangoliDraw 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .rangoli-loader__ring {
          animation-delay: 0.08s;
        }

        .rangoli-loader__petal:nth-of-type(2) { animation-delay: 0.18s; }
        .rangoli-loader__petal:nth-of-type(3) { animation-delay: 0.28s; }
        .rangoli-loader__petal:nth-of-type(4) { animation-delay: 0.38s; }
        .rangoli-loader__petal:nth-of-type(5) { animation-delay: 0.48s; }
        .rangoli-loader__petal:nth-of-type(6) { animation-delay: 0.58s; }
        .rangoli-loader__petal:nth-of-type(7) { animation-delay: 0.68s; }
        .rangoli-loader__petal:nth-of-type(8) { animation-delay: 0.78s; }
        .rangoli-loader__petal:nth-of-type(9) { animation-delay: 0.88s; }
        .rangoli-loader__accent {
          animation-delay: 0.96s;
        }

        .rangoli-loader__brand {
          position: absolute;
          left: 50%;
          bottom: 11%;
          transform: translateX(-50%);
          font-family: var(--font-serif, "DM Serif Display", serif);
          font-size: clamp(1rem, 2vw, 1.22rem);
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: rgba(255, 247, 237, 0.92);
        }

        .rangoli-loader__seed {
          fill: rgba(255, 251, 235, 0.96);
          filter: drop-shadow(0 0 14px rgba(245, 158, 11, 0.22));
        }

        @keyframes rangoliDraw {
          to {
            stroke-dashoffset: 0;
          }
        }

        @keyframes rangoliBreathe {
          0%, 100% { transform: scale(0.985); }
          50% { transform: scale(1.02); }
        }

        @keyframes rangoliPulse {
          0%, 100% { transform: scale(0.92); opacity: 0.88; }
          50% { transform: scale(1.06); opacity: 1; }
        }

        @media (max-width: 640px) {
          .rangoli-loader__brand {
            letter-spacing: 0.18em;
            bottom: 10%;
          }
        }
      `}</style>

      <div className={`rangoli-loader ${phase === 'exit' ? 'rangoli-loader--exit' : ''}`} aria-hidden="true">
        <div className="rangoli-loader__panel">
          <div className="rangoli-loader__halo" />
          <svg className="rangoli-loader__svg" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
            <circle
              className="rangoli-loader__ring"
              cx="160"
              cy="160"
              r="114"
              fill="none"
              stroke="rgba(254, 243, 199, 0.36)"
              strokeWidth="1.2"
            />
            <circle
              className="rangoli-loader__ring"
              cx="160"
              cy="160"
              r="88"
              fill="none"
              stroke="rgba(251, 191, 36, 0.34)"
              strokeWidth="1"
            />

            <path className="rangoli-loader__petal" d="M160 56C176 74 182 96 160 118C138 96 144 74 160 56Z" fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path className="rangoli-loader__petal" d="M160 56C144 74 138 96 160 118C182 96 176 74 160 56Z" fill="none" stroke="#fb7185" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(45 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C176 74 182 96 160 118C138 96 144 74 160 56Z" fill="none" stroke="#4ade80" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C144 74 138 96 160 118C182 96 176 74 160 56Z" fill="none" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C176 74 182 96 160 118C138 96 144 74 160 56Z" fill="none" stroke="#f97316" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(180 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C144 74 138 96 160 118C182 96 176 74 160 56Z" fill="none" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(225 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C176 74 182 96 160 118C138 96 144 74 160 56Z" fill="none" stroke="#34d399" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(270 160 160)" />
            <path className="rangoli-loader__petal" d="M160 56C144 74 138 96 160 118C182 96 176 74 160 56Z" fill="none" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(315 160 160)" />

            <path
              className="rangoli-loader__accent"
              d="M160 132C170 144 176 158 176 172C176 194 167 208 160 216C153 208 144 194 144 172C144 158 150 144 160 132Z"
              fill="none"
              stroke="rgba(255, 247, 237, 0.9)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle className="rangoli-loader__seed" cx="160" cy="166" r="7" />
          </svg>
          <div className="rangoli-loader__brand">ShramSafal</div>
        </div>
      </div>
    </>
  );
}
