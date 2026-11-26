/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — founder 2026-11-26: "exact replication". The design's field card ("तुमचं शेत · प्लॉट",
 * `.field` + its `field` canvas): his plot in perspective — sky, sun, a low hill, the ground, six trellis rows with their
 * posts. Drawn here as ONE static SVG (no canvas, no animation loop: light for old phones, P11), in the design's own
 * geometry (`P(nx, z)`: a 340 x 128 view, the horizon at 30%).
 *
 * BARE UNTIL THE PARSE (P4): while he speaks nothing is understood, so the field is the design's empty one. Given a
 * `scene` built from the real parse (`fieldSceneOf`), it draws only what was parsed: workers (his stated count, capped),
 * a sprayer and mist for a spray, blue drip lines for watering, a tractor for a machine, vines for the work done — and the
 * ground turns green with how much was drawn.
 */
import React from 'react';
import { type FieldScene, sceneCount } from './fieldScene';

const W = 340;
const H = 128;
const HY = H * 0.3;
const P = (nx: number, z: number) => ({ x: W / 2 + (nx * W * 0.6) / z, y: HY + (H - HY) / z, s: 1 / z });
const ROWS = [-1.15, -0.69, -0.23, 0.23, 0.69, 1.15];
const POSTS = [1, 1.4, 2, 2.8, 3.9, 5.5];
const WORKER_COLOURS = ['#2D7FF9', '#E5484D', '#F08A24', '#7C3AED', '#1E9E5A', '#0E8F96'];
const n1 = (v: number) => Number(v.toFixed(1));
/** The design's `mixc`: a hex colour between two, k 0..1. */
const mix = (a: string, b: string, k: number): string => {
    const pa = a.match(/\w\w/g)!.map(h => parseInt(h, 16));
    const pb = b.match(/\w\w/g)!.map(h => parseInt(h, 16));
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
};
const HILL = (() => {
    let d = `M0 ${n1(HY + 2)}`;
    for (let x = 0; x <= W; x += 10) d += ` L${x} ${n1(HY - 4 - 3.5 * Math.sin(x * 0.035) - 2.5 * Math.sin(x * 0.013 + 1))}`;
    return `${d} L${W} ${n1(HY + 2)} Z`;
})();
/** Fixed mist puffs (the design's 40 random ones, made repeatable). */
const MIST = Array.from({ length: 28 }, (_, i) => ({ x: ((i * 37) % 100) / 100, z: 1.3 + ((i * 53) % 30) / 10, r: 4 + ((i * 29) % 7) }));

/** One worker (the design's `figure`): shadow, body, face, white turban. */
const Figure: React.FC<{ x: number; y: number; s: number; c: string; testId?: string }> = ({ x, y, s, c, testId = 'field-worker' }) => {
    const h = 30 * s;
    return (
        <g transform={`translate(${n1(x)} ${n1(y)})`} data-testid={testId}>
            <ellipse cx="0" cy="0" rx={n1(h * 0.32)} ry={n1(h * 0.08)} fill="rgba(0,0,0,.12)" />
            <path d={`M${n1(-h * 0.22)} 0 Q${n1(-h * 0.26)} ${n1(-h * 0.62)} 0 ${n1(-h * 0.66)} Q${n1(h * 0.26)} ${n1(-h * 0.62)} ${n1(h * 0.22)} 0 Z`} fill={c} />
            <circle cx="0" cy={n1(-h * 0.8)} r={n1(h * 0.15)} fill="#E8B98A" />
            <ellipse cx="0" cy={n1(-h * 0.92)} rx={n1(h * 0.17)} ry={n1(h * 0.07)} fill="#fff" />
        </g>
    );
};

