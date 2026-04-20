// WaterChannel.tsx
// Right-margin illustrated water channel — desktop only (≥1280px)
// Stone banks, flowing water, floating elements (marigold, neem leaf, paper boat)
// Section weirs/gates open with IntersectionObserver on [data-scene] sections

import { useEffect, useRef, useState } from 'react';

// Sections to observe for gate opening (ordered top-to-bottom)
const SCENE_IDS = ['hero', 'guided', 'problem-hit', 'before-after', 'workflow', 'clarity', 'value-ladder', 'participation', 'trust', 'legacy', 'cta'];

interface Gate {
  sceneId: string;
  topPct: number;
  open: boolean;
}

export default function WaterChannel() {
  const [gates, setGates] = useState<Gate[]>(() =>
    SCENE_IDS.map((id, i) => ({
      sceneId: id,
      topPct: (i / SCENE_IDS.length) * 100,
      open: false,
    }))
  );
  const [flowDur, setFlowDur] = useState(12);
  const channelRef = useRef<HTMLDivElement>(null);

  // Update flow speed from wind events
  useEffect(() => {
    const handler = (e: Event) => {
      const speed = (e as CustomEvent<number>).detail;
      setFlowDur(12 / (speed + 0.5));
    };
    window.addEventListener('windspeed', handler);
    return () => window.removeEventListener('windspeed', handler);
  }, []);

  // Observe sections, open gates as they enter viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const scene = entry.target.getAttribute('data-scene');
          if (!scene) return;
          setGates(prev =>
            prev.map(g => g.sceneId === scene ? { ...g, open: true } : g)
          );
        });
      },
      { threshold: 0.25 }
    );
    document.querySelectorAll('[data-scene]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={channelRef}
      id="water-channel"
      aria-hidden="true"
    >
      {/* Stone banks */}
      <div className="water-channel-banks" />

      {/* Flowing water */}
      <div
        className="water-channel-fill"
        style={{ animationDuration: `${flowDur}s` }}
      />

      {/* Section weirs — brown horizontal bars that slide up when gate opens */}
      {gates.map(gate => (
        <div
          key={gate.sceneId}
          className="water-gate"
          style={{
            top: `${gate.topPct}%`,
            transform: gate.open ? 'translateY(-6px)' : 'translateY(0)',
            opacity: gate.open ? 0.4 : 0.85,
          }}
        />
      ))}

      {/* Floating marigold dots */}
      {[0, 1, 2, 3].map(i => (
        <div
          key={`marigold-${i}`}
          className="channel-float channel-marigold"
          style={{
            animationDuration: `${8 + i * 2.5}s`,
            animationDelay: `${i * 3.2}s`,
          }}
        />
      ))}

      {/* Neem leaf silhouettes */}
      {[0, 1].map(i => (
        <div
          key={`neem-${i}`}
          className="channel-float channel-neem"
          style={{
            animationDuration: `${11 + i * 3}s`,
            animationDelay: `${i * 5.5 + 1}s`,
          }}
        />
      ))}

      {/* Paper boat — once per section pass */}
      <div
        className="channel-float channel-boat"
        style={{
          animationDuration: '22s',
          animationDelay: '6s',
        }}
      >
        <svg viewBox="0 0 16 10" fill="none" width="14" height="9" aria-hidden="true">
          <path d="M1 9 L8 1 L15 9 Z" fill="white" opacity="0.85" />
          <path d="M1 9 L15 9" stroke="rgba(14,165,233,0.4)" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}
