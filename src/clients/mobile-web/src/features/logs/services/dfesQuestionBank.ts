/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionBank — versioned, code-reviewed D8 question bank (Phase 5).
 *
 * HARD GATE: every entry MUST be agronomistApproved && marathiApproved UNLESS
 * explicitly marked with a `// CONTENT GATE:` comment — a deliberately-inert
 * entry pending agronomist + Marathi review (today:
 * 'schedule.category_planned_not_done' Task 3A, 'weather.severe_care_check'
 * Task 4B, and — founder ruling 2026-08-13 — the two spray-advice entries
 * 'safety.spray_wind_high' and 'weather.rain_before_spray', which had only
 * ever inherited approval from the `APPROVED` developer constant and were
 * never seen by an agronomist). The `approved()` gate in dfesQuestionEngine.ts means a
 * content-gated entry can physically exist in this array yet can NEVER be
 * selected in production until its flags flip — asserted by
 * dfesQuestionBank.test.ts. Copy is FINAL Marathi everywhere else (promotes
 * the placeholder strings that meterGaps.ts flagged as "polish-pass" debt).
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
export type QuestionTriggerType = 'Safety' | 'Weather' | 'StageWindow' | 'Schedule' | 'WeatherReconcile' | 'Gap' | 'Followup' | 'Learning';
export type QuestionAnchorDateType = 'log_date' | 'stage_start' | 'weather_event' | 'none';

export interface DfesQuestion {
    questionKey: string;                 // -> QuestionKey
    crop: string;                        // -> Crop ('*' = any crop)
    triggerType: QuestionTriggerType;    // -> TriggerType
    questionType: string;                // -> QuestionType ('gap_fill'|'stage_confirm'|'weather_check'|'observation'|'experiment')
    lens: QuestionLens;                  // -> Lens
    depthLevel: number;                  // -> DepthLevel (1 notice .. 4 experiment)
    priority: number;                    // -> Priority (1 highest .. 8 lowest)
    cooldownDays: number;                // -> Cooldown
    answerModes: string;                 // -> AnswerModes ('voice'|'voice,photo'|'choice,voice')
    safetyClass: string;                 // -> SafetyClass ('informational'|'advisory'|'safety_critical')
    anchorDateType: QuestionAnchorDateType; // -> AnchorDateType
    agronomistApproved: boolean;         // -> AgronomistApproved (MUST be true)
    marathiApproved: boolean;            // -> MarathiApproved (MUST be true)
    /**
     * Marathi first-person prompt. May contain {crop} / {observation} tokens.
     *
     * This is the NEUTRAL variant — it names no activity, so it is always safe to show.
     * wave-3.6 makes it the wording an UNSURE recognition falls back to.
     */
    promptMr: string;
    /**
     * wave-3.6, Ruling 4 — the variant that ACKNOWLEDGES the work before asking, used
     * only when `isWorkRecognitionConfident` is true. Carries `{todayActivity}`.
     *
     * A SEPARATE string, not `promptMr` with an optional token: an absent token
     * substitutes '' and `tidyResolvedPrompt` collapses the gap, so a single-string
     * design would hand an unsure farmer the confident sentence minus its subject.
     * Ruling 4 says do not repeat a guessed activity, which needs a different sentence.
     *
     * Optional. A question with no confident variant (gap.what — acknowledging the work
     * and then asking what the work was is incoherent) simply always uses `promptMr`.
     * Policed by the same bank token guard as `promptMr`.
     */
    promptConfidentMr?: string;
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
// Task 3A to make room for P_SCHEDULE between StageWindow and Gap, and again
// for Task 4B to make room for P_WEATHER_RECONCILE between Schedule and Gap —
// Priority is persisted to ssf.question_events.Priority, an `int` column
// (ShramSafal.Domain/Dfes/QuestionEvent.cs), so a fractional in-between value
// is not schema-safe; whole-tier renumbering is the honest fix (same safe
// renumber the Task 3A review validated).
const P_SAFETY = 1, P_WEATHER = 2, P_STAGE = 3, P_SCHEDULE = 4, P_WEATHER_RECONCILE = 5, P_GAP = 6, P_FOLLOWUP = 7, P_LEARNING = 8;

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
    COST: 'खर्च उलगडून सांगू शकाल का?',
    PURPOSE: 'हे काम आज कशासाठी केलं?',
    WEATHER: 'आज हवामान कसं होतं?',
    CONTINUITY: 'हे काम पूर्ण झालं का, की अजून बाकी आहे?',
} as const;

/**
 * wave-3.6, Ruling 4 — the CONFIDENT variant of each gap question: Sathi acknowledges
 * the work he recognised, then asks. Used only when `isWorkRecognitionConfident` is
 * true; otherwise `GAP_PROMPT` above (the founder-locked neutral copy) is shown.
 *
 * CONSTRUCTION RULE, so this stays reviewable: each entry is the founder-locked
 * `GAP_PROMPT` string above, VERBATIM, with one acknowledgement clause prefixed. The
 * question half is byte-identical to the copy in G:\VALIDATION\shram-sathi-FINAL-strings.md
 * (rows L101/L103/L104), so no 🔒 string is rewritten and an unsure farmer sees exactly
 * today's shipped wording.
 *
 * The acknowledgement is deliberately VERB-FREE. `{todayActivity}` is a
 * CATEGORY_LABEL_MR value — 'फवारणी' (f.), 'खत' (n.), 'सिंचन' (n.), 'कामे' (n.pl.) — and
 * a Marathi verb would have to agree with each. "फवारणी केली" is correct but "खत केली"
 * and "कामे केली" are not, so any inflected form ships broken Marathi for three of the
 * four categories. "{todayActivity} — समजलं." agrees with all of them. 'समजलं' is
 * founder-locked vocabulary (FINAL-strings rows 43, 47-50, 24).
 *
 * NO CONFIDENT VARIANT FOR:
 *   WHAT — acknowledging the work and then asking what the work was is incoherent.
 *   The unrewardable dimensions — wave-3.9 retires them entirely.
 */
