import { useEffect, useRef } from 'react';

type ParticleType = 'dust' | 'pollen' | 'leaf' | 'seed';

interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  type: ParticleType;
  rotation: number;
  rotSpeed: number;
  idx: number;
}

const MAX_PARTICLES = 180;

function makeParticle(w: number, h: number, i: number): Particle {
  const r = Math.random();
  const type: ParticleType = r < 0.45 ? 'dust' : r < 0.65 ? 'pollen' : r < 0.82 ? 'leaf' : 'seed';
  return {
    x: Math.random() * w * 1.2,
    y: Math.random() * h,
    size: type === 'dust' ? 1 + Math.random() * 2
        : type === 'pollen' ? 2 + Math.random() * 3
        : type === 'leaf' ? 8 + Math.random() * 8
        : 4 + Math.random() * 4,
    opacity: type === 'dust' ? 0.03 + Math.random() * 0.05
           : type === 'pollen' ? 0.06 + Math.random() * 0.06
           : 0.05 + Math.random() * 0.06,
    speed: 0.4 + Math.random() * 0.8,
    type,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.04,
    idx: i,
  };
}

export default function WindCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;
    // Skip on touch devices and reduced-motion
    if ('ontouchstart' in window) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    window.addEventListener('resize', onResize);

    // Wind state
    let windSpeed = 0.3;
    let lastScrollY = window.scrollY;
    const velHistory = [0, 0, 0];

    const onScroll = () => {
      const cur = window.scrollY;
      const delta = Math.abs(cur - lastScrollY);
      velHistory.push(delta);
      velHistory.shift();
      const avg = (velHistory[0] + velHistory[1] + velHistory[2]) / 3;
      windSpeed = Math.min(1.0, 0.3 + avg * 0.012);
      lastScrollY = cur;
      window.dispatchEvent(new CustomEvent('windspeed', { detail: windSpeed }));
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Particles
    const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, (_, i) =>
      makeParticle(w, h, i)
    );

    // Performance kill-switch
    const frameTimes: number[] = [];
    let slowCount = 0;
    let killed = false;
    let lastT = performance.now();
    let rafId = 0;

    function drawParticle(p: Particle) {
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.type === 'dust') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,140,80,0.8)';
        ctx.fill();
      } else if (p.type === 'pollen') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(245,158,11,0.5)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = 'rgba(245,158,11,0.9)';
        ctx.fill();
      } else if (p.type === 'leaf') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(74,222,128,0.8)';
        ctx.fill();
        // midrib
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 0);
        ctx.strokeStyle = 'rgba(22,163,74,0.4)';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      } else {
        // seed
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(217,119,6,0.85)';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(p.size * 2.2, -p.size * 0.8);
        ctx.strokeStyle = 'rgba(217,119,6,0.3)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.restore();
    }

    function frame(now: number) {
      if (killed) return;
      const dt = now - lastT;
      if (dt < 33) { rafId = requestAnimationFrame(frame); return; }

      // Performance check
      frameTimes.push(dt);
      if (frameTimes.length > 5) frameTimes.shift();
      if (frameTimes.length === 5) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / 5;
        if (avg > 50) { slowCount++; } else { slowCount = 0; }
        if (slowCount >= 5) {
          killed = true;
          canvas.style.display = 'none';
          document.body.classList.add('wind-css-only');
          return;
        }
      }
      lastT = now;

      ctx.clearRect(0, 0, w, h);
      const t = now * 0.001;

      particles.forEach((p, i) => {
        p.x -= (p.speed * windSpeed * dt) / 16;
        p.y += Math.sin(t + i * 0.28) * 0.25 * windSpeed;
        p.rotation += p.rotSpeed * windSpeed;

        if (p.x < -p.size * 3) {
          Object.assign(p, makeParticle(w, h, i));
          p.x = w + p.size;
        }
        if (p.y < -20) p.y = h + 10;
        if (p.y > h + 20) p.y = -10;

        drawParticle(p);
      });

      // Gradually return to base wind speed
      windSpeed += (0.3 - windSpeed) * 0.018;

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="wind-canvas"
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
}
