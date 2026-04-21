/**
 * ReliabilityScoreCard — displays worker reliability metrics.
 * CEI Phase 4 §4.8
 *
 * Anti-ego rule:
 *   - Values are ratios/counts. Never "good/bad/high/low" moral labels.
 *   - Color bands are neutral (stone/emerald/amber) — not success/failure.
 *
 * Sections:
 *   - Big overall number (0–100)
 *   - 3 sub-bars: Verified ratio, OnTime ratio, Dispute-free ratio
 *   - Bilingual labels
 *   - "Show how this score is computed" audit link
 */

import React, { useState } from 'react';
import type { ReliabilityScore } from '../../../domain/work/ReliabilityScore';

interface ReliabilityScoreCardProps {
    score: ReliabilityScore;
    /** If provided, shows a "View profile" link */
    onViewProfile?: () => void;
}

const BarMetric: React.FC<{
    labelMr: string;
    labelEn: string;
    value: number; // 0.0–1.0
}> = ({ labelMr, labelEn, value }) => {
    const pct = Math.round(value * 100);
    const color = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-stone-300';

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <div>
                    <span
                        className="text-[11px] font-semibold text-stone-700"
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    >
                        {labelMr}
                    </span>
                    <span
                        className="text-[10px] text-stone-400 ml-1.5"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {labelEn}
                    </span>
                </div>
                <span
                    className="text-xs font-bold text-stone-600"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    {pct}%
                </span>
            </div>
            <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-300 ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

const FORMULA_EXPLANATION = `Overall score is a weighted average of:
• Verified ratio (40%) — job cards that reached VerifiedForPayout or PaidOut ÷ total completed
• On-time ratio (35%) — cards completed on or before planned date ÷ total completed
• Dispute-free ratio (25%) — cards without any dispute event ÷ total

Based on the last 30 calendar days. Cards in Draft or Assigned status are excluded.`;

const ReliabilityScoreCard: React.FC<ReliabilityScoreCardProps> = ({ score, onViewProfile }) => {
    const [showFormula, setShowFormula] = useState(false);

    const overallColor =
        score.overall >= 80 ? 'text-emerald-700' :
        score.overall >= 50 ? 'text-amber-700' :
        'text-stone-500';

    return (
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm p-5 flex flex-col gap-4">
            {/* Overall score */}
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full border-2 border-stone-100 shrink-0">
                    <span
                        className={`text-2xl font-black leading-none ${overallColor}`}
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {Math.round(score.overall)}
                    </span>
                    <span
                        className="text-[9px] text-stone-400 font-bold"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        / 100
                    </span>
                </div>
                <div className="flex-1">
                    <p
                        className="text-sm font-bold text-stone-800 leading-tight"
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    >
                        विश्वासार्हता गुण
                    </p>
                    <p
                        className="text-xs text-stone-500"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Reliability Score · 30-day window
                    </p>
                    <p
                        className="text-[10px] text-stone-400 mt-0.5"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {score.logCount30d} cards · {score.disputeCount30d} disputes
                    </p>
                </div>
                {onViewProfile && (
                    <button
                        onClick={onViewProfile}
                        className="text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1 shrink-0"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Profile
                    </button>
                )}
            </div>

            {/* Sub-bars */}
            <div className="flex flex-col gap-3">
                <BarMetric
                    labelMr="तपासणी प्रमाण"
                    labelEn="Verified ratio"
                    value={score.verifiedRatio}
                />
                <BarMetric
                    labelMr="वेळेवर प्रमाण"
                    labelEn="On-time ratio"
                    value={score.onTimeRatio}
                />
                <BarMetric
                    labelMr="वाद-मुक्त प्रमाण"
                    labelEn="Dispute-free ratio"
                    value={score.disputeFreeRatio}
                />
            </div>

            {/* Audit link */}
            <button
                onClick={() => setShowFormula(true)}
                className="text-[11px] font-semibold text-stone-400 text-left hover:text-stone-600 transition-colors"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
                Show how this score is computed →
            </button>

            {/* Formula modal */}
            {showFormula && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm px-4"
                    onClick={() => setShowFormula(false)}
                >
                    <div
                        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3
                                className="text-sm font-black text-stone-900"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Score Computation
                            </h3>
                            <button
                                onClick={() => setShowFormula(false)}
                                className="w-7 h-7 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
                            >
                                ×
                            </button>
                        </div>
                        <pre
                            className="text-[11px] text-stone-600 whitespace-pre-wrap leading-relaxed"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {FORMULA_EXPLANATION}
                        </pre>
                        <p
                            className="text-[10px] text-stone-400 mt-3"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Computed at: {new Date(score.computedAtUtc).toLocaleString('en-IN')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReliabilityScoreCard;
