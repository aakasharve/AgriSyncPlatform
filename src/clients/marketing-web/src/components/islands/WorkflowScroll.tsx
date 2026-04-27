import { useEffect, useRef } from 'react';
import TiltCard from './TiltCard';

export interface WorkflowStep {
  title: string;
  body: string;
  kicker?: string;
  metric?: string;
  accent?: 'emerald' | 'gold' | 'neutral';
}

interface WorkflowScrollProps {
  eyebrow?: string;
  title: string;
  description?: string;
  steps: WorkflowStep[];
  note?: string;
  className?: string;
}

export default function WorkflowScroll({
  eyebrow = 'Chapter 04',
  title,
  description,
  steps,
  note,
  className = '',
}: WorkflowScrollProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track || steps.length < 2) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);

      gsap.registerPlugin(ScrollTrigger);

      const ctx = gsap.context(() => {
        const cards = Array.from(track.querySelectorAll<HTMLElement>('[data-workflow-card]'));
        const progressLine = section.querySelector<HTMLElement>('[data-workflow-progress]');

        const getDistance = () => Math.max(0, track.scrollWidth - section.clientWidth + 48);

        const tween = gsap.to(track, {
          x: () => -getDistance(),
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top top',
            end: () => `+=${getDistance() + window.innerHeight * 0.65}`,
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        if (progressLine) {
          gsap.fromTo(
            progressLine,
            { scaleX: 0.1 },
            {
              scaleX: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top top',
                end: () => `+=${getDistance() + window.innerHeight * 0.65}`,
                scrub: 1,
                invalidateOnRefresh: true,
              },
            }
          );
        }

        cards.forEach((card) => {
          gsap.fromTo(
            card,
            { opacity: 0.45, y: 26, scale: 0.96 },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: card,
                containerAnimation: tween,
                start: 'left 78%',
                end: 'center 35%',
                scrub: 0.6,
                invalidateOnRefresh: true,
              },
            }
          );
        });
      }, section);

      cleanup = () => { ctx.revert(); };
    })();

    return () => {
      cleanup?.();
    };
  }, [steps.length]);

  return (
    <>
      <style>{`
        .workflow-scroll__track {
          display: flex;
          gap: clamp(1rem, 2.5vw, 1.5rem);
          will-change: transform;
        }

        .workflow-scroll__track > * {
          flex: 0 0 min(84vw, 24rem);
        }

        .workflow-scroll__step {
          position: relative;
          overflow: hidden;
          border-radius: 1.5rem;
          min-height: 100%;
        }

        .workflow-scroll__step::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.08), transparent 34%),
            radial-gradient(circle at 50% 0%, rgba(255,255,255,0.06), transparent 26%);
          opacity: 0.75;
        }

        .workflow-scroll__accent {
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          border-radius: 999px;
        }

        .workflow-scroll__accent[data-accent='emerald'] {
          background: linear-gradient(180deg, rgba(52, 211, 153, 0.75), rgba(16, 185, 129, 0.25));
        }

        .workflow-scroll__accent[data-accent='gold'] {
          background: linear-gradient(180deg, rgba(251, 191, 36, 0.8), rgba(245, 158, 11, 0.25));
        }

        .workflow-scroll__accent[data-accent='neutral'] {
          background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.08));
        }

        .workflow-scroll__mobile-stack {
          display: grid;
          gap: 1rem;
        }

        @media (min-width: 1024px) {
          .workflow-scroll__mobile-stack {
            display: block;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .workflow-scroll__track {
            transform: none !important;
            transition: none;
            display: grid;
            gap: 1rem;
          }

          .workflow-scroll__track > * {
            flex: 1 1 auto;
            width: auto;
          }
        }
      `}</style>

      <section
        ref={sectionRef}
        className={`relative overflow-hidden py-section-tight ${className}`.trim()}
        data-scene="workflow"
        data-soil="wet-irrigated"
        data-cursor="mic"
        style={{ background: 'var(--bg-base)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 20% 20%, rgba(16,185,129,0.08) 0%, transparent 50%), radial-gradient(ellipse 50% 35% at 80% 70%, rgba(245,158,11,0.08) 0%, transparent 48%)',
          }}
        />

        <div className="relative z-10 max-w-site mx-auto px-5 md:px-8">
          <div className="max-w-2xl mb-8 md:mb-10">
            <span className="chapter-mark">{eyebrow}</span>
            <h2 className="font-serif text-[clamp(2rem,4.8vw,3.8rem)] text-white font-bold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-4 max-w-prose text-[clamp(0.98rem,1.5vw,1.08rem)]" style={{ color: 'var(--white-55)' }}>
                {description}
              </p>
            ) : null}
          </div>

          <div className="relative">
            <div className="hidden lg:block absolute left-0 right-0 top-6 h-px bg-white/10" aria-hidden="true" />
            <div
              data-workflow-progress
              className="hidden lg:block absolute left-0 top-6 h-px origin-left bg-gradient-to-r from-brand/80 via-gold/60 to-white/40"
              style={{ width: '100%' }}
              aria-hidden="true"
            />

            <div className="workflow-scroll__mobile-stack">
              <div ref={trackRef} className="workflow-scroll__track relative z-10">
                {steps.map((step, index) => (
                  <TiltCard
                    key={`${step.title}-${index}`}
                    className="h-full"
                    tone={step.accent ?? (index % 2 === 0 ? 'emerald' : 'gold')}
                    tilt={8}
                    scale={1.01}
                    glare
                  >
                    <article
                      data-workflow-card
                      className="workflow-scroll__step h-full p-6 md:p-7"
                      style={{ background: 'var(--bg-elevated)' }}
                    >
                      <div className="workflow-scroll__accent" data-accent={step.accent ?? (index % 2 === 0 ? 'emerald' : 'gold')} aria-hidden="true" />

                      <div className="relative z-10 pl-4">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <span className="inline-flex items-center gap-2 text-[0.65rem] font-extrabold uppercase tracking-[0.28em]" style={{ color: 'var(--gold)' }}>
                            <span className="w-5 h-5 rounded-full flex items-center justify-center bg-white/8 text-white/90 text-[0.62rem]">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            {step.kicker ?? 'Story step'}
                          </span>
                          {step.metric ? (
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.7rem] font-bold text-white/65">
                              {step.metric}
                            </span>
                          ) : null}
                        </div>

                        <h3 className="font-serif text-2xl md:text-[2rem] font-bold text-white leading-tight">
                          {step.title}
                        </h3>

                        <p className="mt-4 text-[0.98rem] leading-7" style={{ color: 'var(--white-55)' }}>
                          {step.body}
                        </p>
                      </div>
                    </article>
                  </TiltCard>
                ))}
              </div>
            </div>

            {note ? (
              <p className="mt-5 text-sm md:text-base italic text-center" style={{ color: 'var(--white-40)' }}>
                {note}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
