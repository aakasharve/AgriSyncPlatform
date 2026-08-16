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
    /**
     * wave-3.1 — `ssf.question_events.daily_log_id`: the log this question was about.
     * `null` on every row written before wave-3.1.
     *
     * REQUIRED-but-nullable on purpose. Declaring it optional would let a construction
     * site silently default to undefined, and wave-3.2's per-log dedupe reads this field
     * to decide whether a question may be asked again. The compiler surfacing every
     * construction site IS the point.
     */
    dailyLogId: string | null;
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
    /**
     * wave-3.1 — the DailyLog this question is about, and wave-3.2's per-log dedupe key
     * (spec Ruling 1). Absent when the panel has no saved log yet: the engine then falls
     * back to day-scoped cooldowns exactly as before, which is the safe direction.
     */
    sourceLogId?: string;
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

/**
 * wave-3.2, Ruling 1 (2026-08-15). Execution-gap questions dedupe per SOURCE LOG,
 * permanently — Monday's and Wednesday's spray logs may BOTH be asked for a dose.
 * Context questions (crop stage, previous observation, learning) keep day-based
 * cooldowns, because they build the relationship rather than repair one record.
 *
 * The split is read from bank metadata already present: GAP_LENS assigns
 * WHAT/DOSE/CARRIER/COST to 'Execution'. No new vocabulary, no second list to drift.
 */
function isPerLogScoped(q: DfesQuestion): boolean {
    return q.triggerType === 'Gap' && q.lens === 'Execution';
}

/**
 * Already asked for THIS log — PERMANENT, with no time window.
 *
 * Ruling 1 says "the same log must never receive the same question twice". That has no
 * time component, so this is deliberately NOT an age comparison and deliberately not a
 * longer cooldown: a cooldown, however long, eventually expires and re-asks a log about
 * a day the farmer has long since moved past.
 *
 * `skipped` is not consulted either. A skip is still "this log was asked";
 * SKIP_COOLDOWN_DAYS is a DAY-scoped mechanism and must not resurrect a question for a
 * log that already received it.
 *
 * Returns false when either side lacks a log id. Every question_events row written
 * before wave-3.1 has daily_log_id NULL, and treating those as "asked for no log" would
 * unblock every gap question at once the day the API deploys.
 */
function askedForLog(q: DfesQuestion, recent: RecentQuestionEvent[], sourceLogId?: string): boolean {
    if (!sourceLogId) return false;
    return recent.some(e => e.questionKey === q.questionKey && e.dailyLogId === sourceLogId);
}

function eligible(
    q: DfesQuestion | undefined,
    recent: RecentQuestionEvent[],
    sourceLogId?: string,
): q is DfesQuestion {
    if (!approved(q)) return false;
    if (isPerLogScoped(q)) {
        // Per-log questions: permanent exclusion for THIS log, and the day cooldown
        // still applies to rows that predate per-log tracking (dailyLogId === null).
        // Without that second half, deploying wave-3.1 would make every legacy row
        // invisible and every gap question immediately re-askable.
        if (askedForLog(q, recent, sourceLogId)) return false;
        const legacyOnly = recent.filter(e => e.dailyLogId === null);
        return !onCooldown(q, legacyOnly);
    }
    return !onCooldown(q, recent);
}

/**
 * The token vocabulary, as a table rather than a chain of `.replace` calls, so
 * the resolver and the guard that polices the BANK read from the same list and
 * cannot drift apart. Order is irrelevant; membership is the contract.
 */
const TOKEN_VALUES: ReadonlyArray<readonly [string, (inputs: DailyQuestionInputs) => string | undefined]> = [
    ['crop', i => i.crop],
    ['observation', i => i.openObservation?.summary],
    ['category', i => i.scheduleContext?.categoryLabelMr],
    ['weather', i => i.weather?.conditionText],
    ['lastActivity', i => i.previousLog?.activityMr],
    ['daysAgo', i => (i.previousLog === undefined ? undefined : String(i.previousLog.daysAgo))],
];

/**
 * Every token `resolvePrompt` actually substitutes. Exported so the bank guard
 * in the tests can assert that a shipped `promptMr` carries nothing else — a
 * near-miss spelling is caught at review time instead of shipping.
 */
export const RESOLVER_TOKENS: readonly string[] = TOKEN_VALUES.map(([token]) => token);

/** The exact shape this resolver recognises. Anything else brace-shaped is NOT a token. */
const TOKEN_PATTERN = /\{([a-zA-Z]+)\}/g;

/**
 * Whitespace/punctuation tidy-up run AFTER substitution, so a stripped token
 * cannot leave a double space or a space stranded before punctuation.
 *
 * Exported ONLY so a test can pin the one thing that matters about it: it is
 * the IDENTITY function on every agronomist-approved string in
 * `dfesQuestionBank.ts`. Approved Marathi may not change without founder
 * approval, and this chain runs over all of it on every render — an approved
 * string that happened to arrive with a space before `?` would have its
 * reviewed typography silently rewritten. `dfesQuestionEngine.context.test.ts`
 * fails loudly if that ever becomes true, from either direction (new copy, or
 * a changed chain).
 */
