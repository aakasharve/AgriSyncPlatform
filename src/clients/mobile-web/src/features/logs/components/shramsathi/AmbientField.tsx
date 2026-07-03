import React, { useEffect, useRef } from 'react';

/**
 * AmbientField — a warm, slowly-drifting light field that fills the "dead air"
 * of the voice-parse wait so the screen never reads as frozen.
 *
 * Design contract (founder-locked palette, cofounder mode):
 *  - Flowing emerald → amber → cream, VERY low saturation, warm; NEVER red/alarm.
 *  - Fine film grain + a few gentle floating motes on Canvas (grain is the reason
 *    we use Canvas over layered CSS — CSS can't do cheap per-pixel grain).
 *  - GPU/CPU cheap: small offscreen grain tile scaled up, ~30fps cap, 2G budget.
 *  - prefers-reduced-motion: paints ONE static soft gradient frame, no rAF loop.
 *
 * Purely decorative (aria-hidden). Sits behind the character, clipped by the
 * parent's rounded container.
 */

interface Mote {
    x: number;
    y: number;
    r: number;
    drift: number;
    phase: number;
    speed: number;
}

const AmbientField: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const reduced =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Cap DPR at 1.5 — grain hides low-res, and this keeps the fill cheap on 2G-class phones.
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        let width = 0;
        let height = 0;

        // Warm, low-saturation palette blobs (emerald / amber / cream). No reds.
        const blobs = [
            { hue: 152, sat: 42, light: 78, ampX: 0.22, ampY: 0.16, baseX: 0.28, baseY: 0.34, sp: 0.11 },
            { hue: 40, sat: 58, light: 82, ampX: 0.20, ampY: 0.18, baseX: 0.74, baseY: 0.30, sp: 0.09 },
            { hue: 48, sat: 30, light: 92, ampX: 0.18, ampY: 0.22, baseX: 0.52, baseY: 0.72, sp: 0.13 },
        ];

        let motes: Mote[] = [];

        // Small, reusable grain tile — drawn once, blitted with random offset each frame.
        const grainTileSize = 96;
        const grainCanvas = document.createElement('canvas');
        grainCanvas.width = grainTileSize;
        grainCanvas.height = grainTileSize;
        const grainCtx = grainCanvas.getContext('2d');
        const buildGrainTile = () => {
            if (!grainCtx) return;
            const img = grainCtx.createImageData(grainTileSize, grainTileSize);
            for (let i = 0; i < img.data.length; i += 4) {
                // Warm-ish monochrome speckle; low alpha so it only whispers over the gradient.
                const v = 200 + Math.random() * 55;
                img.data[i] = v;
                img.data[i + 1] = v - 6;
                img.data[i + 2] = v - 18;
                img.data[i + 3] = Math.random() * 22; // 0–22 alpha
            }
            grainCtx.putImageData(img, 0, 0);
        };
        buildGrainTile();

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, rect.width);
            height = Math.max(1, rect.height);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // (Re)seed motes relative to size.
            const count = reduced ? 0 : 7;
            motes = Array.from({ length: count }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                r: 1.4 + Math.random() * 2.6,
                drift: 6 + Math.random() * 14,
                phase: Math.random() * Math.PI * 2,
                speed: 0.15 + Math.random() * 0.25,
            }));
        };

        const paintGradient = (t: number) => {
            ctx.clearRect(0, 0, width, height);
            // Warm cream base wash so nothing ever looks cold/grey.
            ctx.fillStyle = '#FBF7EE';
            ctx.fillRect(0, 0, width, height);

            ctx.globalCompositeOperation = 'source-over';
            for (const b of blobs) {
                const cx = (b.baseX + Math.sin(t * b.sp + b.hue) * b.ampX) * width;
                const cy = (b.baseY + Math.cos(t * b.sp * 0.8 + b.hue) * b.ampY) * height;
                const rad = Math.max(width, height) * 0.7;
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
                grad.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0.55)`);
                grad.addColorStop(0.55, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0.22)`);
                grad.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, width, height);
            }
        };

        const paintMotes = (t: number) => {
            for (const m of motes) {
                const mx = m.x + Math.sin(t * m.speed + m.phase) * m.drift;
                const my = m.y - ((t * 8 * m.speed) % (height + 40)) + 20;
                const yy = ((my % (height + 40)) + (height + 40)) % (height + 40) - 20;
                const glow = 0.10 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.9 + m.phase));
                ctx.beginPath();
                ctx.arc(mx, yy, m.r, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(46, 60%, 88%, ${glow})`;
                ctx.fill();
            }
        };

        const paintGrain = () => {
            const ox = Math.floor(Math.random() * grainTileSize);
            const oy = Math.floor(Math.random() * grainTileSize);
            ctx.save();
            ctx.globalAlpha = 0.9;
            for (let y = -oy; y < height; y += grainTileSize) {
                for (let x = -ox; x < width; x += grainTileSize) {
                    ctx.drawImage(grainCanvas, x, y);
                }
            }
            ctx.restore();
        };

        resize();

        let raf = 0;
        let last = 0;

        if (reduced) {
            // Static soft gradient — one frame, no motion, no motes, light grain for texture.
            paintGradient(1.4);
            paintGrain();
            const onResize = () => {
                resize();
                paintGradient(1.4);
                paintGrain();
            };
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }

        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            // ~30fps cap — plenty for a slow drift, and kind to 2G-class hardware.
            if (now - last < 33) return;
            last = now;
            const t = now / 1000;
            paintGradient(t);
            paintMotes(t);
            paintGrain();
        };
        raf = requestAnimationFrame(loop);

        const onResize = () => resize();
        window.addEventListener('resize', onResize);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
        />
    );
};

export default AmbientField;