const GAP_PROMPT_CONFIDENT: Readonly<Record<string, string>> = {
    DOSE: '{todayActivity} — समजलं. किती मात्रा (डोस) वापरली?',
    CARRIER: '{todayActivity} — समजलं. फवारणीसाठी किती पाणी वापरलं?',
    COST: '{todayActivity} — समजलं. खर्च उलगडून सांगू शकाल का?',
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
        // Undefined for any dimension with no confident variant — that question then
        // always uses the neutral copy, which is the safe direction.
        promptConfidentMr: GAP_PROMPT_CONFIDENT[dim],
        ...APPROVED,
    };
}

const GAP_ENTRIES: DfesQuestion[] = Object.keys(GAP_PROMPT).map(gapEntry);

const TRIGGER_ENTRIES: DfesQuestion[] = [
    {
        questionKey: 'safety.spray_wind_high', crop: '*', triggerType: 'Safety', questionType: 'weather_check',
        lens: 'Insight', depthLevel: 2, priority: P_SAFETY, cooldownDays: 1, answerModes: 'voice',
        safetyClass: 'safety_critical', anchorDateType: 'weather_event',
        // CONTENT GATE (founder ruling 2026-08-13, `flip-now`): this question
        // tells a farmer whether it is safe to spray — safetyClass is
        // 'safety_critical'. It has never been reviewed by an agronomist; it
        // only ever carried `...APPROVED`, a developer constant, which is not
        // agronomist sign-off. Written as explicit flags rather than a spread
        // so nothing can silently re-approve it by spread ordering. Inert
        // until a real agronomist signs it off (dfesQuestionEngine.ts's
        // approved() gate keeps it out of selection meanwhile). The Marathi
        // copy IS founder-reviewed, so marathiApproved stays true.
        promptMr: 'आज वारा जास्त आहे. अशा वेळी फवारणी लांबवलेली बरी. तुम्ही काय ठरवताय?',
        agronomistApproved: false, marathiApproved: true,
    },
    {
        questionKey: 'weather.rain_before_spray', crop: '*', triggerType: 'Weather', questionType: 'weather_check',
        lens: 'Insight', depthLevel: 2, priority: P_WEATHER, cooldownDays: 2, answerModes: 'voice',
        safetyClass: 'advisory', anchorDateType: 'weather_event',
        // CONTENT GATE (founder ruling 2026-08-13, `flip-now`): same reason as
        // safety.spray_wind_high above — this advises a farmer on whether to
        // spray, and no agronomist has reviewed it. Explicit flags, no spread.
        promptMr: 'थोड्या वेळात पाऊस येऊ शकतो. फवारणी उद्यावर टाकायची का?',
        agronomistApproved: false, marathiApproved: true,
    },
    {
        questionKey: 'stage.confirm_current', crop: '*', triggerType: 'StageWindow', questionType: 'stage_confirm',
        lens: 'Execution', depthLevel: 1, priority: P_STAGE, cooldownDays: 7, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'stage_start', expectedStageApplicability: 'current_stage',
        promptMr: '{crop} आता कोणत्या टप्प्यात आहे?', ...APPROVED,
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
        questionKey: 'weather.severe_care_check', crop: '*', triggerType: 'WeatherReconcile', questionType: 'observation',
        lens: 'Execution', depthLevel: 1, priority: P_WEATHER_RECONCILE, cooldownDays: 1, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'log_date', expectedStageApplicability: 'any',
        // CONTENT GATE: this entry is mechanism-only (Task 4B). Its Marathi
        // was refreshed from the founder's FINAL reviewed string set on
        // 2026-08-13; the approval FLAGS are deliberately left untouched —
        // flipping marathiApproved is a separate founder call, and this entry
        // still has no agronomist sign-off either way.
        // It fires only when the recorded weatherStamp was genuinely
        // SEVERE (dfesWeatherReconcile.ts's conservative thresholds) AND the
        // farmer logged no weather disturbance — a warm care-check, never a
        // doubt of the farmer's account. It needs agronomist + Marathi
        // sign-off before it can fire — inert until agronomistApproved/
        // marathiApproved flip true (dfesQuestionEngine.ts's approved() hard
        // gate keeps it out of production selection regardless of the
        // stageQuestions flag).
        promptMr: 'आज हवा बरीच खराब होती — सगळं ठीक होतं ना?',
        agronomistApproved: false, marathiApproved: false,
    },
    {
        questionKey: 'followup.observation_outcome', crop: '*', triggerType: 'Followup', questionType: 'observation',
        lens: 'Learning', depthLevel: 3, priority: P_FOLLOWUP, cooldownDays: 3, answerModes: 'voice,photo',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'मागच्या वेळी तुम्ही "{observation}" असं सांगितलं होतं — आता काय दिसतंय?', ...APPROVED,
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
        promptMr: 'पुढच्या वेळी काही वेगळं करून बघणार का?', ...APPROVED,
    },
];

export const DFES_QUESTION_BANK: readonly DfesQuestion[] = [...TRIGGER_ENTRIES, ...GAP_ENTRIES];

export function findGapQuestion(dimension: string): DfesQuestion | undefined {
    return DFES_QUESTION_BANK.find(q => q.questionKey === `gap.${dimension.toLowerCase()}`);
}

export function findQuestion(questionKey: string): DfesQuestion | undefined {
    return DFES_QUESTION_BANK.find(q => q.questionKey === questionKey);
}
