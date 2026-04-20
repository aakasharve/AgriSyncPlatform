import { useEffect, useRef, useState } from 'react';
import TiltCard from './TiltCard';

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  location?: string;
  metric?: string;
  initials?: string;
}

interface TestimonialCarouselProps {
  eyebrow?: string;
  title: string;
  description?: string;
  testimonials: Testimonial[];
  intervalMs?: number;
  className?: string;
}

export default function TestimonialCarousel({
  eyebrow = 'Trust',
  title,
  description,
  testimonials,
  intervalMs = 5200,
  className = '',
}: TestimonialCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeIndexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || testimonials.length === 0) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const syncActiveIndex = () => {
      const containerCenter = scroller.scrollLeft + scroller.clientWidth / 2;
      let nextIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      slideRefs.current.forEach((slide, index) => {
        if (!slide) return;
        const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
        const distance = Math.abs(containerCenter - slideCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextIndex = index;
        }
      });

      setActiveIndex(nextIndex);
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        syncActiveIndex();
      });
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    syncActiveIndex();

    let timer = 0;
    if (!reducedMotion && !paused && testimonials.length > 1) {
      timer = window.setInterval(() => {
        const nextIndex = (activeIndexRef.current + 1) % testimonials.length;
        const nextSlide = slideRefs.current[nextIndex];
        if (nextSlide) {
          nextSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        setActiveIndex(nextIndex);
      }, intervalMs);
    }

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs, paused, testimonials.length]);

  const goToIndex = (index: number) => {
    const slide = slideRefs.current[index];
    if (!slide) return;
    slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    setActiveIndex(index);
  };

  return (
    <>
      <style>{`
        .testimonial-carousel__scroller {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: min(86vw, 24rem);
          gap: 1rem;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scroll-padding-inline: 1rem;
          padding-bottom: 0.5rem;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .testimonial-carousel__scroller::-webkit-scrollbar {
          display: none;
        }

        .testimonial-carousel__slide {
          scroll-snap-align: center;
          min-height: 100%;
        }

        .testimonial-carousel__dots {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.5rem;
        }

        .testimonial-carousel__dot {
          width: 0.7rem;
          height: 0.7rem;
          border-radius: 999px;
          border: 1px solid rgba(19,50,36,0.14);
          background: rgba(19,50,36,0.12);
          transition: transform 180ms ease, background 180ms ease, width 180ms ease;
        }

        .testimonial-carousel__dot[aria-current='true'] {
          width: 1.6rem;
          background: linear-gradient(90deg, rgba(16,185,129,0.95), rgba(245,158,11,0.85));
          transform: translateY(-1px);
        }

        .testimonial-carousel__quote-mark {
          font-size: clamp(3rem, 6vw, 4.5rem);
          line-height: 0.8;
          color: rgba(148,97,45,0.14);
          position: absolute;
          top: 1rem;
          right: 1rem;
          user-select: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .testimonial-carousel__scroller {
            scroll-snap-type: none;
          }

          .testimonial-carousel__dot {
            transition: none;
          }
        }
      `}</style>

      <div className={`relative py-section-tight overflow-hidden ${className}`.trim()} style={{ background: '#F7F1E6' }}>
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse 55% 40% at 50% 18%, rgba(16,185,129,0.08) 0%, transparent 48%), radial-gradient(ellipse 40% 30% at 70% 72%, rgba(245,158,11,0.07) 0%, transparent 52%)',
          }}
        />

        <div className="relative z-10 max-w-site mx-auto px-5 md:px-8">
          <div className="max-w-2xl mx-auto text-center mb-8 md:mb-10">
            <span className="chapter-mark">{eyebrow}</span>
            <h2 className="font-serif text-[clamp(2rem,4.8vw,3.8rem)] font-bold tracking-tight" style={{ color: 'rgb(29,51,38)' }}>
              {title}
            </h2>
            {description ? (
              <p className="mt-4 text-[clamp(0.98rem,1.5vw,1.08rem)]" style={{ color: 'rgba(29,51,38,0.72)' }}>
                {description}
              </p>
            ) : null}
          </div>

          <div
            className="relative"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
          >
            <div
              ref={scrollerRef}
              className="testimonial-carousel__scroller"
              aria-roledescription="carousel"
              aria-label={title}
            >
              {testimonials.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  ref={(node) => {
                    slideRefs.current[index] = node;
                  }}
                  className="testimonial-carousel__slide"
                >
                  <TiltCard className="h-full" tone={index % 2 === 0 ? 'emerald' : 'gold'} tilt={7} scale={1.01}>
                    <article
                      className="relative h-full rounded-[1.5rem] p-6 md:p-7"
                      style={{ border: '1px solid rgba(19,50,36,0.08)', background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(247,241,230,0.96))' }}
                      aria-label={`${item.name}, ${item.role}`}
                    >
                      <div className="testimonial-carousel__quote-mark" aria-hidden="true">
                        "
                      </div>

                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold tracking-wide" style={{ border: '1px solid rgba(19,50,36,0.10)', background: 'rgba(19,50,36,0.05)', color: 'rgb(29,51,38)' }}>
                          {item.initials ?? item.name.slice(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <div className="text-sm font-bold" style={{ color: 'rgb(29,51,38)' }}>{item.name}</div>
                          <div className="text-sm" style={{ color: 'rgba(29,51,38,0.58)' }}>
                            {item.role}
                            {item.location ? `, ${item.location}` : ''}
                          </div>
                        </div>

                        {item.metric ? (
                          <div className="ml-auto rounded-full px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.24em]" style={{ border: '1px solid rgba(19,50,36,0.08)', background: 'rgba(148,97,45,0.08)', color: 'var(--gold)' }}>
                            {item.metric}
                          </div>
                        ) : null}
                      </div>

                      <p className="text-[1.03rem] leading-8" style={{ color: 'rgba(29,51,38,0.80)' }}>
                        {item.quote}
                      </p>
                    </article>
                  </TiltCard>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between gap-4">
              <div className="text-sm" style={{ color: 'rgba(29,51,38,0.58)' }} aria-live="polite">
                {testimonials[activeIndex]
                  ? `${testimonials[activeIndex].name} - ${testimonials[activeIndex].role}`
                  : ''}
              </div>

              <div className="testimonial-carousel__dots">
                {testimonials.map((item, index) => (
                  <button
                    key={`dot-${item.name}-${index}`}
                    type="button"
                    className="testimonial-carousel__dot"
                    aria-label={`Go to testimonial ${index + 1}`}
                    aria-current={index === activeIndex}
                    onClick={() => goToIndex(index)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
