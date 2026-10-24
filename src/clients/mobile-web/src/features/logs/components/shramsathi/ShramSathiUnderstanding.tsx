/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShramSathiUnderstanding — the production "understanding / processing" screen
 * shown while the voice pipeline transcribes (Sarvam) + parses (Gemini) a spoken
 * log. Founder-approved design: brand title · support line · character (video A in
 * a matched-cream glass circle with a living green+blue glow) · green→blue voice
 * waveform · wooden-framed charcoal blackboard that cycles the 10 motivational
 * lines as white-chalk quotes (fixed-height so it never jumps; per-line reading
 * time), two chalk pieces on the ledge, and a sickle (विळा) leaning bottom-left.
 * Rendered by mainView while `status === 'processing'`. Flat / vector-friendly.
 */

import React, { useEffect, useState } from 'react';

const SERIF = "'Noto Serif Devanagari', serif";
const SANS = "'Noto Sans Devanagari', sans-serif";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const BRAND = 'श्रम साथी';
const SUPPORT = 'तुम्ही शेतात केलेली कामे आणि तुमची शेती करण्याची कार्यपद्धत समजून घेत आहे';

const LINES = [
    'जे मोजता येतं, त्याचं नियोजन करता येतं — आणि आज तुम्ही शेतकाम मोजायला सुरुवात केली.',
    'दिवसातला एक मिनिट दिलात — शेतावरची पकड इथूनच सुरू होते.',
    'आतापासून तुमची शेती अंदाजावर नाही, तुमच्या पूर्वीच्या निर्णयांवर उभी राहील.',
    'आजचं काम आज नोंदवलं, तर उद्याचा निर्णय अंदाजावर राहत नाही.',
    'आज तुम्ही फक्त पीक घेत नाही — स्वतःचं आणि तुमच्या शेतजमिनीच्या ज्ञानाचा पाया रोवत आहात.',
    'हुशार शेतकरी शंकेवर नाही, स्वतःच्या नोंदींवर निर्णय घेतो.',
    'आज केलेली प्रत्येक नोंद, उद्याचा निर्णय सोपा करते.',
    'मोजायला लागलात, की शेती नशिबावर राहत नाही.',
    'नोंदवलेलं शहाणपण पुढच्या पिढीला कामी येतं; विसरलेली चूक पुन्हा तीच चूक करायला भाग पाडते.',
    'आज तुम्ही ‘असेल कदाचित’ वरून ‘मला माहीत आहे’ पर्यंत पोहोचलात.',
    'आकड्यांवर चालणारी शेती, हीच खऱ्या अर्थाने तुमच्या हातातली शेती.',
    'इतिहास त्यांनाच मार्ग दाखवतो जे तो लिहितात — आज तुम्ही तुमचा लिहिताय.',
    'पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे.',
    'आज तुम्ही फक्त शेतकरी नाही — स्वतःची शेती पुढे नेणारे प्रगतशील आणि नियोजनबद्ध शेतकरी आहात.',
    'आजचं छोटं मोजमाप, उद्या तुमच्या शेतीवरचं पूर्ण नियंत्रण देतं.',
];

// green→blue waveform (short bars green → tall bars blue)
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const G = [23, 163, 74], B = [30, 86, 230];
const BAR_N = 40;
const WAVE = Array.from({ length: BAR_N }, (_, i) => {
    const c = (BAR_N - 1) / 2, dist = (i - c) / c, env = Math.exp(-dist * dist * 7.5);
    return {
        h: Math.round(8 + env * 92),
        d: +(Math.abs(i - c) * 0.045).toFixed(2),
        t: +(0.85 + ((i * 3) % 5) * 0.12).toFixed(2),
        col: `rgb(${lerp(G[0], B[0], env)}, ${lerp(G[1], B[1], env)}, ${lerp(G[2], B[2], env)})`,
    };
});

