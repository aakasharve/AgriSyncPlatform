import { useEffect, useState } from 'react';

export default function WellIndicator() {
  const [progress, setProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    setIsMobile(window.innerWidth < 1024);
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);

    const onScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const pct = maxScroll > 0 ? window.scrollY / maxScroll : 0;
      setProgress(pct);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  if (isMobile) return null;

  const ropeLength = (1 - progress) * 38;
  const waterLevel = progress; // 0 = empty, 1 = full
  // Water color shifts: empty=dark→full=sky blue tinted
  const waterR = Math.round(7 + waterLevel * 7);
  const waterG = Math.round(37 + waterLevel * 128);
  const waterB = Math.round(25 + waterLevel * 207);
  const waterColor = `rgb(${waterR},${waterG},${waterB})`;

  return (
    <div
      aria-hidden="true"
      title={`${Math.round(progress * 100)}% explored`}
      style={{
        position: 'fixed',
        right: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 40,
        userSelect: 'none',
      }}
    >
      <svg viewBox="0 0 64 100" width={64} height={100}>
        {/* Well outer ring */}
        <ellipse cx="32" cy="28" rx="28" ry="10" fill="none" stroke="#7c4a25" strokeWidth="3" />
        {/* Well walls */}
        <line x1="4" y1="28" x2="4" y2="72" stroke="#7c4a25" strokeWidth="2.5" />
        <line x1="60" y1="28" x2="60" y2="72" stroke="#7c4a25" strokeWidth="2.5" />
        {/* Well bottom ellipse */}
        <ellipse cx="32" cy="72" rx="28" ry="8" fill="none" stroke="#7c4a25" strokeWidth="2" />
        {/* Water fill (clip to well) */}
        <defs>
          <clipPath id="well-clip">
            <ellipse cx="32" cy="28" rx="26" ry="8" />
            <rect x="6" y="28" width="52" height="44" />
          </clipPath>
        </defs>
        {/* Water body */}
        <rect
          x="6"
          y={28 + (1 - waterLevel) * 44}
          width="52"
          height={waterLevel * 44}
          fill={waterColor}
          opacity="0.7"
          clipPath="url(#well-clip)"
        />
        {/* Water surface ripple */}
        <ellipse
          cx="32"
          cy={28 + (1 - waterLevel) * 44}
          rx="26"
          ry="5"
          fill={waterColor}
          opacity="0.5"
        />
        {/* Rope */}
        <line
          x1="32"
          y1="2"
          x2="32"
          y2={2 + ropeLength}
          stroke="#92400E"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        {/* Bucket */}
        <rect
          x="28"
          y={2 + ropeLength}
          width="8"
          height="7"
          rx="1"
          fill="#78350F"
          stroke="#3d1f08"
          strokeWidth="1"
        />
        {/* Crossbeam at top */}
        <line x1="2" y1="2" x2="62" y2="2" stroke="#7c4a25" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="2" r="2" fill="#3d1f08" />
      </svg>
    </div>
  );
}
