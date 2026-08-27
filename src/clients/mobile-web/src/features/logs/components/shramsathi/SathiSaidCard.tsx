/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SathiSaidCard — the head of the post-save surface.
 *
 * REPLACES the "Saved to Ledger" leaf banner (founder, 2026-08-13). That banner
 * was the SYSTEM reporting a database outcome in English, to a Marathi farmer,
 * one screen after a character had been listening to them. The companion simply
 * vanished at the moment it had something to say.
 *
 * So the character stays. Same orb, same cream, same living green+blue glows and
 * the same video as ShramSathiUnderstanding — the farmer never loses the thread:
 * he listened, now he is telling you what he understood.
 *
 * The line is FIRST-PERSON and PRESENT-TENSE ("समजून घेत आहे" — is understanding),
 * because the day is still being folded in as more work is logged. It does not
 * claim completion, and it never says "saved" — storage is our concern, not the
 * farmer's.
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { useLanguage } from '../../../../i18n/LanguageContext';

const SERIF = "'Noto Serif Devanagari', serif";

export interface SathiSaidCardProps {
    /** Optional quieter second line (e.g. plot + crop context). */
    sub?: string | null;
}

// mainView's render functions are hook-free, so this component owns its own copy
// (the same pattern DayUnderstandingCard and DailyLoopHero already follow) rather
// than taking a pre-translated string from a caller that has no language in scope.
export function SathiSaidCard({ sub }: SathiSaidCardProps): React.ReactElement {
    const { t } = useLanguage();
    const line = t('dfes.sathiSaidLine');
    return (
        <div data-testid="sathi-said" className="ss-said">
            <style>{`
                /* Glows + breathing lifted verbatim from ShramSathiUnderstanding so
                   the two screens are unmistakably the same character. */
                @keyframes ssBreathe{0%,100%{transform:scale(1) translateY(0)}50%{transform:scale(1.02) translateY(-2px)}}
                @keyframes ssG1{0%,100%{opacity:.16;transform:translate(-50%,-50%) scale(.85)}45%{opacity:.85;transform:translate(-50%,-50%) scale(1.12)}}
                @keyframes ssG2{0%,100%{opacity:.18;transform:translate(-50%,-50%) scale(.92)}55%{opacity:.9;transform:translate(-50%,-50%) scale(1.16)}}
                @keyframes ssRise{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}

                .ss-said{ display:flex; flex-direction:column; align-items:center; text-align:center; padding:0; }
                .ss-orbwrap{ position:relative; display:grid; place-items:center; }
                .ss-glint{ position:absolute; aspect-ratio:1; transform:translate(-50%,-50%);
                    border-radius:9999px; pointer-events:none; filter:blur(11px); }
                .ss-glint.a{ left:50%; top:8%;  width:46%; background:radial-gradient(circle, rgba(22,178,78,.75), transparent 67%); animation:ssG1 3.8s ease-in-out infinite; }
                .ss-glint.b{ left:86%; top:30%; width:42%; background:radial-gradient(circle, rgba(28,108,240,.72), transparent 65%); animation:ssG2 4.9s ease-in-out .6s infinite; }
                .ss-glint.c{ left:14%; top:70%; width:40%; background:radial-gradient(circle, rgba(26,185,84,.7), transparent 64%);  animation:ssG2 4.4s ease-in-out 1.6s infinite; }
                .ss-orb{ position:relative; width:76px; aspect-ratio:1; border-radius:9999px; overflow:hidden;
                    background:rgb(255,246,198);
                    box-shadow:0 6px 20px rgba(0,0,0,.07), 0 0 26px rgba(16,185,129,.24);
                    animation:ssBreathe 5.5s ease-in-out infinite; }
                .ss-orb > video{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
                    transform:translateY(5%) scale(.94); transform-origin:center;
                    -webkit-mask-image:radial-gradient(circle at 50% 44%, #000 60%, transparent 82%);
                    mask-image:radial-gradient(circle at 50% 44%, #000 60%, transparent 82%); }
                .ss-line{ margin:9px 0 0; font-family:${SERIF}; font-weight:700; font-size:clamp(15px,4.2vw,17px);
                    line-height:1.4; color:#134E36; max-width:26ch; animation:ssRise .5s ease both; }
                .ss-sub{ margin:6px 0 0; font-family:'Noto Sans Devanagari', sans-serif; font-weight:600;
                    font-size:12.5px; color:#78716C; animation:ssRise .5s .08s ease both; }

                @media (prefers-reduced-motion: reduce){
                    .ss-orb, .ss-glint, .ss-line, .ss-sub { animation:none !important; }
                }
            `}</style>

            <div className="ss-orbwrap">
                <span className="ss-glint a" />
                <span className="ss-glint b" />
                <span className="ss-glint c" />
                <div className="ss-orb">
                    <video autoPlay loop muted playsInline preload="auto">
                        <source src="/assets/shramsathi/shramsathi-a.mp4" type="video/mp4" />
                    </video>
                </div>
            </div>

            <p className="ss-line">{line}</p>
            {sub ? <p className="ss-sub">{sub}</p> : null}
        </div>
    );
}

export default SathiSaidCard;
