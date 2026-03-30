import { useEffect, useRef } from 'react';
import TiltCard from './TiltCard';

interface BeforeAfterRevealProps {
  eyebrow?: string;
  title: string;
  description?: string;
  beforeTitle: string;
  beforeBody: string;
  beforePoints?: string[];
  afterTitle: string;
  afterBody: string;
  afterPoints?: string[];
  className?: string;
}

export default function BeforeAfterReveal({
  eyebrow = 'Chapter 03',
  title,
  description,
  beforeTitle,
  beforeBody,
  beforePoints = [],
  afterTitle,
  afterBody,
  afterPoints = [],
  className = '',
}: BeforeAfterRevealProps) {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const section = sectionRef.current;
    if (!section) return;

    let cleanup = () => undefined;

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);

      gsap.registerPlugin(ScrollTrigger);

      const ctx = gsap.context(() => {
        const leftCard = section.querySelector<HTMLElement>('[data-before-card]');
        const rightCard = section.querySelector<HTMLElement>('[data-after-card]');
        const divider = section.querySelector<HTMLElement>('[data-before-after-divider]');
        const state = { wipe: 0.24 };

        const apply = () => {
          section.style.setProperty('--wipe', state.wipe.toFixed(3));
        };

        apply();

        gsap.to(state, {
          wipe: 0.74,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top 70%',
            end: 'bottom 30%',
            scrub: 1,
            invalidateOnRefresh: true,
            onUpdate: apply,
          },
          onUpdate: apply,
        });

        if (leftCard) {
          gsap.fromTo(
            leftCard,
            { opacity: 0.6, y: 24, rotateY: 12 },
            {
              opacity: 1,
              y: 0,
              rotateY: 0,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top 72%',
                end: 'center center',
                scrub: 0.8,
              },
            }
          );
        }

        if (rightCard) {
          gsap.fromTo(
            rightCard,
            { opacity: 0.55, y: 30, rotateY: -10, scale: 0.98 },
            {
              opacity: 1,
              y: 0,
              rotateY: 0,
              scale: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top 72%',
                end: 'center center',
                scrub: 0.8,
              },
            }
          );
        }

        if (divider) {
          gsap.fromTo(
            divider,
            { opacity: 0.45, scaleY: 0.72 },
            {
              opacity: 1,
              scaleY: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top 72%',
                end: 'bottom 35%',
                scrub: 1,
              },
            }
          );
        }
      }, section);

      cleanup = () => { ctx.revert(); };
    })();

    return () => cleanup();
  }, []);

  return (
    <>
      <style>{`
        .before-after-reveal__grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1fr;
        }

        .before-after-reveal__panel {
          position: relative;
          overflow: hidden;
          min-height: 100%;
        }

        .before-after-reveal__band {
          position: relative;
          min-height: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .before-after-reveal__rail {
          position: absolute;
          inset: 10px auto 10px 50%;
          width: 2px;
          transform: translateX(-50%);
          background: linear-gradient(180deg, rgba(245,158,11,0.1), rgba(245,158,11,0.55), rgba(16,185,129,0.35));
          border-radius: 999px;
        }

        .before-after-reveal__knob {
          position: relative;
          z-index: 1;
          width: 4.5rem;
          height: 4.5rem;
          border-radius: 999px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(12px);
          box-shadow: 0 18px 42px rgba(0,0,0,0.12);
          color: var(--gold);
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          font-size: 0.72rem;
        }

        @media (min-width: 1024px) {
          .before-after-reveal__grid {
            grid-template-columns: minmax(0, 1fr) 8.5rem minmax(0, 1fr);
            align-items: stretch;
          }

          .before-after-reveal__band {
            min-height: auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .before-after-reveal__panel {
            clip-path: none;
          }

        }
      `}</style>

      <section
        ref={sectionRef}
        className={`relative py-section-tight overflow-hidden ${className}`.trim()}
        data-scene="before-after"
        data-soil="tilled"
        data-cursor="seedling"
        style={{ background: '#FBF5EC' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse 65% 35% at 50% 16%, rgba(217,119,6,0.08) 0%, transparent 44%), radial-gradient(ellipse 55% 40% at 50% 78%, rgba(20,83,45,0.07) 0%, transparent 48%)',
          }}
        />

        <div className="relative z-10 max-w-site mx-auto px-5 md:px-8">
          <div className="max-w-2xl mb-8 md:mb-10">
            <span className="chapter-mark">{eyebrow}</span>
            <h2 className="font-serif text-[clamp(2rem,4.8vw,3.8rem)] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h2>
            {description ? (
              <p className="mt-4 max-w-prose text-[clamp(0.98rem,1.5vw,1.08rem)]" style={{ color: 'var(--text-secondary)' }}>
                {description}
              </p>
            ) : null}
          </div>

          <div className="before-after-reveal__grid">
            <TiltCard className="h-full" tone="gold" tilt={7} scale={1.01}>
              <article
                data-before-card
                data-side="before"
                className="before-after-reveal__panel h-full rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-6 md:p-7"
                style={{ background: 'linear-gradient(180deg, #fffdf8, #f7f1e4)', borderColor: 'rgba(19,50,36,0.08)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className="text-[0.64rem] font-extrabold uppercase tracking-[0.28em]" style={{ color: 'var(--gold)' }}>
                    {beforeTitle}
                  </span>
                  <span className="rounded-full px-3 py-1 text-[0.7rem] font-bold" style={{ border: '1px solid rgba(19,50,36,0.08)', background: 'rgba(19,50,36,0.04)', color: 'rgba(29,51,38,0.58)' }}>
                    Before
                  </span>
                </div>

                <div className="relative w-full h-52 mb-5 overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(251,245,234,0.98),rgba(243,231,210,0.92))] border border-[rgba(19,50,36,0.05)] px-3 pt-3">
                  <img
                    src="/images/characters/before-chaos-farmer.png"
                    alt="Before"
                    className="w-full h-full object-contain object-bottom mix-blend-multiply opacity-95 transition-transform duration-700 hover:scale-[1.03]"
                  />
                </div>

                <p className="text-[1.02rem] leading-7" style={{ color: 'var(--text-primary)' }}>
                  {beforeBody}
                </p>

                {beforePoints.length > 0 ? (
                  <ul className="mt-5 space-y-3">
                    {beforePoints.map((point) => (
                      <li key={point} className="flex items-start gap-3 text-sm md:text-[0.95rem]" style={{ color: 'var(--text-secondary)' }}>
                        <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--gold)' }} aria-hidden="true" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </TiltCard>

            <div className="before-after-reveal__band">
              <div className="before-after-reveal__rail" data-before-after-divider aria-hidden="true" />
              <div className="before-after-reveal__knob">
                <span>{'/'}</span>
              </div>
            </div>

            <TiltCard className="h-full" tone="emerald" tilt={7} scale={1.01}>
              <article
                data-after-card
                data-side="after"
                className="before-after-reveal__panel h-full rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.028))] p-6 md:p-7"
                style={{ background: 'linear-gradient(180deg, #f5fff9, #ecf8f1)', borderColor: 'rgba(16,185,129,0.16)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className="text-[0.64rem] font-extrabold uppercase tracking-[0.28em]" style={{ color: 'var(--brand-fresh)' }}>
                    {afterTitle}
                  </span>
                  <span className="rounded-full px-3 py-1 text-[0.7rem] font-bold" style={{ border: '1px solid rgba(16,185,129,0.12)', background: 'rgba(16,185,129,0.06)', color: 'rgba(15,138,99,0.72)' }}>
                    After
                  </span>
                </div>

                <div className="relative w-full h-52 mb-5 overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(242,251,245,0.98),rgba(228,246,236,0.92))] border border-[rgba(16,185,129,0.08)] px-3 pt-3">
                  <img
                    src="/images/characters/after-clarity-farmer.png"
                    alt="After"
                    className="w-full h-full object-contain object-bottom mix-blend-multiply transition-transform duration-700 hover:scale-[1.03]"
                  />
                </div>

                <p className="text-[1.02rem] leading-7" style={{ color: 'var(--text-primary)' }}>
                  {afterBody}
                </p>

                {afterPoints.length > 0 ? (
                  <ul className="mt-5 space-y-3">
                    {afterPoints.map((point) => (
                      <li key={point} className="flex items-start gap-3 text-sm md:text-[0.95rem]" style={{ color: 'var(--text-secondary)' }}>
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </TiltCard>
          </div>
        </div>
      </section>
    </>
  );
}