export function tidyResolvedPrompt(text: string): string {
    return text
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.?!])/g, '$1')
        .trim();
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
 * One tokenising pass rather than a chain of `.replace` calls, so EVERY
 * `{token}` occurrence is matched (a template using a token twice cannot leak
 * the second one) and a token this resolver does not know about — a copy typo
 * like `{crops}` — is stripped exactly the same way instead of reaching the
 * farmer. `values` is a Map, not an object literal: `values['toString']` on an
 * object would return a FUNCTION rather than undefined and inject
 * `function toString() { [native code] }` into a farmer-facing prompt.
 *
 * SCOPE OF THAT GUARANTEE — it covers this pattern only. `{crop }`,
 * `{last_activity}` and `{crop-name}` are not tokens at all: they are neither
 * substituted NOR stripped, and would reach a farmer verbatim. That is
 * deliberate — silently deleting a near-miss would hide the typo instead of
 * surfacing it — and it is why the shipped bank is policed by its OWN test
 * (see `RESOLVER_TOKENS`), which rejects any braced run that is not exactly a
 * known token. The two together are what make "no raw brace reaches a farmer"
 * true end-to-end; neither half is sufficient alone.
 *
 * The replacement is a FUNCTION, never a string: a `.replace` string
 * replacement would interpret `$&` / `$1` inside a substituted VALUE.
 *
 * Exported so the resolution itself is testable directly, without having to
 * add tokens to agronomist-approved bank copy to exercise it.
 *
 * KNOWN LIMIT — `{weather}`: WeatherTriggerContext.conditionText is the weather
 * provider's own text and is ENGLISH ('Clear', 'Light rain', 'Partly Cloudy');
 * there is no reviewed English->Marathi condition vocabulary in the repo, and
 * inventing one here would be unreviewed Marathi shipped in code. No bank entry
 * carries {weather} today, so nothing English can reach a farmer — and the bank
 * guard now ENFORCES that rather than trusting this comment: `{weather}` is
 * excluded from the bank-allowed token set until that vocabulary exists (or the
 * numbers the question already triggers on are spoken instead). Raised as a
 * blocker in the Task 7 context-rich-prompt drafts sent for agronomist review.
 */
export function resolvePrompt(promptMr: string, inputs: DailyQuestionInputs): string {
    const values = new Map<string, string | undefined>(
        TOKEN_VALUES.map(([token, read]) => [token, read(inputs)]),
    );
    return tidyResolvedPrompt(
        promptMr.replace(TOKEN_PATTERN, (_match, token: string) => values.get(token) ?? ''),
    );
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
    // wave-3.2, Ruling 1 — threaded into every eligibility check, not just the Gap tier,
    // so a future question added to any tier cannot bypass per-log scoping by omission.
    const sourceLogId = inputs.sourceLogId;
    const w = inputs.weather;

    // P1 Safety — high wind makes spraying unsafe.
    if (w && (w.windKph ?? 0) >= TRIGGER_CONFIG.windKphThreshold) {
        const q = findQuestion('safety.spray_wind_high');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `wind ${w.windKph}kph >= ${TRIGGER_CONFIG.windKphThreshold}`);
    }

    // P2 Weather — rain likely before a planned spray.
    if (w && (w.rainProbNext6h ?? 0) >= TRIGGER_CONFIG.rainProbThresholdPct) {
        const q = findQuestion('weather.rain_before_spray');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `rainProbNext6h ${w.rainProbNext6h}% >= ${TRIGGER_CONFIG.rainProbThresholdPct}`);
    }

    // P3 StageWindow — planned-vs-actual confirmation window open.
    if (isStageConfirmationWindowOpen(inputs.stageContext, inputs.lastStageConfirm ?? null)) {
        const q = findQuestion('stage.confirm_current');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `stage window open (expected=${inputs.stageContext?.expectedStage})`);
    }

    // P4 Schedule — category-scoped "was today's planned {category} work done?"
    // (Task 3A). Category-level only — never a fabricated precise task claim.
    if (inputs.scheduleContext) {
        const q = findQuestion('schedule.category_planned_not_done');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `schedule gap: ${inputs.scheduleContext.category} planned, 0 done today`);
    }

    // P5 WeatherReconcile — severe weather recorded, no logged impact (Task
    // 4B). A warm care-check, never a doubt of the farmer's account — more
    // relevant than a generic gap, so it sits ahead of Gap.
    if (inputs.weatherReconcileContext) {
        const q = findQuestion('weather.severe_care_check');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `weather reconcile: ${inputs.weatherReconcileContext.reason}`);
    }

    // P6 Gap — biggest comprehension gap from the (stage-aware) ranker.
    if (inputs.score) {
        for (const gap of rankMeterGaps(inputs.score, inputs.stageContext, 8)) {
            const q = findGapQuestion(gap.dimension);
            if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `gap ${gap.dimension} leverage ${gap.leverage}`);
        }
    }

    // P7 Followup — an open observation awaiting an outcome.
    if (inputs.openObservation) {
        const q = findQuestion('followup.observation_outcome');
        if (eligible(q, recent, sourceLogId)) return pack(q, inputs, 'open observation outcome');
    }

    // P8 Learning — deepen once the farmer has EARNED it (>= richDayThreshold rich days).
    if (inputs.engagement.totalRichDays >= DFES_TUNING.richDayThreshold) {
        for (const key of ['learning.deepen_hypothesis', 'learning.next_experiment']) {
            const q = findQuestion(key);
            if (eligible(q, recent, sourceLogId)) return pack(q, inputs, `learning tier (richDays ${inputs.engagement.totalRichDays})`);
        }
    }

    return null;
}
