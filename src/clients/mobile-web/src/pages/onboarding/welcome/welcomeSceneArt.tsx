/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Illustration pieces for the welcome voice story. Drawn shapes, not icon
 * tiles: rain that falls, a price line that draws itself, a stamp that lands,
 * a tree that grows. Every piece is static markup; the story's frame loop adds
 * `on` to any element whose `data-at` second has been reached (and removes it
 * when the farmer rewinds), so the art stays in step with the voice without
 * re-rendering React sixty times a second.
 *
 * `ws-it`  = hidden until its moment, then pops in.
 * `ws-tap` = the farmer can tap it for a small bounce (pure delight, no state).
 */
import React from 'react';

type At = { at: number };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/* ---------- people & brand ---------- */

export const Farmer: React.FC<{ pose: 'welcome' | 'point'; height?: number }> = ({ pose, height = 250 }) => (
    <img
        className="ws-farmer ws-tap"
        src={pose === 'welcome' ? '/brand/farmer-welcome.webp' : '/brand/farmer-point.webp'}
        alt=""
        style={{ height }}
        draggable={false}
    />
);

export const BrandSeal: React.FC<{ size?: number; burstAt?: number; rays?: boolean }> = ({ size = 150, burstAt, rays = true }) => (
    <div className="ws-seal ws-tap" style={{ width: size, height: size }}>
        {rays && <div className="ws-rays" />}
        <div className="ws-seal-face">
            <img src="/brand/logo-mark.webp" alt="" draggable={false} />
        </div>
        {burstAt !== undefined && <div className="ws-ring-burst" data-at={burstAt} />}
    </div>
);

export const Confetti: React.FC<At> = ({ at }) => (
    <div className="ws-confetti" data-at={at} aria-hidden="true">
        {range(22).map((i) => {
            const a = (i / 22) * Math.PI * 2 + (i % 2) * 0.25;
            const d = 120 + (i % 4) * 28;
            const colors = ['#10B981', '#FBBF24', '#34D399', '#F59E0B', '#6EE7B7', '#EAB308'];
            return (
                <i
                    key={i}
                    style={{
                        ['--dx' as string]: `${Math.cos(a) * d}px`,
                        ['--dy' as string]: `${Math.sin(a) * d * 0.85}px`,
                        ['--r' as string]: `${(i % 2 ? 1 : -1) * (180 + i * 22)}deg`,
                        ['--c' as string]: colors[i % colors.length],
                    }}
                />
            );
        })}
    </div>
);

export const FloatingLeaves: React.FC = () => (
    <div className="ws-leaves" aria-hidden="true">
        {range(5).map((i) => (
            <svg key={i} viewBox="0 0 24 24" style={{ ['--i' as string]: i }}>
                <path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z" fill="#34D399" />
                <path d="M4 20 14 10" stroke="#047857" strokeWidth="1.5" />
            </svg>
        ))}
    </div>
);

export const ThinkDots: React.FC<At> = ({ at }) => (
    <div className="ws-think ws-it" data-at={at} aria-hidden="true">
        <i /><i /><i />
    </div>
);

/* ---------- seasons, repetition, trouble ---------- */

export const SeasonWheel: React.FC<{ sproutAt: number; ringsAt: number }> = ({ sproutAt, ringsAt }) => (
    <div className="ws-wheel-wrap">
        <div className="ws-wheel">
            <div className="ws-disc ws-tap" style={{ ['--a' as string]: '0deg' }}>
                <span className="ws-disc-in"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#FDBA74" /><circle cx="30" cy="30" r="12" fill="#FDE68A" />{range(8).map((i) => <line key={i} x1="30" y1="8" x2="30" y2="13" stroke="#FFF7ED" strokeWidth="3" strokeLinecap="round" transform={`rotate(${i * 45} 30 30)`} />)}</svg>
                <b>उन्हाळा</b></span>
            </div>
            <div className="ws-disc ws-tap" style={{ ['--a' as string]: '120deg' }}>
                <span className="ws-disc-in"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#7DD3FC" /><path d="M17 31a8 8 0 0 1 4-15 10 10 0 0 1 19 3 6 6 0 0 1 1 12Z" fill="#fff" />{[20, 30, 40].map((x) => <line key={x} x1={x} y1="37" x2={x - 3} y2="46" stroke="#0369A1" strokeWidth="3" strokeLinecap="round" />)}</svg>
                <b>पावसाळा</b></span>
            </div>
            <div className="ws-disc ws-tap" style={{ ['--a' as string]: '240deg' }}>
                <span className="ws-disc-in"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#FCD34D" /><path d="M30 48V18" stroke="#92400E" strokeWidth="2.5" />{[22, 29, 36].map((y) => <g key={y}><ellipse cx="25" cy={y} rx="5" ry="2.6" fill="#B45309" transform={`rotate(-35 25 ${y})`} /><ellipse cx="35" cy={y} rx="5" ry="2.6" fill="#B45309" transform={`rotate(35 35 ${y})`} /></g>)}</svg>
                <b>हिवाळा</b></span>
            </div>
        </div>
        <div className="ws-wheel-core ws-it" data-at={sproutAt}><Sapling size={84} /></div>
        <div className="ws-ripples" data-at={ringsAt}><i /><i /></div>
    </div>
);

