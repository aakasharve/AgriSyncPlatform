/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionEngine — combined daily-question selector (Phase 5).
 *
 * Produces ONE question per farmer per local day using an 8-level priority ladder:
 *   1 Safety  2 Weather  3 StageWindow  4 Schedule  5 WeatherReconcile  6 Gap
 *   7 Followup  8 Learning
 * Applies per-question anti-repeat cooldowns (from recent question_events),
 * enforces the hard AgronomistApproved && MarathiApproved gate, and gates the
 * Learning tier behind DFES_TUNING.richDayThreshold. Pure: no React/DOM/network.
 *
 * spec: dfes-companion-2026-07-11
 */
import type { VlogScore } from '../../../domain/types/log.types';
import type { StageContext } from './meterGaps';
import { rankMeterGaps } from './meterGaps';
import { isStageConfirmationWindowOpen, type LastStageConfirm } from './dfesStageWindow';
import type { ScheduleGapContext } from './dfesScheduleWindow';
import type { WeatherReconcileContext } from './dfesWeatherReconcile';
import {
    TRIGGER_CONFIG, MAX_QUESTIONS_PER_DAY,
    findQuestion, findGapQuestion, type DfesQuestion, type DfesAnswerOption,
} from './dfesQuestionBank';
import { DFES_TUNING } from './dfesTuning';

export interface WeatherTriggerContext {
    rainProbNext6h?: number;
    windKph?: number;
    hasActiveAlert?: boolean;
    conditionText?: string;
}

/** A prior question_events row, projected to what cooldown/anti-repeat needs. */
export interface RecentQuestionEvent {
    questionKey: string;
    createdAtLocalDate: string; // 'YYYY-MM-DD'
    ageDays: number;
    /** True when the farmer explicitly skipped (vs. answered/acked) this question. */
    skipped: boolean;
}

/**
 * Gentle cooldown (days) applied when the MOST RECENT event for a question was
 * a SKIP rather than an answer/ack — closes the "skip silently hides the gap
 * for the full normal cooldown" loop (Task 2B). Founder-tunable, same spirit
 * as TRIGGER_CONFIG's thresholds: must stay small enough to never feel like
 * nagging (the one-question-per-day gate already forbids a same-day re-ask,
 * so this only controls how many days later a skipped question can resurface).
 * Clamped per-question in `effectiveCooldownDays` so a skip NEVER outlasts the
 * question's own normal `cooldownDays`.
 */
export const SKIP_COOLDOWN_DAYS = 3;

/** The cooldown that actually applies to a given recent event, honouring the skip clamp. */
function effectiveCooldownDays(q: DfesQuestion, event: RecentQuestionEvent): number {
    return event.skipped ? Math.min(SKIP_COOLDOWN_DAYS, q.cooldownDays) : q.cooldownDays;
}

export interface DailyQuestionInputs {
    crop: string;
    todayLocalDate: string;
    score?: VlogScore;
    stageContext?: StageContext;
    lastStageConfirm?: LastStageConfirm | null;
    weather?: WeatherTriggerContext;
    /** Task 3A — category-scoped "planned but not done today" signal (dfesScheduleWindow.ts). */
    scheduleContext?: ScheduleGapContext;
    /** Task 4B — severe-weather-with-no-logged-impact care-check signal (dfesWeatherReconcile.ts). */
    weatherReconcileContext?: WeatherReconcileContext;
    engagement: { totalRichDays: number; unlockStatus: 'locked' | 'unlocked' };
    recentEvents: RecentQuestionEvent[];
    openObservation?: { summary: string };
    /**
     * Task 7 — what the farmer actually did on their most recent prior working
     * day (dfesPreviousLog.computePreviousLog), so a question can refer back to
     * real work instead of asking in a vacuum. ABSENT when there is no such log:
     * P4 forbids inventing one, and `resolvePrompt` drops the whole clause
     * rather than filling it with a guess.
     */
    previousLog?: { activityMr: string; daysAgo: number };
}

export interface SelectedQuestion {
    question: DfesQuestion;
    resolvedPromptMr: string;
    triggerReason: string;
    weatherContext: string | null;
    expectedStage: string | null;
    actualStageApplicability: string | null;
    /** Tap-choice options (Task 2A), resolved straight from the bank entry; undefined when the question is ack/skip-only. */
    answerOptions?: DfesAnswerOption[];
}

/** Hard gate: unapproved questions are never selectable, even if present. */
function approved(q: DfesQuestion | undefined): q is DfesQuestion {
    return !!q && q.agronomistApproved && q.marathiApproved;
}

/**
 * A question is on cooldown when the same key was shown within its cooldown
 * window. A SKIPPED event uses the shorter `SKIP_COOLDOWN_DAYS` (clamped to
 * never exceed the question's normal `cooldownDays`); an answered/acked event
 * uses the normal `cooldownDays` unchanged (Task 2B).
 */
function onCooldown(q: DfesQuestion, recent: RecentQuestionEvent[]): boolean {
    return recent.some(e => e.questionKey === q.questionKey && e.ageDays < effectiveCooldownDays(q, e));
}

function eligible(q: DfesQuestion | undefined, recent: RecentQuestionEvent[]): q is DfesQuestion {
    return approved(q) && !onCooldown(q, recent);
}

