/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionBank — versioned, code-reviewed D8 question bank (Phase 5).
 *
 * HARD GATE: every entry MUST be agronomistApproved && marathiApproved UNLESS
 * explicitly marked with a `// CONTENT GATE:` comment — a deliberately-inert
 * entry pending agronomist + Marathi review (today: only
 * 'schedule.category_planned_not_done', Task 3A). The engine's `approved()`
 * gate in dfesQuestionEngine.ts means a content-gated entry can physically
 * exist in this array yet can NEVER be selected in production until its
 * flags flip — asserted by dfesQuestionBank.test.ts. Copy is FINAL Marathi
 * everywhere else (promotes the placeholder strings that meterGaps.ts
 * flagged as "polish-pass" debt).
 *
 * Column parity: each field maps 1:1 onto an ssf.question_events column so the
 * telemetry row is a straight projection of the selected entry.
 *
 * spec: dfes-companion-2026-07-11
 */

export const BANK_VERSION = 'dfes-bank-1' as const;
export const QUESTION_ENGINE_VERSION = 'dfes-qengine-1' as const;

/** Only ONE combined question per farmer per local day. Structural, not a tunable. */
export const MAX_QUESTIONS_PER_DAY = 1 as const;

/** Reviewed trigger thresholds (versioned WITH the bank; not DfesTuning scoring numbers). */
export const TRIGGER_CONFIG = {
    rainProbThresholdPct: 60,
    windKphThreshold: 25,
    /** Days a gap question stays on cooldown after being shown. */
    gapCooldownDays: 3,
} as const;

export type QuestionLens = 'Execution' | 'Insight' | 'Learning';
export type QuestionTriggerType = 'Safety' | 'Weather' | 'StageWindow' | 'Schedule' | 'Gap' | 'Followup' | 'Learning';
export type QuestionAnchorDateType = 'log_date' | 'stage_start' | 'weather_event' | 'none';

export interface DfesQuestion {
    questionKey: string;                 // -> QuestionKey
    crop: string;                        // -> Crop ('*' = any crop)
    triggerType: QuestionTriggerType;    // -> TriggerType
    questionType: string;                // -> QuestionType ('gap_fill'|'stage_confirm'|'weather_check'|'observation'|'experiment')
    lens: QuestionLens;                  // -> Lens
    depthLevel: number;                  // -> DepthLevel (1 notice .. 4 experiment)
    priority: number;                    // -> Priority (1 highest .. 7 lowest)
    cooldownDays: number;                // -> Cooldown
    answerModes: string;                 // -> AnswerModes ('voice'|'voice,photo'|'choice,voice')
    safetyClass: string;                 // -> SafetyClass ('informational'|'advisory'|'safety_critical')
    anchorDateType: QuestionAnchorDateType; // -> AnchorDateType
    agronomistApproved: boolean;         // -> AgronomistApproved (MUST be true)
    marathiApproved: boolean;            // -> MarathiApproved (MUST be true)
    /** Marathi first-person prompt. May contain {crop} / {observation} tokens. */
    promptMr: string;
    /** Applicability tag echoed into ActualStageApplicability for stage questions. */
    expectedStageApplicability?: string;
    /**
     * Tap-choice answer options (Task 2A, tap-to-answer v1). Populated ONLY once
     * real, agronomist-approved + Marathi-approved option copy exists for this
     * question — otherwise left undefined and the question stays ack/skip-only
     * (honest; no fabricated agronomy). When present, each option's `value`
     * becomes QuestionOutcome.response and an optional `stageConfirmedValue`
     * becomes QuestionOutcome.stageConfirmed on tap.
     */
    answerOptions?: DfesAnswerOption[];
}

