/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — Day Understanding Score surface (flag-gated; SIMPLE visuals).
 *
 * Shows the farmer-facing **Day Understanding Score X/१०** — the ASSISTANT's
 * understanding of the farmer's day ("मी तुमचा आजचा दिवस समजून घेतला — X/१०"),
 * NOT a grade of the farmer. The number is fetched server-side via
 * useDayUnderstanding (GET /shramsafal/day-understanding) for the active farm +
 * day; the 3 internal lenses that produce it NEVER reach the client and are
 * NEVER rendered here.
 *
 * dfes-companion-2026-07-11 (Slice 3b): the DISPLAYED number is now the server
 * /10, replacing the earlier client-side scoreVlog /100 readout. The scoreVlog
 * VlogScore prop stays — but ONLY to rank question GAPs (rankMeterGaps); it is no
 * longer shown as a farmer number. On a null score OR an offline/failed fetch we
 * show NO number (a gentle "अजून समजतंय…") — never a 0, never shame, and never a
 * fall back to the client /100 (which diverges from the server).
 *
 * Still gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert
 * and network-silent in production. The polished visual identity (face, palette,
 * reveal) is a later founder-verified pass — no character art here.
 *
 * spec: ai-intelligence-plan-2026-06-25 · dfes-companion-2026-07-11
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { rankMeterGaps } from '../services/meterGaps';
import { computeMeterArrival } from '../services/meterArrival';
import { DFES_TUNING } from '../services/dfesTuning';
import { toMarathiNumber } from '../services/disciplineRecognition';
import { useDayUnderstanding } from '../hooks/useDayUnderstanding';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { VlogScore } from '../../../domain/types/log.types';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import type { SelectedQuestion } from '../services/dfesQuestionEngine';
import UnderstandingBar from './shramsathi/UnderstandingBar';

// Marathi body text must render with Noto Sans Devanagari (incl. the Devanagari
// numerals ०-९) — never system-ui / generic fallbacks. See CHARTER §Font rules.
const SANS = "'Noto Sans Devanagari', sans-serif";

/** The Day Understanding Score is always out of 10 (rendered "X / १०"). */
const UNDERSTANDING_MAX = 10;

export interface MeterDisplayProps {
    /** The just-saved log's understanding score (undefined until wired/available). Used ONLY for question-gap ranking now — NOT as the farmer number. */
    score?: VlogScore;
    /** All of the farmer's logs (each may carry an `understanding` VlogScore) — drives the arrival gate. */
    allLogs?: Array<{ understanding?: VlogScore }>;
    /** Server-folded engagement projection; when present it is the source of the arrival gate. */
    engagement?: FarmerEngagementDto | null;
    /** Active farm — drives the Day Understanding Score fetch. */
    farmId?: string | null;
    /** Local date ('YYYY-MM-DD') the score is for; omitted → server defaults to today. */
    dayDate?: string;
    /** Phase 5: the combined D8 question for today (null when none). Gated by stageQuestions. */
    dfesQuestion?: SelectedQuestion | null;
    /** Phase 5: fired when the farmer taps the combined question card. */
    onQuestionInteract?: () => void;
}

export function MeterDisplay({
    score,
    allLogs = [],
    engagement,
    farmId,
    dayDate,
    dfesQuestion,
    onQuestionInteract,
}: MeterDisplayProps): React.ReactElement | null {
    const { t } = useLanguage();
    // Day Understanding Score (server /10). The hook self-gates on
    // understandingMeter, so with the flag OFF this issues ZERO network calls —
    // safe to call above the flag early-return below.
    const { score: dayUnderstandingScore } = useDayUnderstanding(farmId ?? null, dayDate);

    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const gaps = score ? rankMeterGaps(score) : [];
    // The server-folded engagement projection is the arrival source of truth
    // when present; otherwise fall back to the client-side computeMeterArrival
    // gate over the local logs.
    const arrival = engagement
        ? {
            richLogCount: engagement.totalRichDays,
            target: DFES_TUNING.richDayThreshold,
            arrived: engagement.unlockStatus === 'unlocked',
        }
        : computeMeterArrival(allLogs);

    // Phase 5: when stageQuestions is ON and a combined question is available,
    // surface it as the single tappable card ahead of the raw placeholder gaps.
    const combinedQuestion = FEATURE_FLAGS.stageQuestions && dfesQuestion ? dfesQuestion : null;

    return (
        <div data-testid="meter-display" className="mt-6 rounded-2xl border border-dashed border-stone-300 p-4 text-left">
            <div data-testid="meter-score" style={{ fontFamily: SANS }}>
                {dayUnderstandingScore != null ? (
                    <div data-testid="day-understanding">
                        <p data-testid="day-understanding-intro" className="text-sm text-stone-600">
                            {t('dfes.dayUnderstandingIntro')}
                        </p>
                        <p data-testid="day-understanding-value" className="mt-1 text-3xl font-bold text-stone-800">
                            {`${toMarathiNumber(dayUnderstandingScore)} / ${toMarathiNumber(UNDERSTANDING_MAX)}`}
                        </p>
                        {/* Simple green→blue bar (colour borrowed from the waveform) under the number. */}
                        <div className="mt-3">
                            <UnderstandingBar score={dayUnderstandingScore} max={UNDERSTANDING_MAX} />
                        </div>
                    </div>
                ) : (
                    // score null OR fetch failed/offline → NO number, gentle pending.
                    // Never a 0, never shame, never the client /100 fallback.
                    <p data-testid="day-understanding-pending" className="text-sm text-stone-500">
                        {t('dfes.dayUnderstandingPending')}
                    </p>
                )}
            </div>
            <div data-testid="meter-arrival" className="mt-2 text-xs text-stone-500" style={{ fontFamily: SANS }}>
                {t('dfes.meterArrivalProgress')
                    .replace('{count}', String(arrival.richLogCount))
                    .replace('{target}', String(arrival.target))}
                {arrival.arrived ? t('dfes.meterArrivalArrived') : ''}
            </div>
            {combinedQuestion ? (
                <button
                    type="button"
                    data-testid="shramsathi-gap-question"
                    onClick={() => onQuestionInteract?.()}
                    className="mt-2 w-full rounded-xl bg-stone-100 px-3 py-2 text-left text-xs font-medium text-stone-800"
                >
                    {combinedQuestion.resolvedPromptMr}
                </button>
            ) : (
                gaps.length > 0 && (
                    <ul data-testid="meter-gaps" className="mt-2 space-y-1">
                        {gaps.map((g) => (
                            <li key={g.questionKey} className="text-xs text-stone-700">{g.question}</li>
                        ))}
                    </ul>
                )
            )}
        </div>
    );
}
