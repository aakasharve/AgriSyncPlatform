import { useEffect, useMemo, useState } from 'react';

const SECTIONS = [
  { id: 'hero', en: 'Start', mr: 'सुरुवात', short: '01' },
  { id: 'problem-hit', en: 'Problem', mr: 'समस्या', short: '02' },
  { id: 'before-after', en: 'Compare', mr: 'तफावत', short: '03' },
  { id: 'workflow', en: 'Voice to Record', mr: 'आवाज ते नोंद', short: '04' },
  { id: 'clarity', en: 'Clarity', mr: 'स्पष्टता', short: '05' },
  { id: 'value-ladder', en: 'Value', mr: 'मूल्य', short: '06' },
  { id: 'participation', en: 'Your Part', mr: 'तुमचा भाग', short: '07' },
  { id: 'trust', en: 'Trust', mr: 'विश्वास', short: '08' },
  { id: 'legacy', en: 'Legacy', mr: 'वारसा', short: '09' },
  { id: 'cta', en: 'Join', mr: 'सुरू करा', short: '10' },
] as const;

export default function PloughNav() {
  const [active, setActive] = useState('hero');
  const [hovered, setHovered] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const lang = typeof document !== 'undefined' && document.documentElement.lang === 'mr' ? 'mr' : 'en';

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1180px)');
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target instanceof HTMLElement && visible.target.dataset.scene) {
          setActive(visible.target.dataset.scene);
        }
      },
      {
        threshold: [0.2, 0.4, 0.6],
        rootMargin: '-18% 0px -38% 0px',
      },
    );

    SECTIONS.forEach(({ id }) => {
      const section = document.querySelector<HTMLElement>(`[data-scene="${id}"]`);
      if (section) {
        observer.observe(section);
      }
    });

    return () => {
      media.removeEventListener('change', sync);
      observer.disconnect();
    };
  }, []);

  const items = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        label: lang === 'mr' ? section.mr : section.en,
      })),
    [lang],
  );

  const scrollToSection = (id: string) => {
    const section = document.querySelector<HTMLElement>(`[data-scene="${id}"]`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isDesktop) {
    return null;
  }

  return (
    <>
      <style>{`
        .story-rail {
          position: fixed;
          left: 1.2rem;
          top: 50%;
          transform: translateY(-50%);
          z-index: 42;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.8rem 0.55rem;
          border-radius: 1.4rem;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(19, 50, 36, 0.08);
          backdrop-filter: blur(16px);
          box-shadow: 0 16px 50px rgba(14, 30, 18, 0.16);
        }

        .story-rail__button {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          min-width: 2.25rem;
          padding: 0.45rem;
          border: 0;
          background: transparent;
          cursor: pointer;
          border-radius: 999px;
          transition: transform 180ms ease, background 180ms ease;
        }

        .story-rail__button:hover {
          transform: translateX(2px);
          background: rgba(16,185,129,0.06);
        }

        .story-rail__dot {
          position: relative;
          width: 1.15rem;
          height: 1.15rem;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: rgba(19, 50, 36, 0.46);
          border: 1px solid rgba(19, 50, 36, 0.12);
          background: rgba(255,255,255,0.92);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
        }

        .story-rail__button[data-active='true'] .story-rail__dot {
          color: white;
          border-color: rgba(16,185,129,0.2);
          background: linear-gradient(135deg, #10b981, #0f7b58);
          box-shadow: 0 0 0 4px rgba(16,185,129,0.12);
        }

        .story-rail__line {
          position: absolute;
          left: 50%;
          top: calc(100% + 0.18rem);
          width: 1px;
          height: 0.9rem;
          transform: translateX(-50%);
          background: linear-gradient(180deg, rgba(16,185,129,0.2), rgba(19,50,36,0.08));
        }

        .story-rail__label {
          position: absolute;
          left: calc(100% + 0.65rem);
          top: 50%;
          transform: translateY(-50%);
          white-space: nowrap;
          border-radius: 999px;
          padding: 0.5rem 0.8rem;
          background: rgba(12, 33, 21, 0.94);
          color: rgba(255,255,255,0.92);
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          box-shadow: 0 12px 32px rgba(0,0,0,0.22);
        }
      `}</style>

      <nav className="story-rail" aria-label="Story stages">
        {items.map((item, index) => {
          const showLabel = hovered === item.id || active === item.id;

          return (
            <button
              key={item.id}
              type="button"
              className="story-rail__button"
              data-active={active === item.id}
              aria-current={active === item.id}
              aria-label={item.label}
              onClick={() => scrollToSection(item.id)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="story-rail__dot">{item.short}</span>
              {index < items.length - 1 ? <span className="story-rail__line" aria-hidden="true" /> : null}
              {showLabel ? <span className="story-rail__label">{item.label}</span> : null}
            </button>
          );
        })}
      </nav>
    </>
  );
}
