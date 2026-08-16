/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Ledger "Saved" recognition surface host. Owns the
 * single useFarmerEngagement fetch for the current farm and feeds both the
 * (understandingMeter-gated) question/gap surface — via MeterQuestionHost, which
 * additionally threads the Phase 5 combined D8 question in behind the
 * stageQuestions flag — and the (disciplineSystem-gated) DisciplineStrip.
 * Each child self-gates on its flag, and the fetches self-gate on the DFES
 * flags, so this panel renders unconditionally and is inert + network-silent
 * in production while all flags are OFF.
 *
 * 2026-07-19 (founder request): the Day Understanding Score + UnderstandingBar
 * are NO LONGER hosted here. They live in shramsathi/DayUnderstandingCard, which
 * mainView renders at the TOP of the success surface, directly under "Saved to
 * Ledger" — above the crop summary, the clarity line and this panel.
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
 * threading the saved log's own weatherStamp `alerts` into this context is
 * out of scope here (KISS), even though Task 4B below widens `savedLog` to
 * the full `DailyLog` (so weatherStamp IS reachable from this panel now);
 * `hasActiveAlert` is optional on WeatherTriggerContext so omitting it is
 * honest, not a fabrication.
 *
 * Task 4B (spec: dfes-companion-2026-07-11): `savedLog` is widened from
 * `{ understanding? }` to the full `DailyLog` (mainView already passes the
 * full saved-log object — backward-compatible, same widening 3B already did
 * for `allLogs`), so this call site can also run reconcileWeather (the pure
 * "severe weather, no logged impact" care-check signal) under the SAME
 * questionsEnabled gate as scheduleContext/weatherContext.
 *
 * Task 7 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14): same call
 * site, same gate, now also runs computePreviousLog over the SAME `allLogs`
 * ledger — the farmer's most recent prior working day, so the day's question
 * can refer back to real work ("{daysAgo} दिवसांपूर्वी {lastActivity}") instead of
 * asking in a vacuum. `resolvedDate` is the SAVED log's own date, so the log
 * just written is never cited as "last time". No prior working log means the
 * field stays undefined and the clause disappears (P4 — never invented).
 *
 * Task 8 (spec: dfes-companion-2026-07-11): this is also the fire-once
 * wire for "Sathi talks back" — the same live `engagement` this panel
 * already fetches carries `unlockStatus`, so a `useEffect` here speaks the
 * one warm Marathi unlock line (web speechSynthesis) the FIRST time this
 * panel observes `unlocked` for a given farm. Because this panel remounts
 * on every save (per Slice 3b's own doc above), the guard is a durable
 * localStorage flag (unlockSpeechStore), not a ref — a ref would reset on
 * every remount and re-speak on every subsequent save.
 */
import React, { useEffect } from 'react';
import type { DailyLog } from '../../../domain/types/log.types';
import type { CropProfile } from '../../../types';
import type { DetailedWeather } from '../../../domain/types/weather.types';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { t as translateForced } from '../../../i18n/translations';
import { useFarmerEngagement } from '../hooks/useFarmerEngagement';
import { computeScheduleGap } from '../services/dfesScheduleWindow';
import { reconcileWeather } from '../services/dfesWeatherReconcile';
import { computePreviousLog } from '../services/dfesPreviousLog';
import type { WeatherTriggerContext } from '../services/dfesQuestionEngine';
import { speakUnlockReward } from '../../../infrastructure/voice/speakUnlockReward';
import { wasUnlockSpoken, markUnlockSpoken } from '../../../infrastructure/storage/unlockSpeechStore';
import { MeterQuestionHost } from './MeterQuestionHost';
import { DisciplineStrip } from './DisciplineStrip';
import SurfaceSection from './shramsathi/SurfaceSection';

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
    /**
     * Task 4B: widened from `{ understanding? }` to the full DailyLog so this
     * panel can also read `weatherStamp`/`disturbance` for reconcileWeather.
     * mainView already passes the full saved-log object here (backward-compatible).
     */
    savedLog?: DailyLog;
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
    // Task 4B: SAME gate — a flag-OFF (or farm-less) render never runs the
    // severe-weather-reconciliation check either, zero extra work.
    const weatherReconcileContext = questionsEnabled ? reconcileWeather(savedLog) ?? undefined : undefined;
    // Task 7: SAME gate — the farmer's most recent prior working day, read off
    // the same real `allLogs` ledger the schedule gap already uses, so a
    // question can refer back to actual work. `undefined` when there is no such
    // log (P4: never invented) — resolvePrompt then drops the clause entirely.
    const previousLog = questionsEnabled
        ? computePreviousLog(allLogs, plotId, resolvedDate) ?? undefined
        : undefined;

    // Task 8: "Sathi talks back" — fires the spoken unlock reward EXACTLY
    // ONCE ever per farm. Flag OFF returns immediately: no speak, no
    // localStorage write, byte-equivalent no-op. The line is read from the
    // `mr` translation directly (translateForced(..., 'mr')), never the
    // UI-language-bound `t()` — Sathi's SPOKEN persona is always Marathi,
    // regardless of what language the farmer reads the app in.
    useEffect(() => {
        if (!FEATURE_FLAGS.spokenUnlockReward) return;
        if (!farmId) return;
        if (engagement?.unlockStatus !== 'unlocked') return;
        if (wasUnlockSpoken(farmId)) return;
        speakUnlockReward(translateForced('dfes.unlockSpokenLine', 'mr'));
        markUnlockSpoken(farmId);
    }, [engagement?.unlockStatus, farmId]);

    // REDESIGN 2026-08-13 — the two children are different KINDS of thing and now
    // say so. The question is marigold ("साथीला अजून हवं आहे" — it needs the farmer);
    // the streak is emerald ("तुमचं सातत्य" — it is a reward). Each child still
    // self-gates on its own flag and returns null when off, so the section wrapper
    // is gated on the same flag — otherwise an empty coloured box would render.
    const question = (
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
                weatherReconcileContext,
                previousLog,
                // wave-3.1 (spec: dfes-companion-2026-07-11) — WHICH log this question is
                // about. It is what lets wave-3.2 ask Monday's and Wednesday's spray logs
                // for a dose each, while never asking the same log twice. Undefined before
                // a log is saved; the engine then keeps day-scoped cooldowns.
                sourceLogId: savedLog?.id,
                engagement: {
                    totalRichDays: engagement?.totalRichDays ?? 0,
                    unlockStatus: engagement?.unlockStatus ?? 'locked',
                },
            }}
        />
    );

    return (
        <div data-testid="ledger-recognition-panel">
            {FEATURE_FLAGS.understandingMeter ? (
                <SurfaceSection tone="ask" labelKey="dfes.sectionAsk" noteKey="dfes.askRaisesScore" testId="section-ask">
                    {question}
                </SurfaceSection>
            ) : question}

            {FEATURE_FLAGS.disciplineSystem && engagement ? (
                <SurfaceSection tone="streak" labelKey="dfes.sectionStreak" testId="section-streak">
                    <DisciplineStrip engagement={engagement} />
                </SurfaceSection>
            ) : <DisciplineStrip engagement={engagement} />}
        </div>
    );
}