const Scene: React.FC<{ scene: FieldScene }> = ({ scene }) => {
    const tractor = P(0.8, 3.3);
    const ts = tractor.s * 2.2;
    const sprayer = P(0.45, 2.4);
    return (
        <>
            {scene.drip && ROWS.map(nx => {
                const a = P(nx, 1); const b = P(nx, 7.5);
                return (
                    <g key={`d${nx}`} data-testid="field-drip">
                        <line x1={n1(a.x)} y1={n1(a.y)} x2={n1(b.x)} y2={n1(b.y)} stroke="rgba(45,127,249,.7)" strokeWidth="2" />
                        {[1.6, 2.6, 4].map(z => { const q = P(nx, z); return <circle key={z} cx={n1(q.x)} cy={n1(q.y - 3 * q.s)} r={n1(1.7 * q.s + 0.6)} fill="rgba(45,127,249,.6)" />; })}
                    </g>
                );
            })}
            {scene.vines && ROWS.map((nx, ri) => {
                const leaves: React.ReactNode[] = [];
                for (let z = 1.05; z < 7.4; z += 0.22 * z) {
                    const q = P(nx, z);
                    leaves.push(<ellipse key={z} cx={n1(q.x)} cy={n1(q.y - 13 * q.s)} rx={n1(8 * q.s)} ry={n1(6.5 * q.s)} fill={Math.floor(z * 7 + ri) % 3 === 0 ? '#3FA35F' : '#2F8F50'} />);
                }
                return <g key={`v${nx}`} data-testid="field-vines">{leaves}</g>;
            })}
            {scene.spray && (
                <g data-testid="field-spray">
                    {MIST.map((m, i) => { const q = P(-1.2 + m.x * 2.4, m.z); return <circle key={i} cx={n1(q.x)} cy={n1(q.y - 22 * q.s)} r={n1(m.r * q.s * 1.6)} fill="rgba(200,240,236,.35)" />; })}
                    <g transform={`translate(${n1(sprayer.x)} ${n1(sprayer.y)})`}>
                        <rect x={n1(-11 * sprayer.s)} y={n1(-22 * sprayer.s)} width={n1(7 * sprayer.s)} height={n1(11 * sprayer.s)} rx={n1(2 * sprayer.s)} fill="#F2C94C" stroke="#8A6400" strokeWidth=".8" />
                        <path d={`M${n1(4 * sprayer.s)} ${n1(-16 * sprayer.s)} L${n1(18 * sprayer.s)} ${n1(-24 * sprayer.s)}`} stroke="#44403C" strokeWidth="1.2" strokeLinecap="round" />
                        <path d={`M${n1(18 * sprayer.s)} ${n1(-24 * sprayer.s)} l${n1(10 * sprayer.s)} ${n1(-5 * sprayer.s)} l${n1(1 * sprayer.s)} ${n1(9 * sprayer.s)} Z`} fill="rgba(160,225,220,.7)" />
                    </g>
                    <Figure x={sprayer.x} y={sprayer.y} s={sprayer.s * 1.25} c="#0E8F96" testId="field-sprayer" />
                </g>
            )}
            {scene.tractor && (
                <g data-testid="field-tractor" transform={`translate(${n1(tractor.x)} ${n1(tractor.y)})`}>
                    <ellipse cx="0" cy="0" rx={n1(16 * ts)} ry={n1(3 * ts)} fill="rgba(0,0,0,.12)" />
                    <rect x={n1(-12 * ts)} y={n1(-12 * ts)} width={n1(18 * ts)} height={n1(8 * ts)} fill="#1E9E5A" />
                    <rect x={n1(-4 * ts)} y={n1(-20 * ts)} width={n1(9 * ts)} height={n1(9 * ts)} fill="#1E9E5A" />
                    <rect x={n1(-2 * ts)} y={n1(-18 * ts)} width={n1(5 * ts)} height={n1(4 * ts)} fill="#DDF3E4" />
                    <circle cx={n1(-8 * ts)} cy={n1(-4 * ts)} r={n1(5 * ts)} fill="#24302A" />
                    <circle cx={n1(7 * ts)} cy={n1(-3 * ts)} r={n1(3.4 * ts)} fill="#24302A" />
                </g>
            )}
            {Array.from({ length: scene.workers }, (_, j) => {
                const n = scene.workers;
                const q = P(-0.95 + (n === 1 ? 0.95 : j * (1.9 / (n - 1))), 1.55 + (j % 2) * 0.55);
                return <Figure key={j} x={q.x} y={q.y} s={q.s * 1.25} c={WORKER_COLOURS[j % WORKER_COLOURS.length]} />;
            })}
        </>
    );
};

export interface FieldCardProps {
    /** "तुमचं शेत · प्लॉट २" */
    title: string;
    /** What the parse understood; absent = the bare field (always, while he is speaking). */
    scene?: FieldScene | null;
    /** "शेतात भरलं: N" — shown only with a scene that drew something. */
    countLabel?: (n: number) => string;
}

export const FieldCard: React.FC<FieldCardProps> = ({ title, scene, countLabel }) => {
    const count = scene ? sceneCount(scene) : 0;
    const k = Math.min(1, count / 5);
    const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    return (
        <div data-testid="field-card" data-filled={count > 0 ? 'yes' : 'no'}
            className="relative h-[128px] w-full overflow-hidden rounded-[18px] border border-[#DDE3DA]" style={{ background: 'linear-gradient(#FFFBEA,#F6F1DF)' }}>
            <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 block h-full w-full">
                <defs>
                    <linearGradient id={`vfSky${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF8DF" /><stop offset="1" stopColor={mix('F7EBC6', 'EAF6D8', k)} /></linearGradient>
                    <linearGradient id={`vfGround${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={mix('EADFC2', 'CBE7B2', k)} /><stop offset="1" stopColor={mix('DBCDA9', '95CC7A', k)} /></linearGradient>
                    <radialGradient id={`vfSun${id}`}><stop offset="0" stopColor="rgba(255,214,102,.5)" /><stop offset="1" stopColor="rgba(255,214,102,0)" /></radialGradient>
                </defs>
                <rect x="0" y="0" width={W} height={n1(HY + 1)} fill={`url(#vfSky${id})`} />
                <circle cx={n1(W * 0.84)} cy={n1(HY - 4)} r="42" fill={`url(#vfSun${id})`} />
                <path d={HILL} fill={mix('DCD2B4', 'A9D38E', k)} />
                <rect x="0" y={n1(HY)} width={W} height={n1(H - HY)} fill={`url(#vfGround${id})`} />
                {ROWS.map(nx => {
                    const a = P(nx, 1); const b = P(nx, 7.5);
                    return (
                        <g key={nx}>
                            <line x1={n1(a.x)} y1={n1(a.y)} x2={n1(b.x)} y2={n1(b.y)} stroke={`rgba(140,118,76,${(0.42 - 0.15 * k).toFixed(2)})`} strokeWidth="1.1" strokeDasharray="3 4" />
                            {POSTS.map(z => { const q = P(nx, z); return <rect key={z} x={n1(q.x - 1.4 * q.s)} y={n1(q.y - 10 * q.s)} width={n1(2.8 * q.s + 0.6)} height={n1(10 * q.s)} fill="rgba(120,98,60,.5)" />; })}
                        </g>
                    );
                })}
                {scene && count > 0 && <Scene scene={scene} />}
            </svg>
            <span className="absolute left-2.5 top-[7px] z-[2] max-w-[62%] truncate rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-extrabold text-[#3F5A48]" data-testid="field-title">{title}</span>
            {count > 0 && countLabel && (
                <span className="absolute right-2.5 top-[7px] z-[2] rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-extrabold text-[#0F6B3A]" data-testid="field-count">{countLabel(count)}</span>
            )}
        </div>
    );
};

export default FieldCard;