export const LoopArrows: React.FC<{ fastAt: number }> = ({ fastAt }) => (
    <div className="ws-loop" data-at={fastAt} aria-hidden="true">
        <svg viewBox="0 0 200 200">
            <path d="M100 22a78 78 0 0 1 74 54" stroke="#F97316" strokeWidth="14" fill="none" strokeLinecap="round" />
            <path d="m168 52 8 28-28-6" fill="#F97316" />
            <path d="M100 178a78 78 0 0 1-74-54" stroke="#FB923C" strokeWidth="14" fill="none" strokeLinecap="round" />
            <path d="m32 148-8-28 28 6" fill="#FB923C" />
        </svg>
        <span className="ws-loop-mark">!</span>
    </div>
);

export const TroubleCluster: React.FC<{ clockAt: number; costAt: number; pendingAt: number; fogAt: number }> = ({ clockAt, costAt, pendingAt, fogAt }) => (
    <div className="ws-trouble">
        <div className="ws-bubble ws-it ws-tap" data-at={clockAt} style={{ left: 8, top: 28 }}>
            <svg viewBox="0 0 80 80"><circle cx="40" cy="42" r="30" fill="#fff" stroke="#EA580C" strokeWidth="6" /><line x1="40" y1="42" x2="40" y2="22" stroke="#9A3412" strokeWidth="5" strokeLinecap="round" className="ws-hand-fast" /><line x1="40" y1="42" x2="54" y2="48" stroke="#9A3412" strokeWidth="5" strokeLinecap="round" /><circle cx="40" cy="42" r="4" fill="#9A3412" /><path d="M20 10l-8 8M60 10l8 8" stroke="#EA580C" strokeWidth="6" strokeLinecap="round" /></svg>
        </div>
        <div className="ws-bubble ws-it ws-tap" data-at={costAt} style={{ left: 120, top: 0 }}>
            <svg viewBox="0 0 80 80"><ellipse cx="34" cy="62" rx="22" ry="7" fill="#F59E0B" /><ellipse cx="34" cy="54" rx="22" ry="7" fill="#FBBF24" /><ellipse cx="34" cy="46" rx="22" ry="7" fill="#FCD34D" /><text x="34" y="51" textAnchor="middle" fontSize="13" fontWeight="900" fill="#92400E">₹</text><path d="M64 60V18M54 28l10-10 10 10" stroke="#DC2626" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" className="ws-rise-arrow" /></svg>
        </div>
        <div className="ws-bubble ws-it ws-tap" data-at={pendingAt} style={{ left: 226, top: 40 }}>
            <svg viewBox="0 0 80 80"><rect x="12" y="8" width="50" height="64" rx="8" fill="#fff" stroke="#EA580C" strokeWidth="5" /><path d="M22 26h22M22 40h16M22 54h12" stroke="#FDBA74" strokeWidth="5" strokeLinecap="round" /><circle cx="60" cy="56" r="15" fill="#EA580C" /><text x="60" y="62" textAnchor="middle" fontSize="18" fontWeight="900" fill="#fff">?</text></svg>
        </div>
        <div className="ws-fog" data-at={fogAt} />
    </div>
);

/* ---------- weather & market (not in our hands) ---------- */

