/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the saved card's meter, drawn as the approved design draws it
 * (`cmMeterSvg`, `.mcard .mg`, `.rbm`): a half-circle dial 0–10, its needle and the number in the hub.
 *
 * The number is the SERVER's only (P4), read exactly as the result screen's meter reads it (`ResultHero`): this recording's plot
 * score (`usePlotDayUnderstanding`), the farm-day score for a recording with no plot (`useDayUnderstanding`), refetched for a new
 * log, a sync, or an answered question. No score yet (offline, still on its way, or 0) = the dial with no needle and the existing
 * pending words in the hub — never a guessed number. A declared no-work day says so. The design's amber "target" tick at 9 is not
 * drawn: nothing on the server says what the score could become.
 *
 * Under it, the design's question (`.mnext`) with its mic: the SERVER's own "tell more" line for this plot when it has one (the
 * plot row's `nextHint`, "the single most valuable part still missing", read by the existing `usePlotUnderstanding`; its mic is
 * the next recording); else the first part the day does not tell, whose mic opens the ONE mic for it (the red tile's own action).
 * Without the design's "→ N/10": no server field holds a projected score.
 */
import React, { useEffect, useState } from 'react';
import { useSelector } from '@xstate/react';
import { getRootStore } from '../../../../app/state/RootStore';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { usePlotUnderstanding } from '../../../reflect/overview/usePlotUnderstanding';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { useDayUnderstanding } from '../../hooks/useDayUnderstanding';
import { usePlotDayUnderstanding } from '../../hooks/usePlotDayUnderstanding';
import { subscribeDfesAnswered } from '../../services/dfesAnswerSignal';
import { PARTS, type PartKey } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import { SANS } from './savedBits';
import { savedWords } from './savedCopy';

/** The server's stored classification for a day he said had no work. Compared, never computed. */
const DECLARED_NO_WORK_DAY = 'DeclaredNoWorkDay';
const C = 150, CY = 124, R = 110;
const ARC = `M${C - R} ${CY} A${R} ${R} 0 0 1 ${C + R} ${CY}`;

/** The dial (`cmMeterSvg`). `score` null = no needle, no colour, the pending words in the hub. */
const Dial: React.FC<{ score: number | null; hub: string; language: string | undefined }> = ({ score, hub, language }) => {
    const [shown, setShown] = useState(0);
    // The needle swings up from 0 once the server's number is here (the design's 0.9 s ease-out).
    useEffect(() => { const id = requestAnimationFrame(() => setShown(score ?? 0)); return () => cancelAnimationFrame(id); }, [score]);
    const lit = score == null ? -1 : Math.round(shown);
    const ease = 'motion-safe:transition-all motion-safe:duration-[900ms] motion-safe:ease-out';
    return (
        <svg viewBox="0 0 300 186" aria-hidden="true" className="mx-auto -mb-2 -mt-1 block h-[155px] w-[250px]">
            <defs>
                <linearGradient id="vr2-dial-g" x1="0" x2="1"><stop offset="0" stopColor="#1E9E5A" /><stop offset=".55" stopColor="#13A8A0" /><stop offset="1" stopColor="#2D7FF9" /></linearGradient>
            </defs>
            <path d={ARC} fill="none" stroke="#E7DFC6" strokeWidth="16" strokeLinecap="round" />
            {score != null && <path d={ARC} fill="none" stroke="url(#vr2-dial-g)" strokeWidth="16" strokeLinecap="round" className={ease} strokeDasharray={`${(Math.PI * R * shown) / 10} 400`} />}
            {Array.from({ length: 11 }, (_, k) => {
                const a = Math.PI + (k * Math.PI) / 10, cs = Math.cos(a), sn = Math.sin(a), r1 = R - 14, r2 = R - (k % 5 === 0 ? 26 : 21);
                return (
                    <g key={k}>
                        <line x1={C + r1 * cs} y1={CY + r1 * sn} x2={C + r2 * cs} y2={CY + r2 * sn} stroke="#8C7B4B" strokeWidth={k % 5 === 0 ? 3 : 2} strokeLinecap="round" />
                        <text x={C + (R - 38) * cs} y={CY + (R - 38) * sn + 4} textAnchor="middle" fontSize="12" fontWeight="800" style={{ fontFamily: SANS }}
                            fill={k <= lit ? '#1E56E6' : '#6B5D33'}>{digitsFor(k, language)}</text>
                    </g>
                );
            })}
            {score != null && (
                <g className={ease} style={{ transformOrigin: `${C}px ${CY}px`, transform: `rotate(${-90 + shown * 18}deg)` }} data-testid="vr2-meter-needle">
                    <path d={`M${C - 5} ${CY} L${C} ${CY - R + 28} L${C + 5} ${CY} Z`} fill="#1C1917" />
                    <circle cx={C} cy={CY} r="11" fill="#1C1917" /><circle cx={C} cy={CY} r="4.5" fill="#E8A317" />
                </g>
            )}
            <rect x={C - 58} y={CY + 16} width="116" height="44" rx="12" fill="#FFFDF6" stroke="#E6D7AE" />
            {score != null ? (
                <>
                    <text x={C - 4} y={CY + 50} textAnchor="end" fontSize="32" fontWeight="700" fill="#1E56E6" style={{ fontFamily: SANS }}>{hub}</text>
                    <text x={C + 2} y={CY + 48} textAnchor="start" fontSize="12" fontWeight="800" fill="#6B5D33" style={{ fontFamily: SANS }}>/ {digitsFor(10, language)}</text>
                </>
            ) : (
                <text x={C} y={CY + 43} textAnchor="middle" fontSize="13" fontWeight="800" fill="#6B5D33" style={{ fontFamily: SANS }}>{hub}</text>
            )}
        </svg>
    );
};

export interface SavedMeterGaugeProps {
    farmId: string | null;
    dayDate: string | undefined;
    plotId: string | null;
    savedLogId: string | null;
    missing: readonly PartKey[];
}

export const SavedMeterGauge: React.FC<SavedMeterGaugeProps> = ({ farmId, dayDate, plotId, savedLogId, missing }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const SW = savedWords(language);
    const lastSyncAtMs = useSelector(getRootStore().sync, s => s.context.lastSyncAtMs);
    const refreshKey = `${savedLogId ?? ''}:${lastSyncAtMs ?? ''}`;
    const { score: farmScore, classification, refresh } = useDayUnderstanding(farmId, dayDate, refreshKey);
    const plot = usePlotDayUnderstanding(farmId, plotId, dayDate, refreshKey);
    const raw = plotId ? plot.score : farmScore;
    const refreshPlot = plot.refresh;
    useEffect(() => subscribeDfesAnswered(() => { void refresh(); void refreshPlot(); }), [refresh, refreshPlot]);
    const noWork = classification === DECLARED_NO_WORK_DAY;
    // The result screen's own rule (RingStage): a score is shown only above 0; otherwise the gentle pending words.
    const score = !noWork && raw != null && raw > 0 ? Math.min(10, raw) : null;
    const hub = score != null ? digitsFor(Number.isInteger(score) ? score : Math.round(score * 10) / 10, language) : noWork ? '' : RS.meterPending;
    const serverLine = usePlotUnderstanding(farmId, dayDate ?? '', !!plotId && !!dayDate, refreshKey).hintFor(plotId, language);
    const next = PARTS.find(p => missing.includes(p.key))?.key;
    const ask: readonly [string, string] | null = serverLine ? [serverLine, ''] : next ? [`${SW.askPrefix}${SW.asks[next][0]}`, SW.asks[next][1]] : null;
    return (
        <>
            <div className="mt-0.5 text-[13px] font-extrabold text-[#8A6400]" data-testid="vr2-meter-title">{SW.meterTitle}</div>
            <div data-testid="vr2-meter" data-score={score ?? ''} data-state={score != null ? 'score' : noWork ? 'no-work' : 'pending'}>
                <Dial score={score} hub={hub} language={language} />
                {score == null && <span className="sr-only" data-testid="vr2-meter-pending">{noWork ? RS.noWorkDay : RS.meterPending}</span>}
            </div>
            {noWork && <p className="m-0 text-center text-[13px] font-bold text-stone-700">{RS.noWorkDay}</p>}
            {/* Founder 2026-11-23: no second mic here — the ONE mic is the bottom bar's "आणखी सांगा". The question stays as plain words. */}
            {ask && (
                <p className="m-0 w-full rounded-2xl border-2 border-[#F3D27A] bg-[#FFFDF3] px-3 py-2 text-[14.5px] font-extrabold leading-[1.3] text-[#1C1917]"
                    data-testid="vr2-meter-next" data-part={serverLine ? undefined : next} data-source={serverLine ? 'server' : 'untold-part'}>
                    {ask[0]}
                    {ask[1] && <small className="block text-[11.5px] font-semibold text-[#5F6B63]">{ask[1]}</small>}
                </p>
            )}
        </>
    );
};

export default SavedMeterGauge;