/** One tappable answer choice for an answerable question (Task 2A). */
export interface DfesAnswerOption {
    /** Recorded verbatim as QuestionOutcome.response (-> ssf.question_events.Response). */
    value: string;
    /** Marathi label rendered on the tap-choice button (Noto Sans Devanagari). */
    labelMr: string;
    /** For stage_confirm questions: this option's meaning for QuestionOutcome.stageConfirmed. */
    stageConfirmedValue?: boolean;
}

// Priority tiers (1 highest). Selection walks these in order. Renumbered for
// Task 3A to make room for P_SCHEDULE between StageWindow and Gap — Priority
// is persisted to ssf.question_events.Priority, an `int` column
// (ShramSafal.Domain/Dfes/QuestionEvent.cs), so a fractional in-between value
// is not schema-safe; whole-tier renumbering is the honest fix.
const P_SAFETY = 1, P_WEATHER = 2, P_STAGE = 3, P_SCHEDULE = 4, P_GAP = 5, P_FOLLOWUP = 6, P_LEARNING = 7;

const APPROVED = { agronomistApproved: true, marathiApproved: true } as const;

/** Gap lens re-bucket (LOCKED): Execution{WHAT,DOSE,SCOPE,CARRIER,COST} Insight{WEATHER,PURPOSE} Learning{CONTINUITY}. */
const GAP_LENS: Readonly<Record<string, QuestionLens>> = {
    WHAT: 'Execution', DOSE: 'Execution', SCOPE: 'Execution', CARRIER: 'Execution', COST: 'Execution',
    WEATHER: 'Insight', PURPOSE: 'Insight',
    CONTINUITY: 'Learning',
} as const;

/** Approved FINAL Marathi copy for each gap dimension (replaces meterGaps placeholders). */
const GAP_PROMPT: Readonly<Record<string, string>> = {
    WHAT: 'आज नेमकं कोणतं काम केलं ते सांगाल का?',
    DOSE: 'किती मात्रा (डोस) वापरली?',
    SCOPE: 'हे काम कोणत्या प्लॉटवर केलं?',
    CARRIER: 'फवारणीसाठी किती पाणी वापरलं?',
    COST: 'यासाठी किती खर्च झाला?',
    PURPOSE: 'हे काम आज का करावं लागलं?',
    WEATHER: 'आज हवामान कसं होतं?',
    CONTINUITY: 'हे काम किती टक्के पूर्ण झालं?',
} as const;

function gapEntry(dim: string): DfesQuestion {
    return {
        questionKey: `gap.${dim.toLowerCase()}`,
        crop: '*',
        triggerType: 'Gap',
        questionType: 'gap_fill',
        lens: GAP_LENS[dim] ?? 'Execution',
        depthLevel: 1,
        priority: P_GAP,
        cooldownDays: TRIGGER_CONFIG.gapCooldownDays,
        answerModes: 'voice',
        safetyClass: 'informational',
        anchorDateType: 'log_date',
        promptMr: GAP_PROMPT[dim] ?? `${dim} बद्दल सांगा?`,
        ...APPROVED,
    };
}

const GAP_ENTRIES: DfesQuestion[] = Object.keys(GAP_PROMPT).map(gapEntry);