export const RainCloud: React.FC<{ at: number; greyAt: number }> = ({ at, greyAt }) => (
    <div className="ws-weather ws-it" data-at={at}>
        <div className="ws-grey" data-at={greyAt}>
            <svg className="ws-cloud" viewBox="0 0 160 100"><path d="M36 86a26 26 0 0 1-4-52 36 36 0 0 1 68-8 28 28 0 0 1 30 26 18 18 0 0 1-4 34Z" fill="#fff" stroke="#BAE6FD" strokeWidth="4" /></svg>
            <div className="ws-rain">{range(14).map((i) => <i key={i} style={{ ['--i' as string]: i }} />)}</div>
        </div>
    </div>
);

export const PriceLine: React.FC<{ at: number; greyAt: number }> = ({ at, greyAt }) => (
    <div className="ws-price ws-it" data-at={at}>
        <div className="ws-grey" data-at={greyAt}>
            <svg viewBox="0 0 170 110">
                <path d="M8 102H164M8 102V6" stroke="#D6D3D1" strokeWidth="3" />
                <path className="ws-draw" d="M12 70 34 40 56 78 78 30 100 64 122 22 144 72 162 44" stroke="#B45309" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
                <text x="150" y="20" fontSize="22" fontWeight="900" fill="#B45309">₹</text>
            </svg>
        </div>
    </div>
);

/* ---------- in our hands ---------- */

export const HandWithSprout: React.FC<{ at: number; focusAt: number; controlAt: number }> = ({ at, focusAt, controlAt }) => (
    <div className="ws-hand ws-it ws-tap" data-at={at}>
        <div className="ws-target" data-at={focusAt}><i /><i /><i /></div>
        <svg viewBox="0 0 200 200" className="ws-hand-svg">
            <path d="M40 120c0-8 10-12 18-6l14 12V64a10 10 0 0 1 20 0v40-52a10 10 0 0 1 20 0v52-44a10 10 0 0 1 20 0v48-30a10 10 0 0 1 20 0v62c0 34-22 56-56 56h-6c-18 0-30-6-40-18L40 140c-4-6-4-14 0-20Z" fill="#FCD9B6" stroke="#B45309" strokeWidth="4" strokeLinejoin="round" />
            <g className="ws-sprout-up"><path d="M110 60V20" stroke="#047857" strokeWidth="6" strokeLinecap="round" /><path d="M110 34c0-14-10-22-28-22 0 14 10 22 28 22ZM110 28c0-14 10-24 28-24 0 14-10 24-28 24Z" fill="#10B981" /></g>
        </svg>
        <span className="ws-badge ws-it" data-at={controlAt}>
            <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10" stroke="#fff" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
    </div>
);

export const PlotQuestions: React.FC<{ cues: [number, number, number, number, number] }> = ({ cues }) => {
    const qs = ['कधी?', 'कोणी?', 'झालं का?', 'चूक कुठे?', 'पुढे काय?'];
    const spots = [[6, 18], [214, 6], [0, 150], [206, 146], [104, 196]];
    return (
        <div className="ws-plotq">
            <svg className="ws-plot ws-tap" viewBox="0 0 150 110">
                <rect x="4" y="4" width="142" height="102" rx="18" fill="#BBF7D0" stroke="#34D399" strokeWidth="4" />
                {range(5).map((i) => <path key={i} d={`M18 ${22 + i * 17} C 60 ${16 + i * 17} 90 ${28 + i * 17} 132 ${22 + i * 17}`} stroke="#10B981" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray="2 9" />)}
            </svg>
            {qs.map((q, i) => (
                <span key={q} className={`ws-q ws-it ${i === 3 ? 'warn' : ''}`} data-at={cues[i]} style={{ left: spots[i][0], top: spots[i][1], ['--d' as string]: `${i * 0.4}s` }}>{q}</span>
            ))}
        </div>
    );
};

/* ---------- memory & word of mouth ---------- */

