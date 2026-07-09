/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AfterParseRevealDemo — a standalone preview of the "after voice-parse" reveal
 * that the real result screen (ManualEntry) now does: the TRANSCRIPT shows first
 * (top), then after a short beat a slight slide-up animation smooth-scrolls the
 * SORTED LOG into view — so the farmer never has to scroll manually. This mirrors
 * the real logic (scrollIntoView smooth + .animate-slide-up) on demand + Replay,
 * so it can be checked without speaking a log. Route: /dev/reveal
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const SERIF = "'Noto Serif Devanagari', serif";
const SANS = "'Noto Sans Devanagari', sans-serif";

export function AfterParseRevealDemo(): React.ReactElement {
    const rootRef = useRef<HTMLDivElement>(null);
    const sortedRef = useRef<HTMLDivElement>(null);
    const [reveal, setReveal] = useState(false);

    const play = useCallback(() => {
        setReveal(false);
        rootRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        // let the transcript register for a beat, then reveal the sorted log
        const t = window.setTimeout(() => {
            setReveal(true);
            sortedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 950);
        return () => window.clearTimeout(t);
    }, []);

    useEffect(() => { const cleanup = play(); return cleanup; }, [play]);

    return (
        <div className="rv-root" ref={rootRef}>
            <style>{`
                .rv-root{ position:fixed; inset:0; overflow-y:auto; overflow-x:hidden; background:#FCFCFC; font-family:${SANS}; color:#1C1917; }
                .rv-frame{ width:min(100dvw, 430px); margin:0 auto; padding:0 18px 40px; }
                .rv-topbar{ position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between;
                    padding:14px 2px; background:linear-gradient(#FCFCFC 70%, rgba(252,252,252,0)); }
                .rv-topttl{ font-family:${SANS}; font-weight:700; font-size:15px; color:#065F46; }
                .rv-replay{ font-family:${SANS}; font-weight:700; font-size:13px; color:#047857; background:#ECFDF5; border:1px solid #A7F3D0;
                    border-radius:9999px; padding:7px 14px; cursor:pointer; }
                @keyframes rvPulse{ 0%,100%{ opacity:.5; transform:translateY(0);} 50%{ opacity:1; transform:translateY(3px);} }

                /* TRANSCRIPT (top) — "here's what I heard" */
                .rv-transcript{ min-height:calc(100dvh - 30px); display:flex; flex-direction:column; }
                .rv-tlabel{ font-family:${SANS}; font-weight:700; font-size:13px; letter-spacing:.02em; color:#2F6B47; margin:4px 0 8px; }
                .rv-tcard{ background:#fff; border:1px solid #E7E5E4; border-radius:18px; padding:18px 18px 20px; box-shadow:0 2px 10px rgba(0,0,0,.03); }
                .rv-tquote{ font-family:${SERIF}; font-weight:600; font-size:19px; line-height:1.6; color:#1C1917; }
                .rv-thint{ margin-top:auto; padding:14px 0 6px; text-align:center; font-family:${SANS}; font-size:13px; font-weight:700; color:#059669;
                    animation:rvPulse 1.6s ease-in-out infinite; }

                /* SORTED LOG (below the fold) — the parsed entry */
                .rv-sorted{ scroll-margin-top:64px; }
                .rv-slabel{ font-family:${SANS}; font-weight:800; font-size:16px; color:#065F46; margin:2px 0 10px; }
                .rv-scard{ background:#fff; border:1px solid #E7E5E4; border-radius:20px; overflow:hidden; box-shadow:0 8px 26px rgba(0,0,0,.06); }
                .rv-chip{ display:inline-flex; align-items:center; gap:6px; background:#ECFDF5; color:#065F46; font-weight:700; font-size:13px;
                    border-radius:9999px; padding:6px 12px; margin:16px 0 4px 16px; }
                .rv-row{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-top:1px solid #F5F5F4; }
                .rv-row:first-of-type{ border-top:none; }
                .rv-rk{ font-family:${SANS}; font-weight:600; font-size:15px; color:#44403C; }
                .rv-rv{ font-family:${SANS}; font-weight:800; font-size:15px; color:#1C1917; }
                .rv-total{ display:flex; align-items:center; justify-content:space-between; padding:16px; background:#065F46; }
                .rv-total .rv-rk{ color:#D1FAE5; font-weight:700; }
                .rv-total .rv-rv{ color:#fff; font-size:18px; }
                .rv-note{ margin-top:14px; text-align:center; font-size:12.5px; color:#78716C; }
                .rv-tail{ min-height:56dvh; padding:26px 0 0; text-align:center; font-family:${SANS}; font-size:12px; color:#A8A29E; }
            `}</style>

            <div className="rv-frame">
                <div className="rv-topbar">
                    <span className="rv-topttl">✅ आवाज समजून झाला</span>
                    <button className="rv-replay" onClick={play}>↻ पुन्हा बघा · Replay</button>
                </div>

                {/* TRANSCRIPT — shows first */}
                <div className="rv-transcript">
                    <div className="rv-tlabel">तुम्ही म्हणालात</div>
                    <div className="rv-tcard">
                        <p className="rv-tquote">"आज द्राक्षाच्या बागेत चार मजुरांना कामाला लावलं, प्रत्येकी सहाशे रुपये मजुरी दिली."</p>
                    </div>
                    <div className="rv-thint">श्रम साथीने लावलेली नोंद खाली ↓</div>
                </div>

                {/* SORTED LOG — auto-revealed */}
                <div
                    ref={sortedRef}
                    className={`rv-sorted ${reveal ? 'animate-slide-up' : ''}`}
                    style={{
                        borderRadius: '20px',
                        transition: 'box-shadow .6s ease',
                        boxShadow: reveal ? '0 0 0 2px rgba(16,185,129,.45), 0 10px 30px rgba(16,185,129,.16)' : 'none',
                    }}
                >
                    <div className="rv-slabel">आजची नोंद</div>
                    <div className="rv-scard">
                        <span className="rv-chip">🍇 द्राक्ष बाग</span>
                        <div className="rv-row"><span className="rv-rk">मजूर</span><span className="rv-rv">४ जण</span></div>
                        <div className="rv-row"><span className="rv-rk">मजुरी (प्रत्येकी)</span><span className="rv-rv">₹ ६००</span></div>
                        <div className="rv-row"><span className="rv-rk">काम</span><span className="rv-rv">बागेत मजुरी</span></div>
                        <div className="rv-total"><span className="rv-rk">एकूण मजुरी</span><span className="rv-rv">₹ २,४००</span></div>
                    </div>
                    <div className="rv-note">हीच नोंद खरं app मध्ये आपोआप वर येते — scroll करावं लागत नाही.</div>
                </div>
                <div className="rv-tail">खरं app मध्ये इथे पुढचा संपूर्ण फॉर्म येतो — मजुरी, खर्च, कामं…</div>
            </div>
        </div>
    );
}

export default AfterParseRevealDemo;