const TRIGGER_ENTRIES: DfesQuestion[] = [
    {
        questionKey: 'safety.spray_wind_high', crop: '*', triggerType: 'Safety', questionType: 'weather_check',
        lens: 'Insight', depthLevel: 2, priority: P_SAFETY, cooldownDays: 1, answerModes: 'voice',
        safetyClass: 'safety_critical', anchorDateType: 'weather_event',
        promptMr: 'आज वारा जास्त आहे — फवारणी टाळणं सुरक्षित. तुम्ही काय ठरवलं?', ...APPROVED,
    },
    {
        questionKey: 'weather.rain_before_spray', crop: '*', triggerType: 'Weather', questionType: 'weather_check',
        lens: 'Insight', depthLevel: 2, priority: P_WEATHER, cooldownDays: 2, answerModes: 'voice',
        safetyClass: 'advisory', anchorDateType: 'weather_event',
        promptMr: 'पुढच्या काही तासांत पाऊस येऊ शकतो. फवारणी पुढे ढकलणार का?', ...APPROVED,
    },
    {
        questionKey: 'stage.confirm_current', crop: '*', triggerType: 'StageWindow', questionType: 'stage_confirm',
        lens: 'Execution', depthLevel: 1, priority: P_STAGE, cooldownDays: 7, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'stage_start', expectedStageApplicability: 'current_stage',
        promptMr: 'तुमची {crop} आता कोणत्या टप्प्यात आहे?', ...APPROVED,
        // CONTENT GATE: answerModes says 'choice,voice' but there is no real,
        // agronomist-approved + Marathi-labeled crop-stage option list in the
        // repo to wire here (checked: StageCode in scheduler.types.ts /
        // summary.types.ts is an internal scheduler enum with only English
        // names — 'Early Stage'/'Mid Stage'/'Late Stage' etc. — no Marathi
        // labels anywhere; stageInsight() in intelligence/insights.ts only
        // echoes whatever free-text the farmer already confirmed, it isn't a
        // fixed choice set). `answerOptions` is left undefined so this
        // question stays ack/skip-only (tap-to-answer v1) until an
        // agronomist supplies approved Marathi stage-option copy.
    },
    {
        questionKey: 'schedule.category_planned_not_done', crop: '*', triggerType: 'Schedule', questionType: 'gap_fill',
        lens: 'Execution', depthLevel: 1, priority: P_SCHEDULE, cooldownDays: 3, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'log_date', expectedStageApplicability: 'current_stage',
        // DRAFT Marathi — CONTENT GATE: this entry is mechanism-only (Task
        // 3A). The plan data behind it is real (every plot has a live
        // schedule) but only trustworthy at the CATEGORY level, so the
        // prompt only ever asks about a category, never a fabricated
        // precise task name. It needs agronomist + Marathi sign-off before
        // it can fire — inert until agronomistApproved/marathiApproved flip
        // true (dfesQuestionEngine.ts's approved() hard gate keeps it out of
        // production selection regardless of the stageQuestions flag).
        promptMr: 'आज ठरलेलं {category} काम झालं का?',
        agronomistApproved: false, marathiApproved: false,
    },
    {
        questionKey: 'followup.observation_outcome', crop: '*', triggerType: 'Followup', questionType: 'observation',
        lens: 'Learning', depthLevel: 3, priority: P_FOLLOWUP, cooldownDays: 3, answerModes: 'voice,photo',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'मागच्या वेळी तुम्ही "{observation}" पाहिलं होतं — आता काय दिसतंय?', ...APPROVED,
    },
    {
        questionKey: 'learning.deepen_hypothesis', crop: '*', triggerType: 'Learning', questionType: 'observation',
        lens: 'Learning', depthLevel: 3, priority: P_LEARNING, cooldownDays: 5, answerModes: 'voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'तुम्हाला काय वाटतं, असं का झालं असावं?', ...APPROVED,
    },
    {
        questionKey: 'learning.next_experiment', crop: '*', triggerType: 'Learning', questionType: 'experiment',
        lens: 'Learning', depthLevel: 4, priority: P_LEARNING, cooldownDays: 7, answerModes: 'voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'पुढच्या वेळी वेगळं काही करून बघणार का? काय करून बघाल?', ...APPROVED,
    },
];

export const DFES_QUESTION_BANK: readonly DfesQuestion[] = [...TRIGGER_ENTRIES, ...GAP_ENTRIES];

export function findGapQuestion(dimension: string): DfesQuestion | undefined {
    return DFES_QUESTION_BANK.find(q => q.questionKey === `gap.${dimension.toLowerCase()}`);
}

export function findQuestion(questionKey: string): DfesQuestion | undefined {
    return DFES_QUESTION_BANK.find(q => q.questionKey === questionKey);
}
