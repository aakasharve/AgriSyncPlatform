import { useEffect, useRef } from 'react';

export default function HeroVideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let rafId: number;

    const fadeTo = (targetOpacity: number, durationMs: number, onDone?: () => void) => {
      cancelAnimationFrame(rafId);
      const startOpacity = parseFloat(video.style.opacity || '0');
      const delta = targetOpacity - startOpacity;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / durationMs, 1);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        video.style.opacity = String(startOpacity + delta * eased);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          onDone?.();
        }
      };
      rafId = requestAnimationFrame(tick);
    };

    const handleTimeUpdate = () => {
      if (!video.duration) return;
      const remaining = video.duration - video.currentTime;
      // Begin fade-out 0.65s before the end
      if (remaining <= 0.65 && parseFloat(video.style.opacity || '1') > 0.01) {
        fadeTo(0, 550);
      }
    };

    const handleEnded = () => {
      video.style.opacity = '0';
      cancelAnimationFrame(rafId);
      setTimeout(() => {
        video.currentTime = 0;
        video.play().catch(() => {});
        fadeTo(1, 600);
      }, 120);
    };

    const startPlayback = () => {
      video.style.opacity = '0';
      video.play().catch(() => {});
      fadeTo(1, 600);
    };

    video.addEventListener('canplay', startPlayback, { once: true });
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      cancelAnimationFrame(rafId);
      video.removeEventListener('canplay', startPlayback);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src="/videos/hero-bg.mp4"
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'center 60%',
        opacity: 0,
        zIndex: 0,
        willChange: 'opacity',
      }}
    />
  );
}
