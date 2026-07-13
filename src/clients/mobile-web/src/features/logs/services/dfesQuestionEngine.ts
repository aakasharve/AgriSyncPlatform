/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionEngine — combined daily-question selector (Phase 5).
 *
 * Produces ONE question per farmer per local day using a 7-level priority ladder:
 *   1 Safety  2 Weather  3 StageWindow  4 Schedule  5 Gap  6 Followup  7 Learning
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
    engagement: { totalRichDays: number; unlockStatus: 'locked' | 'unlocked' };
    recentEvents: RecentQuestionEvent[];
    openObservation?: { summary: string };
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

function resolvePrompt(promptMr: string, inputs: DailyQuestionInputs): string {
    return promptMr
        .replace('{crop}', inputs.crop)
        .replace('{observation}', inputs.openObservation?.summary ?? '')
        .replace('{category}', inputs.scheduleContext?.categoryLabelMr ?? '');
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

    // P3.5 Schedule — category-scoped "was today's planned {category} work done?"
    // (Task 3A). Category-level only — never a fabricated precise task claim.
    if (inputs.scheduleContext) {
        const q = findQuestion('schedule.category_planned_not_done');
        if (eligible(q, recent)) return pack(q, inputs, `schedule gap: ${inputs.scheduleContext.category} planned, 0 done today`);
    }

    // P5 Gap — biggest comprehension gap from the (stage-aware) ranker.
    if (inputs.score) {
        for (const gap of rankMeterGaps(inputs.score, inputs.stageContext, 8)) {
            const q = findGapQuestion(gap.dimension);
            if (eligible(q, recent)) return pack(q, inputs, `gap ${gap.dimension} leverage ${gap.leverage}`);
        }
    }

    // P6 Followup — an open observation awaiting an outcome.
    if (inputs.openObservation) {
        const q = findQuestion('followup.observation_outcome');
        if (eligible(q, recent)) return pack(q, inputs, 'open observation outcome');
    }

    // P7 Learning — deepen once the farmer has EARNED it (>= richDayThreshold rich days).
    if (inputs.engagement.totalRichDays >= DFES_TUNING.richDayThreshold) {
        for (const key of ['learning.deepen_hypothesis', 'learning.next_experiment']) {
            const q = findQuestion(key);
            if (eligible(q, recent)) return pack(q, inputs, `learning tier (richDays ${inputs.engagement.totalRichDays})`);
        }
    }

    return null;
}