export const MemoryBubbles: React.FC<{ thoughtAt: number; talkAt: number; crossAt: number }> = ({ thoughtAt, talkAt, crossAt }) => (
    <div className="ws-memory">
        <svg className="ws-it ws-fade-loop" data-at={thoughtAt} viewBox="0 0 140 110" style={{ left: 12, top: 30 }}>
            <path d="M34 78a22 22 0 0 1-4-44 30 30 0 0 1 56-6 24 24 0 0 1 22 40Z" fill="#fff" stroke="#A8A29E" strokeWidth="4" strokeDasharray="10 7" />
            <circle cx="30" cy="94" r="7" fill="#fff" stroke="#A8A29E" strokeWidth="3" /><circle cx="16" cy="104" r="4" fill="#fff" stroke="#A8A29E" strokeWidth="3" />
            <text x="66" y="62" textAnchor="middle" fontSize="30" fontWeight="900" fill="#A8A29E">?</text>
        </svg>
        <svg className="ws-it ws-fade-loop" data-at={talkAt} viewBox="0 0 140 110" style={{ left: 176, top: 20 }}>
            <path d="M14 14h112a10 10 0 0 1 10 10v48a10 10 0 0 1-10 10H54l-26 22v-22H14A10 10 0 0 1 4 72V24a10 10 0 0 1 10-10Z" fill="#fff" stroke="#A8A29E" strokeWidth="4" strokeDasharray="10 7" />
            <path d="M28 42h80M28 58h52" stroke="#D6D3D1" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <svg className="ws-cross" data-at={crossAt} viewBox="0 0 320 180" aria-hidden="true">
            <path d="M60 20 260 160M260 20 60 160" stroke="#DC2626" strokeWidth="14" strokeLinecap="round" pathLength={1} />
        </svg>
    </div>
);

/* ---------- the trust loop: record → approve → correct ---------- */

export const ApprovalFlow: React.FC<{ workerAt: number; recordAt: number; approveAt: number }> = ({ workerAt, recordAt, approveAt }) => (
    <div className="ws-flow">
        <div className="ws-phone ws-it ws-tap" data-at={workerAt}>
            <div className="ws-phone-mic"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg></div>
            <div className="ws-type" data-at={recordAt}><i /><i /><i /></div>
        </div>
        <svg className="ws-path" data-at={recordAt} viewBox="0 0 90 40"><path d="M4 20C30 4 60 36 86 20" stroke="#10B981" strokeWidth="4" fill="none" strokeDasharray="6 7" strokeLinecap="round" /></svg>
        <div className="ws-card ws-it ws-tap" data-at={recordAt}>
            <i /><i /><i className="s" />
            <div className="ws-stamp" data-at={approveAt}>
                <svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10" stroke="currentColor" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
        </div>
    </div>
);

export const CorrectionLedger: React.FC<{ wrongAt: number; fixAt: number }> = ({ wrongAt, fixAt }) => (
    <div className="ws-ledger ws-tap">
        <div className="ws-row"><span className="ok">✓</span><i /></div>
        <div className="ws-row bad ws-it" data-at={wrongAt}><span className="no">✕</span><i className="s" /><b className="ws-strike" data-at={fixAt} /></div>
        <div className="ws-row"><span className="ok">✓</span><i className="s" /></div>
        <div className="ws-row fix ws-it" data-at={fixAt}><span className="ok">✓</span><i /><em>दुरुस्त</em></div>
        <svg className="ws-pencil" data-at={fixAt} viewBox="0 0 24 24"><path d="M4 20l1-5L16 4l4 4L9 19Z" fill="#FBBF24" stroke="#92400E" strokeWidth="1.6" strokeLinejoin="round" /><path d="M4 20l1-5 4 4Z" fill="#92400E" /></svg>
    </div>
);

export const TrustShield: React.FC<{ at: number; sureAt: number; dutyAt: number }> = ({ at, sureAt, dutyAt }) => (
    <div className="ws-trust ws-it" data-at={at}>
        <div className="ws-halo" />
        <BrandSeal size={150} rays={false} />
        <span className="ws-orbit ws-it" data-at={sureAt} style={{ left: 21, top: 8 }}>✓</span>
        <span className="ws-orbit ws-it" data-at={dutyAt} style={{ left: 155, top: 8 }}>✓</span>
    </div>
);

/* ---------- dream, growth, habit ---------- */