/**
 * Resolve the Marathi prompt against everything the engine already knows.
 *
 * Founder ruling 3 (2026-08-14): a question must be context-rich, not generic.
 * The engine has always USED weather and stage to pick the question; it never
 * SPOKE them. It does now.
 *
 * Every token is stripped when its context is absent — a farmer must never see
 * a raw `{weather}`, and a sentence that reads oddly without its clause is a
 * copy problem to fix in the bank, not a reason to print a placeholder.
 *
 * One tokenising pass rather than a chain of `.replace` calls, so the
 * guarantee is structural rather than a list that has to stay in step with the
 * bank: EVERY `{token}` occurrence is matched (a template using a token twice
 * cannot leak the second one), and a token this resolver does not know about —
 * a copy typo like `{crops}` — is stripped exactly the same way instead of
 * reaching the farmer.
 *
 * Exported so the resolution itself is testable directly, without having to
 * add tokens to agronomist-approved bank copy to exercise it.
 *
 * KNOWN LIMIT — `{weather}`: WeatherTriggerContext.conditionText is the weather
 * provider's own text and is ENGLISH ('Clear', 'Light rain', 'Partly Cloudy');
 * there is no reviewed English->Marathi condition vocabulary in the repo, and
 * inventing one here would be unreviewed Marathi shipped in code. No bank entry
 * carries {weather} today, so nothing English can reach a farmer — but do NOT
 * add {weather} to a prompt until that vocabulary exists (or the numbers the
 * question already triggers on are spoken instead). Raised as a blocker in the
 * Task 7 context-rich-prompt drafts sent for agronomist review.
 */
export function resolvePrompt(promptMr: string, inputs: DailyQuestionInputs): string {
    const values: Readonly<Record<string, string | undefined>> = {
        crop: inputs.crop,
        observation: inputs.openObservation?.summary,
        category: inputs.scheduleContext?.categoryLabelMr,
        weather: inputs.weather?.conditionText,
        lastActivity: inputs.previousLog?.activityMr,
        daysAgo: inputs.previousLog === undefined ? undefined : String(inputs.previousLog.daysAgo),
    };
    return promptMr
        .replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => values[token] ?? '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.?!])/g, '$1')
        .trim();
}

function pack(q: DfesQuestion, inputs: DailyQuestionInputs, reason: string): SelectedQuestion {
    return {
        question: q,
        resolvedPromptMr: resolvePrompt(q.promptMr, inputs),
        triggerReason: reason,
        weatherContext: inputs.weather?.conditionText ?? null,
        expectedStage: inputs.stageContext?.expectedStage ?? null,
        actualStageApplicability: q.expectedStageApplicability ?? null,
        answerOptions: q.answerOptions,
    };
}

export function selectDailyQuestion(inputs: DailyQuestionInputs): SelectedQuestion | null {
    // ONE combined question/day — if any event already recorded today, stop.
    if (MAX_QUESTIONS_PER_DAY === 1
        && inputs.recentEvents.some(e => e.createdAtLocalDate === inputs.todayLocalDate)) {
        return null;
    }
    const recent = inputs.recentEvents;
    const w = inputs.weather;

    // P1 Safety — high wind makes spraying unsafe.
    if (w && (w.windKph ?? 0) >= TRIGGER_CONFIG.windKphThreshold) {
        const q = findQuestion('safety.spray_wind_high');
        if (eligible(q, recent)) return pack(q, inputs, `wind ${w.windKph}kph >= ${TRIGGER_CONFIG.windKphThreshold}`);
    }

    // P2 Weather — rain likely before a planned spray.
    if (w && (w.rainProbNext6h ?? 0) >= TRIGGER_CONFIG.rainProbThresholdPct) {
        const q = findQuestion('weather.rain_before_spray');
        if (eligible(q, recent)) return pack(q, inputs, `rainProbNext6h ${w.rainProbNext6h}% >= ${TRIGGER_CONFIG.rainProbThresholdPct}`);
    }

    // P3 StageWindow — planned-vs-actual confirmation window open.
    if (isStageConfirmationWindowOpen(inputs.stageContext, inputs.lastStageConfirm ?? null)) {
        const q = findQuestion('stage.confirm_current');
        if (eligible(q, recent)) return pack(q, inputs, `stage window open (expected=${inputs.stageContext?.expectedStage})`);
    }

    // P4 Schedule — category-scoped "was today's planned {category} work done?"
    // (Task 3A). Category-level only — never a fabricated precise task claim.
    if (inputs.scheduleContext) {
        const q = findQuestion('schedule.category_planned_not_done');
        if (eligible(q, recent)) return pack(q, inputs, `schedule gap: ${inputs.scheduleContext.category} planned, 0 done today`);
    }

    // P5 WeatherReconcile — severe weather recorded, no logged impact (Task
    // 4B). A warm care-check, never a doubt of the farmer's account — more
    // relevant than a generic gap, so it sits ahead of Gap.
    if (inputs.weatherReconcileContext) {
        const q = findQuestion('weather.severe_care_check');
        if (eligible(q, recent)) return pack(q, inputs, `weather reconcile: ${inputs.weatherReconcileContext.reason}`);
    }

    // P6 Gap — biggest comprehension gap from the (stage-aware) ranker.
    if (inputs.score) {
        for (const gap of rankMeterGaps(inputs.score, inputs.stageContext, 8)) {
            const q = findGapQuestion(gap.dimension);
            if (eligible(q, recent)) return pack(q, inputs, `gap ${gap.dimension} leverage ${gap.leverage}`);
        }
    }

    // P7 Followup — an open observation awaiting an outcome.
    if (inputs.openObservation) {
        const q = findQuestion('followup.observation_outcome');
        if (eligible(q, recent)) return pack(q, inputs, 'open observation outcome');
    }

    // P8 Learning — deepen once the farmer has EARNED it (>= richDayThreshold rich days).
    if (inputs.engagement.totalRichDays >= DFES_TUNING.richDayThreshold) {
        for (const key of ['learning.deepen_hypothesis', 'learning.next_experiment']) {
            const q = findQuestion(key);
            if (eligible(q, recent)) return pack(q, inputs, `learning tier (richDays ${inputs.engagement.totalRichDays})`);
        }
    }

    return null;
}
