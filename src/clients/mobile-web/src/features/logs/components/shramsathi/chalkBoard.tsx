/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The chalk blackboard's ONE source: its grain texture, its 15 lines and the rule that turns them, shared by the production waiting
 * screen (`ShramSathiUnderstanding`, unchanged in look and behaviour: it only reads these from here now) and the founder's final
 * recording screen (spec plr-d10-schedule-mechanism-pilot-2026-11-22, part 03 A3, approved 28 Nov: "the chalk blackboard under the
 * ring, copied exactly from the production waiting screen"). One list, one rule: the two screens can never drift apart.
 *
 * `ChalkBoard` is the recording screen's copy of the production board (wooden frame, charcoal board, white chalk quote in a fixed-height
 * area, two chalk pieces, the sickle), its CSS values copied as they are from `ShramSathiUnderstanding` and scoped under `.cb-root`, so
 * it can never restyle the production screen. Its quote area is held at the height of the tallest line, so the screen never jumps.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const SERIF = "'Noto Serif Devanagari', serif";
const SANS = "'Noto Sans Devanagari', sans-serif";

/** The board's (and Sathi's halo's) grain: an SVG fractal noise, as a CSS `url(...)` value. */
export const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The 15 lines of encouragement, word for word (founder-approved, `ShramSathiUnderstanding`). */
export const BOARD_LINES: readonly string[] = [
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

/** How long line `i` stays up: its reading time, longer lines longer (2.2 s + 0.44 s a word, held between 4.2 s and 9 s). */
export function boardLineMs(i: number): number {
    const words = BOARD_LINES[i].trim().split(/\s+/).length;
    return Math.min(9000, Math.max(4200, 2200 + words * 440));
}

/** The next line after `current`: a random one, never the same line twice in a row. */
export function nextBoardLine(current: number, random: () => number = Math.random): number {
    let n = Math.floor(random() * BOARD_LINES.length);
    if (n === current) n = (n + 1) % BOARD_LINES.length; // no immediate repeat
    return n;
}

/** The line on the board now: it starts on a RANDOM line and turns after each line's reading time. */
export function useBoardLine(): number {
    const [li, setLi] = useState(() => Math.floor(Math.random() * BOARD_LINES.length));
    useEffect(() => {
        const t = window.setTimeout(() => setLi((v) => nextBoardLine(v)), boardLineMs(li));
        return () => window.clearTimeout(t);
    }, [li]);
    return li;
}

/** The production board's CSS (`ShramSathiUnderstanding`), value for value, under `.cb-root` (which is the container for its `cqw`). */
const BOARD_CSS = `
.cb-root{ container-type:inline-size; width:100%; }
@keyframes cbQuoteIn{ 0%{ opacity:0; transform:translateY(10px); filter:blur(3px);} 100%{ opacity:1; transform:translateY(0); filter:blur(0);} }
.cb-root .su-boardwrap{ position:relative; width:100%; max-width:405px; margin:0 auto 2cqw; zoom:.84; }
.cb-root .su-board{ position:relative; border-radius:16px; padding:3.4cqw 3.4cqw 7.5cqw;
    background:linear-gradient(158deg, #b98844 0%, #9c6a33 52%, #835324 100%);
    box-shadow:0 12px 26px rgba(80,50,20,.30), inset 0 1.5px 0 rgba(255,255,255,.28), inset 0 -2px 3px rgba(0,0,0,.25); }
.cb-root .su-inner{ position:relative; overflow:hidden; border-radius:8px; padding:5.5cqw 5.5cqw 6cqw; isolation:isolate;
    background:radial-gradient(125% 105% at 50% 34%, #35342f 0%, #2a2926 58%, #201f1c 100%);
    box-shadow:inset 0 0 26px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.045); }
.cb-root .su-inner::before{ content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none;
    background-image:${GRAIN}; background-size:120px 120px; opacity:.05; mix-blend-mode:screen; }
.cb-root .su-qmark{ position:absolute; z-index:0; font-family:${SERIF}; font-weight:700; font-size:12.5cqw; line-height:.82; color:rgba(242,241,234,.30); pointer-events:none; }
.cb-root .su-qmark.qt{ top:1.5cqw; left:2.5cqw; }
.cb-root .su-qmark.qb{ bottom:0.5cqw; right:2.5cqw; transform:rotate(180deg); }
.cb-root .su-quotearea{ position:relative; z-index:1; min-height:39cqw; padding:0 5cqw; display:flex; align-items:center; justify-content:center; }
.cb-root .su-quote{ position:relative; z-index:1; margin:0; font-family:${SANS}; font-weight:700; color:#f2f1ea; text-align:center;
    font-size:clamp(15px, 4.6cqw, 19px); line-height:1.72; letter-spacing:.3px; max-width:24ch;
    text-shadow:0 0 1px rgba(255,255,255,.4), 0 1px 1px rgba(0,0,0,.35); animation:cbQuoteIn .6s ease; }
.cb-root .su-chalk{ position:absolute; bottom:2.4cqw; height:2cqw; max-height:9px; width:8cqw; max-width:34px; border-radius:3px;
    background:linear-gradient(180deg,#fdfdfb,#d9d8d1); box-shadow:0 1px 2px rgba(0,0,0,.35); }
.cb-root .su-chalk.c1{ left:40%; }
.cb-root .su-chalk.c2{ left:66%; transform:rotate(-2deg); }
.cb-root .su-sickle{ position:absolute; left:-4cqw; bottom:-6cqw; width:24cqw; max-width:98px; height:auto; transform:scaleX(-1); filter:drop-shadow(0 4px 5px rgba(0,0,0,.3)); }
@media (prefers-reduced-motion: reduce){ .cb-root .su-quote{ animation:none; } }
`;

/** The sickle (विळा) leaning bottom-left, as the production board draws it (own gradient ids). */
const Sickle: React.FC = () => (
    <svg className="su-sickle" viewBox="0 0 150 165" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
            <linearGradient id="cbSteel" x1="0.1" y1="0" x2="0.9" y2="1">
                <stop offset="0" stopColor="#f2f3f5" />
                <stop offset="0.42" stopColor="#cfd2d8" />
                <stop offset="0.72" stopColor="#a7aab1" />
                <stop offset="1" stopColor="#83868d" />
            </linearGradient>
            <linearGradient id="cbEdge" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#dfe1e5" />
            </linearGradient>
            <linearGradient id="cbWood" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ad7538" />
                <stop offset="0.5" stopColor="#8a5a2a" />
                <stop offset="1" stopColor="#653f1c" />
            </linearGradient>
            <linearGradient id="cbFerrule" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#c9ccd1" />
                <stop offset="0.5" stopColor="#9a9da3" />
                <stop offset="1" stopColor="#c9ccd1" />
            </linearGradient>
        </defs>
        <g transform="rotate(37 96 132)">
            <rect x="80" y="123" width="58" height="17" rx="8.5" fill="url(#cbWood)" />
            <rect x="84" y="127" width="46" height="2.4" rx="1.2" fill="#5c3a18" opacity="0.45" />
            <circle cx="134" cy="131.5" r="3.6" fill="#4a2f14" />
            <rect x="74" y="120" width="12" height="23" rx="3.5" fill="url(#cbFerrule)" />
            <rect x="74" y="124" width="12" height="1.6" fill="#7b7e84" opacity="0.6" />
        </g>
        <path d="M74,120 C33,108 11,60 33,22 C37,13 47,10 53,17 C46,22 43,33 45,47 C41,70 60,92 85,96 C95,98 99,108 92,115 C85,120 79,116 74,120 Z" fill="url(#cbSteel)" />
        <path d="M45,47 C41,70 60,92 85,96" fill="none" stroke="url(#cbEdge)" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
        <path d="M74,120 C33,108 11,60 33,22" fill="none" stroke="#767980" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
        <path d="M33,22 C37,13 47,10 53,17" fill="none" stroke="#eceef1" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </svg>
);

/** The recording screen's blackboard: the production board, turning the same lines by the same rule. */
export const ChalkBoard: React.FC = () => {
    const li = useBoardLine();
    const probe = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | null>(null);
    // The quote area is held at the height of the TALLEST of the 15 lines (measured once, off-screen), so the screen never jumps.
    useLayoutEffect(() => {
        const box = probe.current;
        if (!box) return undefined;
        const measure = () => {
            let max = 0;
            box.querySelectorAll('p').forEach((p) => { max = Math.max(max, p.offsetHeight); });
            if (max > 0) setHeight(max);
        };
        measure();
        const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts : undefined;
        let live = true;
        void fonts?.ready?.then(() => { if (live) measure(); });
        return () => { live = false; };
    }, []);
    return (
        <div className="cb-root" data-testid="chalk-board">
            <style>{BOARD_CSS}</style>
            <div className="su-boardwrap">
                <div className="su-board">
                    <div className="su-inner">
                        <span className="su-qmark qt" aria-hidden="true">“</span>
                        <div className="su-quotearea" style={height ? { height } : undefined}>
                            <p className="su-quote" key={li} data-testid="chalk-board-line" data-line={li}>{BOARD_LINES[li]}</p>
                            {/* Every line laid out once, invisibly, at the same width as the line shown: the tallest sets the area's height. */}
                            <div ref={probe} aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', padding: '0 5cqw' }}>
                                {BOARD_LINES.map((line, i) => <p key={i} className="su-quote" style={{ display: 'block', animation: 'none' }}>{line}</p>)}
                            </div>
                        </div>
                        <span className="su-qmark qb" aria-hidden="true">“</span>
                    </div>
                    <span className="su-chalk c1" />
                    <span className="su-chalk c2" />
                </div>
                <Sickle />
            </div>
        </div>
    );
};

export default ChalkBoard;