export const Sunrise: React.FC<{ road?: boolean; roadAt?: number }> = ({ road, roadAt }) => (
    <div className="ws-sunrise">
        <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">
            <defs>
                <linearGradient id="ws-sr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFD9A8" /><stop offset=".75" stopColor="#FFF4E2" /></linearGradient>
                <radialGradient id="ws-sr-sun"><stop offset="0" stopColor="#FFF3C4" /><stop offset="1" stopColor="#FDBA74" /></radialGradient>
            </defs>
            <rect width="320" height="200" fill="url(#ws-sr-sky)" />
            <g className="ws-sr-rays">{range(12).map((i) => <rect key={i} x="157" y="20" width="6" height="34" rx="3" fill="#FDBA74" opacity=".45" transform={`rotate(${i * 30} 160 118)`} />)}</g>
            <circle className="ws-sr-sun" cx="160" cy="118" r="36" fill="url(#ws-sr-sun)" />
            <g className="ws-birds" stroke="#78716C" strokeWidth="2.4" fill="none" strokeLinecap="round"><path d="M60 50q6-6 12 0q6-6 12 0" /><path d="M96 36q5-5 10 0q5-5 10 0" /></g>
            <path d="M0 132 C70 108 120 136 170 122 C220 108 260 126 320 116 V200 H0Z" fill="#A7F3D0" />
            <path d="M0 156 C80 138 170 164 320 146 V200 H0Z" fill="#34D399" />
            {road
                ? <path className="ws-road" data-at={roadAt} d="M160 200 C150 182 176 170 160 152 C150 142 162 134 160 128" stroke="#FFF7E6" strokeWidth="16" fill="none" strokeLinecap="round" pathLength={1} />
                : <g stroke="#065F46" strokeOpacity=".2" strokeWidth="3" fill="none"><path d="M20 176 C120 164 200 180 300 168" /><path d="M10 190 C120 178 200 194 320 182" /></g>}
        </svg>
    </div>
);

export const PlanBadges: React.FC<{ planAt: number; decideAt: number }> = ({ planAt, decideAt }) => (
    <>
        <div className="ws-pin ws-it ws-tap" data-at={planAt} style={{ left: 18 }}>
            <svg viewBox="0 0 48 48"><rect x="4" y="8" width="40" height="36" rx="7" fill="#fff" stroke="#047857" strokeWidth="3.5" /><path d="M4 18h40M14 4v8M34 4v8" stroke="#047857" strokeWidth="3.5" strokeLinecap="round" /><path d="m16 30 6 6 11-12" stroke="#10B981" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <b>नियोजन</b>
        </div>
        <div className="ws-pin ws-it ws-tap" data-at={decideAt} style={{ right: 18 }}>
            <svg viewBox="0 0 48 48"><path d="M24 6v38" stroke="#92400E" strokeWidth="4" strokeLinecap="round" /><path d="M24 10h14l5 5-5 5H24Z" fill="#10B981" /><path d="M24 24H10l-5 5 5 5h14Z" fill="#FBBF24" /></svg>
            <b>निर्णय</b>
        </div>
    </>
);

export const Sapling: React.FC<{ size?: number }> = ({ size = 70 }) => (
    <svg viewBox="0 0 54 70" width={size * 0.77} height={size}><path d="M27 68V34" stroke="#047857" strokeWidth="4" strokeLinecap="round" /><path d="M27 42c0-10-7-16-19-16 0 10 7 16 19 16ZM27 36c0-10 7-18 19-18 0 10-7 18-19 18Z" fill="#34D399" /></svg>
);

export const GrowthRow: React.FC<{ seedAt: number; smallAt: number; bigAt: number; fruitAt: number }> = ({ seedAt, smallAt, bigAt, fruitAt }) => (
    <div className="ws-grow">
        <div className="ws-stage ws-it" data-at={seedAt}><svg viewBox="0 0 34 40" width="30"><ellipse cx="17" cy="30" rx="9" ry="6" fill="#B07A4A" /><path d="M17 26c0-4 2-7 5-8" stroke="#10B981" strokeWidth="3" fill="none" strokeLinecap="round" /></svg><b>आज</b></div>
        <div className="ws-stage ws-it" data-at={smallAt}><Sapling size={60} /><b /></div>
        <div className="ws-stage ws-tree ws-it ws-tap" data-at={bigAt}>
            <svg viewBox="0 0 120 140" width="130">
                <path d="M60 138V70" stroke="#7C5A3A" strokeWidth="9" strokeLinecap="round" />
                <circle cx="60" cy="50" r="36" fill="#10B981" /><circle cx="32" cy="66" r="24" fill="#34D399" /><circle cx="88" cy="66" r="24" fill="#34D399" /><circle cx="60" cy="30" r="22" fill="#6EE7B7" />
                <g className="ws-fruit" data-at={fruitAt}><circle cx="44" cy="48" r="5" fill="#FBBF24" /><circle cx="76" cy="42" r="5" fill="#FBBF24" /><circle cx="64" cy="68" r="5" fill="#FBBF24" /><circle cx="30" cy="70" r="5" fill="#FBBF24" /><circle cx="90" cy="70" r="5" fill="#FBBF24" /></g>
            </svg>
            <b>उद्या</b>
        </div>
    </div>
);

