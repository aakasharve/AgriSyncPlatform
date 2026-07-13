/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Ledger "Saved" recognition surface host. Owns the
 * single useFarmerEngagement fetch for the current farm and feeds both the
 * (understandingMeter-gated) Understanding Bar — via MeterQuestionHost, which
 * additionally threads the Phase 5 combined D8 question in behind the
 * stageQuestions flag — and the (disciplineSystem-gated) DisciplineStrip.
 * Each child self-gates on its flag, and the fetches self-gate on the DFES
 * flags, so this panel renders unconditionally and is inert + network-silent
 * in production while all flags are OFF.
 *
 * Task 3B (spec: dfes-companion-2026-07-11): this is also where the
 * DailyQuestionInputs object is assembled, so it's the call site for
 * computeScheduleGap (Task 3A's pure "planned but not done today" signal) —
 * gated on the SAME stageQuestions+farmId condition MeterQuestionHost uses
 * for useDfesQuestion, so a flag-OFF build never runs the plan derivation.
 *
 * Task 4A (spec: dfes-companion-2026-07-11): same call site, same gate, now
 * also builds WeatherTriggerContext from the live `weather` (DetailedWeather)
 * prop — wakes the P1/P2 forward-looking safety/weather questions
 * (safety.spray_wind_high / weather.rain_before_spray), which were dormant
 * because `weather` was never populated on DailyQuestionInputs. Forward-
 * looking planning caution ("wind's high / rain likely before your spray"),
 * never a judgement of past work. `hasActiveAlert` is deliberately omitted —
 * the saved log's own weatherStamp (which carries `alerts`) is not in this
 * panel's `savedLog` prop shape, and threading more of it in is out of scope
 * here (KISS); `hasActiveAlert` is optional on WeatherTriggerContext so
 * omitting it is honest, not a fabrication.
 */
import React from 'react';
import type { VlogScore } from '../../../domain/types/log.types';
import type { CropProfile, DailyLog } from '../../../types';
import type { DetailedWeather } from '../../../domain/types/weather.types';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { useFarmerEngagement } from '../hooks/useFarmerEngagement';
import { computeScheduleGap } from '../services/dfesScheduleWindow';
import type { WeatherTriggerContext } from '../services/dfesQuestionEngine';
import { MeterQuestionHost } from './MeterQuestionHost';
import { DisciplineStrip } from './DisciplineStrip';

/**
 * Task 4A: project the live WeatherWidget data (DetailedWeather) onto the
 * question engine's WeatherTriggerContext. Never fabricates a field — each
 * one is included only when the source data actually has it, and the whole
 * context collapses to `undefined` when NONE of them are present (mirrors
 * computeScheduleGap's `?? undefined` pattern above).
 */
function buildWeatherContext(weather: DetailedWeather | null | undefined): WeatherTriggerContext | undefined {
    const windKph = weather?.current?.current?.windKph;
    const rainProbNext6h = weather?.current?.forecast?.rainProb;
    const conditionText = weather?.current?.current?.conditionText;
    if (windKph === undefined && rainProbNext6h === undefined && conditionText === undefined) {
        return undefined;
    }
    return { windKph, rainProbNext6h, conditionText };
}

export interface LedgerRecognitionPanelProps {
    farmId: string | null;
    /** Phase 5: the saved log's plot, feeds the D8 question's plot-scoped telemetry. */
    plotId?: string | null;
    /** Phase 5: the saved log's crop name, resolves the D8 question's {crop} placeholder. */
    crop?: string;
    /** Phase 5: the saved log's local date ('YYYY-MM-DD'); falls back to today. */
    todayLocalDate?: string;
    /**
     * Task 3B: the farmer's crops/plots (same `crops` prop mainView hands its
     * other siblings, e.g. ReflectPage/ComparePage) — feeds computeScheduleGap's
     * plot-schedule lookup. Optional/defaulted so this panel keeps working
     * everywhere it's already mounted without crops in scope.
     */
    crops?: CropProfile[];
    savedLog?: { understanding?: VlogScore };
    allLogs?: DailyLog[];
    /**
     * Task 4A: the live WeatherWidget data (mainView's `weatherData`, same
     * object the header widget renders) — feeds WeatherTriggerContext.
     * Optional/defaulted so this panel keeps working everywhere it's already
     * mounted without weather in scope (same pattern as `crops` in 3B).
     */
    weather?: DetailedWeather | null;
}

export function LedgerRecognitionPanel({
    farmId,
    plotId = null,
    crop = '',
    todayLocalDate,
    crops = [],
    savedLog,
    allLogs = [],
    weather = null,
}: LedgerRecognitionPanelProps): React.ReactElement {
    const { engagement } = useFarmerEngagement(farmId);
    const resolvedDate = todayLocalDate ?? new Date().toISOString().slice(0, 10);

    // Task 3B: same gate MeterQuestionHost derives for useDfesQuestion — only
    // run the plan-derivation-backed gap lookup when the question surface can
    // actually use the result, so a flag-OFF (or farm-less) render does zero
    // extra work. Recomputed every render, same as `questionInputs`/`resolvedDate`
    // below (this component memoizes nothing today, so this follows suit).
    const questionsEnabled = FEATURE_FLAGS.stageQuestions && !!farmId;
    const scheduleContext = questionsEnabled
        ? computeScheduleGap(crops, allLogs, plotId, resolvedDate) ?? undefined
        : undefined;
    // Task 4A: SAME gate — a flag-OFF (or farm-less) render builds no weather
    // context either, zero extra work.
    const weatherContext = questionsEnabled ? buildWeatherContext(weather) : undefined;

    return (
        <div data-testid="ledger-recognition-panel" className="space-y-4">
            <MeterQuestionHost
                farmId={farmId}
                plotId={plotId}
                score={savedLog?.understanding}
                allLogs={allLogs}
                engagement={engagement}
                questionInputs={{
                    crop,
                    todayLocalDate: resolvedDate,
                    score: savedLog?.understanding,
                    scheduleContext,
                    weather: weatherContext,
                    engagement: {
                        totalRichDays: engagement?.totalRichDays ?? 0,
                        unlockStatus: engagement?.unlockStatus ?? 'locked',
                    },
                }}
            />
            <DisciplineStrip engagement={engagement} />
        </div>
    );
}
