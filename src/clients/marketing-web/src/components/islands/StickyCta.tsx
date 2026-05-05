import { useEffect, useState } from 'react';

export default function StickyCta() {
  const [isDesktop, setIsDesktop] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);

    const onMqChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onMqChange);

    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    const cta = document.querySelector<HTMLElement>('[data-scene="cta"]');

    if (!hero || !cta) {
      return () => mq.removeEventListener('change', onMqChange);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target === hero) {
            setVisible(!entry.isIntersecting);
          }
          if (entry.target === cta && entry.isIntersecting) {
            setVisible(false);
          }
        });
      },
      { threshold: 0.05 },
    );

    observer.observe(hero);
    observer.observe(cta);

    return () => {
      mq.removeEventListener('change', onMqChange);
      observer.disconnect();
    };
  }, []);

  if (isDesktop) return null;

  return (
    <a
      href="#cta"
      aria-label="Quick join — go to waitlist"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: '52px',
        background: 'var(--brand)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        fontWeight: 800,
        fontSize: '0.95rem',
        textDecoration: 'none',
        letterSpacing: '0.01em',
        transition: 'transform 0.3s ease-out',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
      }}
    >
      Join the waitlist — free →
    </a>
  );
}