export const HabitStreak: React.FC<{ oneAt: number; daysAt: number }> = ({ oneAt, daysAt }) => (
    <div className="ws-habit">
        <div className="ws-spot ws-it" data-at={oneAt}><span>१</span></div>
        <div className="ws-days" data-at={daysAt}>
            {['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'].map((d, i) => (
                <div key={d} className="ws-day ws-tap" style={{ ['--i' as string]: i }}>
                    <i><svg viewBox="0 0 24 24"><path d="M12 20v-7M12 14c0-4-3-6-7-6 0 4 3 6 7 6ZM12 12c0-4 3-7 7-7 0 4-3 7-7 7Z" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg></i>
                    <b>{d}</b>
                </div>
            ))}
        </div>
    </div>
);

export const VoiceMic: React.FC<{ cues: [number, number, number] }> = ({ cues }) => (
    <div className="ws-voice">
        <div className="ws-eq">{range(14).map((i) => <i key={i} style={{ ['--i' as string]: i }} />)}</div>
        <div className="ws-mic ws-tap">
            <span className="w1" /><span className="w2" />
            <svg viewBox="0 0 24 24"><rect x="9" y="2.5" width="6" height="12" rx="3" fill="#fff" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>
        </div>
        <span className="ws-say ws-it" data-at={cues[0]} style={{ left: 0, top: 30 }}>✓</span>
        <span className="ws-say warn ws-it" data-at={cues[1]} style={{ right: 0, top: 30 }}>!</span>
        <span className="ws-say ws-it" data-at={cues[2]} style={{ left: '50%', top: 0, marginLeft: -24 }}>→</span>
    </div>
);

export const OrganiseSlips: React.FC<{ at: number; techAt: number }> = ({ at, techAt }) => (
    <div className="ws-organise" data-at={at}>
        {range(5).map((i) => (
            <div key={i} className="ws-slip" style={{ ['--x' as string]: `${[30, -40, 22, -26, 44][i]}px`, ['--y' as string]: `${[10, -16, 22, -8, 4][i]}px`, ['--r' as string]: `${[14, -18, 9, -12, 20][i]}deg` }}>
                <span>✓</span><i className={i % 2 ? 's' : ''} />
            </div>
        ))}
        <div className="ws-sparkle" data-at={techAt}><i /><i /><i /></div>
    </div>
);

export const Together: React.FC<{ joinAt: number }> = ({ joinAt }) => (
    <div className="ws-together">
        <Farmer pose="welcome" height={230} />
        <span className="ws-plus ws-it" data-at={joinAt}>+</span>
        <div className="ws-it" data-at={joinAt}><BrandSeal size={104} rays={false} /></div>
    </div>
);

export const Pillars: React.FC<{ cues: [number, number, number] }> = ({ cues }) => {
    const items = [
        { c: '#047857', h: 120, icon: <path d="M9 7h11M9 12h11M9 17h11M4 7l1 1 2-2M4 12l1 1 2-2M4 17l1 1 2-2" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
        { c: '#0369A1', h: 150, icon: <g stroke="#fff" strokeWidth="2.2" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></g> },
        { c: '#B8730F', h: 180, icon: <g stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-3.5 7-9V5l-7-2.5L5 5v7c0 5.5 7 9 7 9Z" /><path d="m9 12 2 2 4-4" /></g> },
    ];
    return (
        <div className="ws-pillars">
            {items.map((p, i) => (
                <div key={i} className="ws-pillar ws-tap" data-at={cues[i]} style={{ ['--c' as string]: p.c, ['--h' as string]: `${p.h}px` }}>
                    <span className="ws-cap"><svg viewBox="0 0 24 24">{p.icon}</svg></span>
                    <i />
                </div>
            ))}
        </div>
    );
};

export const AskBubble: React.FC<At> = ({ at }) => (
    <div className="ws-ask">
        <Farmer pose="point" height={250} />
        <span className="ws-ask-q ws-it" data-at={at}>?</span>
    </div>
);