export function ShramSathiUnderstanding(): React.ReactElement {
    // start on a RANDOM line; reading time scales with length → longer quotes linger longer
    const [li, setLi] = useState(() => Math.floor(Math.random() * LINES.length));
    useEffect(() => {
        const words = LINES[li].trim().split(/\s+/).length;
        const dur = Math.min(9000, Math.max(4200, 2200 + words * 440));
        const t = window.setTimeout(() => setLi((v) => {
            let n = Math.floor(Math.random() * LINES.length);
            if (n === v) n = (n + 1) % LINES.length; // no immediate repeat
            return n;
        }), dur);
        return () => window.clearTimeout(t);
    }, [li]);
    return (
        <div className="su-root">
            <style>{`
                .su-root{ position:fixed; inset:0; z-index:60; overflow-y:auto; overflow-x:hidden; display:flex; justify-content:center; background:#FCFCFC; }
                .su-frame{ position:relative; width:min(100dvw, 430px); min-height:100dvh; container-type:inline-size;
                    display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
                    padding:4dvh 7cqw 4dvh; color:#1C1917; font-family:${SANS};
                    background:
                        radial-gradient(at 22% -2%, hsla(145,58%,97%,.6) 0, transparent 38%),
                        radial-gradient(at 82% 1%, hsla(190,65%,98%,.5) 0, transparent 36%),
                        #FCFCFC; }
                .su-grain{ position:absolute; inset:0; pointer-events:none; background-image:${GRAIN}; background-size:140px 140px; opacity:.05; mix-blend-mode:soft-light; }

                @keyframes suBreathe{ 0%,100%{ transform:scale(1) translateY(0);} 50%{ transform:scale(1.016) translateY(-3px);} }
                @keyframes suPulse1{ 0%,100%{ opacity:.14; transform:translate(-50%,-50%) scale(.82);} 45%{ opacity:.9; transform:translate(-50%,-50%) scale(1.14);} }
                @keyframes suPulse2{ 0%,100%{ opacity:.16; transform:translate(-50%,-50%) scale(.9);} 55%{ opacity:.95; transform:translate(-50%,-50%) scale(1.2);} }
                @keyframes suPulse3{ 0%,100%{ opacity:.1; transform:translate(-50%,-50%) scale(.86);} 40%{ opacity:.85; transform:translate(-50%,-50%) scale(1.08);} }
                @keyframes suEq{ 0%,100%{ transform:scaleY(.30);} 50%{ transform:scaleY(1);} }
                @keyframes suQuoteIn{ 0%{ opacity:0; transform:translateY(10px); filter:blur(3px);} 100%{ opacity:1; transform:translateY(0); filter:blur(0);} }

                .su-title{ font-family:${SERIF}; font-weight:800; font-size:clamp(30px, 10.5cqw, 44px); line-height:1.06; color:#065F46; text-align:center; letter-spacing:.5px; }
                .su-support{ margin-top:2.4cqw; font-family:${SANS}; font-weight:700; font-size:clamp(16px, 5cqw, 20px); line-height:1.34; color:#2F6B47; text-align:center; max-width:32ch; }

                .su-figure{ position:relative; margin-top:8cqw; display:flex; align-items:center; justify-content:center; }
                .su-glint{ position:absolute; aspect-ratio:1; transform:translate(-50%,-50%); border-radius:9999px; pointer-events:none; filter:blur(12px); }
                .su-glint.g1{ left:50%; top:6%;  width:42%; background:radial-gradient(circle, rgba(22,178,78,.78), transparent 67%);  animation:suPulse1 3.6s ease-in-out infinite; }
                .su-glint.g2{ left:88%; top:24%; width:38%; background:radial-gradient(circle, rgba(28,108,240,.76), transparent 65%); animation:suPulse2 4.9s ease-in-out .7s infinite; }
                .su-glint.g3{ left:90%; top:64%; width:35%; background:radial-gradient(circle, rgba(40,200,92,.7), transparent 64%);   animation:suPulse3 4.2s ease-in-out 1.4s infinite; }
                .su-glint.g4{ left:16%; top:74%; width:37%; background:radial-gradient(circle, rgba(26,185,84,.74), transparent 64%);  animation:suPulse1 4.6s ease-in-out 2.1s infinite; }
                .su-glint.g5{ left:9%;  top:34%; width:39%; background:radial-gradient(circle, rgba(36,122,240,.76), transparent 66%); animation:suPulse3 3.9s ease-in-out 1s infinite; }
                .su-orb{ position:relative; width:min(53cqw, 212px); aspect-ratio:1; border-radius:9999px; overflow:hidden;
                    background:rgb(255,246,198); box-shadow:0 8px 26px rgba(0,0,0,.08), 0 0 38px rgba(16,185,129,.26); animation:suBreathe 5.5s ease-in-out infinite; }
                .su-orb > video{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; transform:translateY(5%) scale(.94); transform-origin:center;
                    -webkit-mask-image:radial-gradient(circle at 50% 44%, #000 60%, transparent 82%); mask-image:radial-gradient(circle at 50% 44%, #000 60%, transparent 82%); }

                .su-eq{ margin-top:8cqw; height:12cqw; max-height:50px; display:flex; align-items:center; justify-content:center; gap:0.7cqw; }
                .su-eq > i{ display:block; width:0.95cqw; min-width:2.5px; max-width:5px; border-radius:9999px; transform-origin:center; animation:suEq ease-in-out infinite; }

                /* BLACKBOARD */
                .su-boardwrap{ position:relative; width:100%; max-width:405px; margin-top:9cqw; margin-bottom:2cqw; }
                .su-board{ position:relative; border-radius:16px; padding:3.4cqw 3.4cqw 7.5cqw;
                    background:linear-gradient(158deg, #b98844 0%, #9c6a33 52%, #835324 100%);
                    box-shadow:0 12px 26px rgba(80,50,20,.30), inset 0 1.5px 0 rgba(255,255,255,.28), inset 0 -2px 3px rgba(0,0,0,.25); }
                .su-inner{ position:relative; overflow:hidden; border-radius:8px; padding:5.5cqw 5.5cqw 6cqw;
                    background:radial-gradient(125% 105% at 50% 34%, #35342f 0%, #2a2926 58%, #201f1c 100%);
                    box-shadow:inset 0 0 26px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.045); }
                .su-inner::before{ content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none;
                    background-image:${GRAIN}; background-size:120px 120px; opacity:.05; mix-blend-mode:screen; }
                /* Quote marks are decoration BEHIND the text, never on top of it.
                   Previously they sat at the same stacking level with ~94% opacity
                   and the Devanagari line ran straight through them, which made
                   longer quotes unreadable. Now: pushed to the very corners, muted,
                   and z-indexed under the text. */
                .su-qmark{ position:absolute; z-index:0; font-family:${SERIF}; font-weight:700; font-size:12.5cqw; line-height:.82; color:rgba(242,241,234,.30); pointer-events:none; }
                .su-qmark.qt{ top:1.5cqw; left:2.5cqw; }
                .su-qmark.qb{ bottom:0.5cqw; right:2.5cqw; transform:rotate(180deg); }
                /* Horizontal padding keeps the text clear of the corner glyphs even
                   on the longest line; height grows with content so nothing clips. */
                .su-quotearea{ position:relative; z-index:1; min-height:39cqw; padding:0 5cqw; display:flex; align-items:center; justify-content:center; }
                .su-quote{ position:relative; z-index:1; font-family:${SANS}; font-weight:700; color:#f2f1ea; text-align:center;
                    font-size:clamp(15px, 4.6cqw, 19px); line-height:1.72; letter-spacing:.3px; max-width:24ch;
                    text-shadow:0 0 1px rgba(255,255,255,.4), 0 1px 1px rgba(0,0,0,.35); animation:suQuoteIn .6s ease; }
                .su-chalk{ position:absolute; bottom:2.4cqw; height:2cqw; max-height:9px; width:8cqw; max-width:34px; border-radius:3px;
                    background:linear-gradient(180deg,#fdfdfb,#d9d8d1); box-shadow:0 1px 2px rgba(0,0,0,.35); }
                .su-chalk.c1{ left:40%; }
                .su-chalk.c2{ left:66%; transform:rotate(-2deg); }
                .su-sickle{ position:absolute; left:-4cqw; bottom:-6cqw; width:24cqw; max-width:98px; height:auto; transform:scaleX(-1); filter:drop-shadow(0 4px 5px rgba(0,0,0,.3)); }
            `}</style>

            <div className="su-frame">
                <div className="su-grain" />

                <h1 className="su-title">{BRAND}</h1>
                <div className="su-support">{SUPPORT}</div>

                <div className="su-figure">
                    <div className="su-glint g1" />
                    <div className="su-glint g2" />
                    <div className="su-glint g3" />
                    <div className="su-glint g4" />
                    <div className="su-glint g5" />
                    <div className="su-orb">
                        <video autoPlay loop muted playsInline preload="auto">
                            <source src="/assets/shramsathi/shramsathi-a.mp4" type="video/mp4" />
                        </video>
                    </div>
                </div>

                <div className="su-eq" aria-hidden="true">
                    {WAVE.map((b, k) => (
                        <i key={k} style={{ height: `${b.h}%`, background: b.col, animationDelay: `${b.d}s`, animationDuration: `${b.t}s` }} />
                    ))}
                </div>

                <div className="su-boardwrap">
                    <div className="su-board">
                        <div className="su-inner">
                            <span className="su-qmark qt">“</span>
                            <div className="su-quotearea">
                                <p className="su-quote" key={li}>{LINES[li]}</p>
                            </div>
                            <span className="su-qmark qb">“</span>
                        </div>
                        <span className="su-chalk c1" />
                        <span className="su-chalk c2" />
                    </div>
                    <svg className="su-sickle" viewBox="0 0 150 165" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <defs>
                            <linearGradient id="suSteel" x1="0.1" y1="0" x2="0.9" y2="1">
                                <stop offset="0" stopColor="#f2f3f5" />
                                <stop offset="0.42" stopColor="#cfd2d8" />
                                <stop offset="0.72" stopColor="#a7aab1" />
                                <stop offset="1" stopColor="#83868d" />
                            </linearGradient>
                            <linearGradient id="suEdge" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0" stopColor="#ffffff" />
                                <stop offset="1" stopColor="#dfe1e5" />
                            </linearGradient>
                            <linearGradient id="suWood" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0" stopColor="#ad7538" />
                                <stop offset="0.5" stopColor="#8a5a2a" />
                                <stop offset="1" stopColor="#653f1c" />
                            </linearGradient>
                            <linearGradient id="suFerrule" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0" stopColor="#c9ccd1" />
                                <stop offset="0.5" stopColor="#9a9da3" />
                                <stop offset="1" stopColor="#c9ccd1" />
                            </linearGradient>
                        </defs>
                        <g transform="rotate(37 96 132)">
                            <rect x="80" y="123" width="58" height="17" rx="8.5" fill="url(#suWood)" />
                            <rect x="84" y="127" width="46" height="2.4" rx="1.2" fill="#5c3a18" opacity="0.45" />
                            <circle cx="134" cy="131.5" r="3.6" fill="#4a2f14" />
                            <rect x="74" y="120" width="12" height="23" rx="3.5" fill="url(#suFerrule)" />
                            <rect x="74" y="124" width="12" height="1.6" fill="#7b7e84" opacity="0.6" />
                        </g>
                        <path d="M74,120 C33,108 11,60 33,22 C37,13 47,10 53,17 C46,22 43,33 45,47 C41,70 60,92 85,96 C95,98 99,108 92,115 C85,120 79,116 74,120 Z" fill="url(#suSteel)" />
                        <path d="M45,47 C41,70 60,92 85,96" fill="none" stroke="url(#suEdge)" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
                        <path d="M74,120 C33,108 11,60 33,22" fill="none" stroke="#767980" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
                        <path d="M33,22 C37,13 47,10 53,17" fill="none" stroke="#eceef1" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
                    </svg>
                </div>
            </div>
        </div>
    );
}

export default ShramSathiUnderstanding;
