import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectDailyQuestion, SKIP_COOLDOWN_DAYS, type DailyQuestionInputs } from '../dfesQuestionEngine';
import type { VlogScore } from '../../../../domain/types/log.types';
import type { DfesQuestion } from '../dfesQuestionBank';

const scoreWithGap = (dim: string): VlogScore => ({
    score: 40, outcome: 'SCORED',
    dimensions: [{ dimension: dim, applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }],
});

const base = (o: Partial<DailyQuestionInputs> = {}): DailyQuestionInputs => ({
    crop: 'grapes',
    todayLocalDate: '2026-07-11',
    score: scoreWithGap('DOSE'),
    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
    recentEvents: [],
    ...o,
});

describe('selectDailyQuestion (Phase 5)', () => {
    it('returns null when a question was already recorded today (ONE per day)', () => {
        const r = selectDailyQuestion(base({
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-11', ageDays: 0, skipped: false, dailyLogId: null }],
        }));
        expect(r).toBeNull();
    });

    // Founder ruling 2026-08-13 (`flip-now`): the P1/P2 spray-advice entries
    // are agronomist-gated in the REAL bank, so the day's question now falls
    // through them to the next eligible tier. The priority ORDER itself is
    // still proven, against substituted APPROVED fixtures, in the
    // "Safety / Weather tiers" suite below.
    it('AGRONOMIST GATE: the real safety + weather entries never fire — a severe-weather day falls through to the next eligible tier', () => {
        const inputs = base({
            weather: { rainProbNext6h: 80, windKph: 30, hasActiveAlert: true },
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null,
        });
        expect(selectDailyQuestion(inputs)!.question.questionKey).toBe('stage.confirm_current');
    });

    it('AGRONOMIST GATE: high windKph alone selects no spray question — it falls through to the top Gap', () => {
        const inputs = base({
            weather: { windKph: 30 },
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(selectDailyQuestion(inputs)!.question.questionKey).toBe('gap.dose');
    });

    it('AGRONOMIST GATE: high rainProbNext6h alone selects no spray question — it falls through to the top Gap', () => {
        const inputs = base({
            weather: { rainProbNext6h: 70 },
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(selectDailyQuestion(inputs)!.question.questionKey).toBe('gap.dose');
    });

    it('falls to the top Gap question when no trigger fires', () => {
        const r = selectDailyQuestion(base({ score: scoreWithGap('DOSE') }));
        expect(r!.question.questionKey).toBe('gap.dose');
        expect(r!.question.lens).toBe('Execution');
    });

    it('respects anti-repeat cooldown — a gap on cooldown is skipped for the next gap', () => {
        const score: VlogScore = {
            score: 40, outcome: 'SCORED',
            dimensions: [
                { dimension: 'DOSE', applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 },
                { dimension: 'COST', applicable: true, weight: 12, coverage: 0, confidenceFactor: 1, contribution: 0 },
            ],
        };
        const r = selectDailyQuestion(base({
            score,
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-09', ageDays: 2, skipped: false, dailyLogId: null }], // < 3d cooldown
        }));
        expect(r!.question.questionKey).toBe('gap.cost');
    });

    it('gates P6 Learning-deepening behind DFES_TUNING.richDayThreshold (25)', () => {
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const locked = selectDailyQuestion(base({ score: noGap, engagement: { totalRichDays: 10, unlockStatus: 'locked' } }));
        expect(locked).toBeNull(); // not yet earned the learning tier, no other trigger
        const unlocked = selectDailyQuestion(base({ score: noGap, engagement: { totalRichDays: 25, unlockStatus: 'unlocked' } }));
        expect(unlocked!.question.triggerType).toBe('Learning');
    });

    it('interpolates {crop} into the stage-confirm prompt', () => {
        const r = selectDailyQuestion(base({
            score: { score: 90, outcome: 'SCORED', dimensions: [] },
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null,
        }));
        expect(r!.resolvedPromptMr).toContain('grapes');
        expect(r!.question.questionKey).toBe('stage.confirm_current');
    });
});

// Founder ruling 2026-08-13 (`flip-now`) — the P1 Safety and P2 Weather
// spray-advice entries are agronomist-gated in the REAL bank, so their
// SELECTION order can only be exercised against substituted APPROVED fixture
// copies (same vi.doMock + vi.resetModules() + dynamic-import isolation the
// Schedule and WeatherReconcile tier suites already use). The "stays inert"
// half is proven against the real bank in the suite above.
describe('selectDailyQuestion — Safety / Weather tiers (agronomist-gated in the real bank)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    /** Approves the real bank's own safety/weather entries — the ONLY difference
     *  from production is agronomistApproved, so ordering results can only be
     *  attributed to priority, not to some other substituted property. */
    async function selectWithApprovedSprayQuestions(extra: Partial<DailyQuestionInputs> = {}) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            const approve = (key: string): DfesQuestion => ({ ...actual.findQuestion(key)!, agronomistApproved: true, marathiApproved: true });
            const approved: Record<string, DfesQuestion> = {
                'safety.spray_wind_high': approve('safety.spray_wind_high'),
                'weather.rain_before_spray': approve('weather.rain_before_spray'),
            };
            return {
                ...actual,
                findQuestion: (key: string) => approved[key] ?? actual.findQuestion(key),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(base(extra));
    }

    it('Safety beats Weather beats StageWindow beats Gap (priority order)', async () => {
        const result = await selectWithApprovedSprayQuestions({
            weather: { rainProbNext6h: 80, windKph: 30, hasActiveAlert: true },
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null,
        });
        expect(result!.question.questionKey).toBe('safety.spray_wind_high');
    });

    it('Task 4A: high windKph selects the safety question at P1, ahead of a same-day Schedule gap', async () => {
        const result = await selectWithApprovedSprayQuestions({
            weather: { windKph: 30 },
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(result!.question.questionKey).toBe('safety.spray_wind_high');
    });

    it('Task 4A: high rainProbNext6h (no wind trigger) selects the weather question at P2, ahead of a same-day Schedule gap', async () => {
        const result = await selectWithApprovedSprayQuestions({
            weather: { rainProbNext6h: 70 },
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(result!.question.questionKey).toBe('weather.rain_before_spray');
    });
});

// spec: dfes-companion-2026-07-11 (Phase 5, Task 5.10) — CRITICAL acceptance
// gate. The real bank (dfesQuestionBank.ts) can only ever hold approved
// entries — every literal entry is spread with `...APPROVED`, and
// dfesQuestionBank.test.ts asserts that invariant — so exercising this gate
// against the real bank alone would never prove the SELECTOR itself enforces
// it (it could pass by construction alone). To isolate the engine's own
// `approved()` check, this substitutes one controlled, otherwise-identical
// DfesQuestion via the bank module's lookup functions (findGapQuestion),
// following the vi.doMock + vi.resetModules() + dynamic-import pattern
// already used by dfesTuning.test.ts / AppRouter.feature-gate.test.tsx /
// MeterDisplay.test.tsx to control a mocked module deterministically per test.
describe('selectDailyQuestion — hard AgronomistApproved && MarathiApproved gate (CRITICAL)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    /** Same shape as the real gap.dose bank entry, minus the approval flags —
     *  the ONLY variable across the three tests below is agronomistApproved /
     *  marathiApproved, so a pass/fail difference can only be attributed to
     *  the gate, not to some other property of the substituted question. */
    const questionShape = {
        questionKey: 'gap.dose', crop: '*', triggerType: 'Gap', questionType: 'gap_fill',
        lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'किती मात्रा (डोस) वापरली?',
    } as const;

    /** Mounts a `dfesQuestionBank` mock whose `findGapQuestion('DOSE')` returns
     *  `question` (all other exports pass through untouched), then runs
     *  `selectDailyQuestion` with a context that would otherwise select the
     *  DOSE gap (single-gap score, no higher-priority trigger, no cooldown). */
    async function selectWithSubstitutedDoseQuestion(question: DfesQuestion) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findGapQuestion: (dimension: string) =>
                    dimension === 'DOSE' ? question : actual.findGapQuestion(dimension),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(base({ score: scoreWithGap('DOSE') }));
    }

    it('never surfaces a question with agronomistApproved: false, even when it would otherwise be selected', async () => {
        const unapproved: DfesQuestion = { ...questionShape, agronomistApproved: false, marathiApproved: true };
        const result = await selectWithSubstitutedDoseQuestion(unapproved);
        expect(result).toBeNull();
    });

    it('never surfaces a question with marathiApproved: false, even when it would otherwise be selected', async () => {
        const unapproved: DfesQuestion = { ...questionShape, agronomistApproved: true, marathiApproved: false };
        const result = await selectWithSubstitutedDoseQuestion(unapproved);
        expect(result).toBeNull();
    });

    it('companion positive case: the SAME question shape with both flags true IS eligible', async () => {
        const approvedQuestion: DfesQuestion = { ...questionShape, agronomistApproved: true, marathiApproved: true };
        const result = await selectWithSubstitutedDoseQuestion(approvedQuestion);
        expect(result).not.toBeNull();
        expect(result!.question.questionKey).toBe('gap.dose');
    });
});

// spec: dfes-companion-2026-07-11 (Task 2A) — tap-to-answer bank mechanism.
// A question with `answerOptions` must resolve them verbatim onto
// SelectedQuestion.answerOptions; a question without them (the real bank
// today — no question yet has real, agronomist-approved option copy) must
// resolve `answerOptions` as undefined. Uses the same substituted-question
// pattern as the approval-gate suite above so this exercises the engine's
// own `pack()` threading rather than relying on the real bank ever growing
// an answerOptions entry.
describe('selectDailyQuestion — answerOptions threading onto SelectedQuestion (Task 2A)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    const questionShape = {
        questionKey: 'gap.dose', crop: '*', triggerType: 'Gap', questionType: 'gap_fill',
        lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'किती मात्रा (डोस) वापरली?', agronomistApproved: true, marathiApproved: true,
    } as const;

    async function selectWithSubstitutedDoseQuestion(question: DfesQuestion) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findGapQuestion: (dimension: string) =>
                    dimension === 'DOSE' ? question : actual.findGapQuestion(dimension),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(base({ score: scoreWithGap('DOSE') }));
    }

    it('resolves a question WITH answerOptions onto SelectedQuestion.answerOptions', async () => {
        const withOptions: DfesQuestion = {
            ...questionShape,
            answerOptions: [
                { value: 'low', labelMr: 'कमी' },
                { value: 'high', labelMr: 'जास्त' },
            ],
        };
        const result = await selectWithSubstitutedDoseQuestion(withOptions);
        expect(result!.answerOptions).toEqual([
            { value: 'low', labelMr: 'कमी' },
            { value: 'high', labelMr: 'जास्त' },
        ]);
    });

    it('resolves undefined answerOptions for a question that declares none (real-bank shape today)', async () => {
        const withoutOptions: DfesQuestion = { ...questionShape };
        const result = await selectWithSubstitutedDoseQuestion(withoutOptions);
        expect(result!.answerOptions).toBeUndefined();
    });
});

// spec: dfes-companion-2026-07-11 (Task 2B) — skip-aware cooldown. A SKIPPED
// question must return sooner than an ANSWERED/acked one (SKIP_COOLDOWN_DAYS,
// clamped to never exceed the question's own cooldownDays), while the
// one-question-per-day gate stays exactly as-is regardless of skipped/answered.
describe('selectDailyQuestion — skip-aware cooldown (Task 2B)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    it('a question skipped 1 day ago is still on the (shorter) skip-cooldown — excluded, distinct from the one-per-day gate', () => {
        // 'gap.dose' has cooldownDays 3 (== SKIP_COOLDOWN_DAYS); skipped 1 day
        // ago (not today) means the per-day gate does NOT apply here — only
        // the skip-cooldown does, and 1 < 3 keeps it suppressed. With only one
        // gap dimension in the score there is no other gap to fall back to.
        const r = selectDailyQuestion(base({
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-10', ageDays: 1, skipped: true, dailyLogId: null }],
        }));
        expect(r).toBeNull();
    });

    it('a question skipped SKIP_COOLDOWN_DAYS ago is ELIGIBLE again, whereas the same question ANSWERED the same number of days ago (longer cooldownDays) is STILL suppressed', () => {
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const stageInputs = (recentEvents: DailyQuestionInputs['recentEvents']) => base({
            score: noGap,
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null, // stage window always open, independent of recentEvents
            recentEvents,
        });

        // 'stage.confirm_current' cooldownDays is 7 — longer than SKIP_COOLDOWN_DAYS (3).
        const skippedThreeDaysAgo = selectDailyQuestion(stageInputs([
            { questionKey: 'stage.confirm_current', createdAtLocalDate: '2026-07-08', ageDays: SKIP_COOLDOWN_DAYS, skipped: true, dailyLogId: null },
        ]));
        expect(skippedThreeDaysAgo!.question.questionKey).toBe('stage.confirm_current');

        const answeredThreeDaysAgo = selectDailyQuestion(stageInputs([
            { questionKey: 'stage.confirm_current', createdAtLocalDate: '2026-07-08', ageDays: SKIP_COOLDOWN_DAYS, skipped: false, dailyLogId: null },
        ]));
        expect(answeredThreeDaysAgo).toBeNull(); // normal cooldownDays (7) still in effect, no other trigger fires
    });

    it('clamps the skip cooldown to the question\'s own (shorter) cooldownDays — a skip never outlasts the normal cooldown', async () => {
        // 'safety.spray_wind_high' has cooldownDays 1, shorter than SKIP_COOLDOWN_DAYS (3).
        // Without the clamp, ageDays 1 < SKIP_COOLDOWN_DAYS(3) would wrongly suppress it.
        // It is the only bank shape with a sub-SKIP_COOLDOWN_DAYS cooldown, and
        // the real entry is agronomist-gated since 2026-08-13, so the clamp is
        // exercised against a substituted APPROVED copy of that same shape —
        // the clamp is a cooldown property, independent of the approval gate.
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            const approvedSafety: DfesQuestion = {
                ...actual.findQuestion('safety.spray_wind_high')!,
                agronomistApproved: true, marathiApproved: true,
            };
            return {
                ...actual,
                findQuestion: (key: string) =>
                    key === 'safety.spray_wind_high' ? approvedSafety : actual.findQuestion(key),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        const r = selectMocked(base({
            weather: { windKph: 30 },
            recentEvents: [{ questionKey: 'safety.spray_wind_high', createdAtLocalDate: '2026-07-10', ageDays: 1, skipped: true, dailyLogId: null }],
        }));
        expect(r!.question.questionKey).toBe('safety.spray_wind_high');
    });

    it('one-question-per-day gate is unchanged: a SKIPPED event today still stops today\'s question (no same-day re-ask)', () => {
        const r = selectDailyQuestion(base({
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-11', ageDays: 0, skipped: true, dailyLogId: null }],
        }));
        expect(r).toBeNull();
    });
});

// spec: dfes-companion-2026-07-11 (Task 3A) — Schedule tier, inserted BETWEEN
// P3 StageWindow and P5 Gap. The real bank entry ships CONTENT-GATED
// (agronomistApproved:false, marathiApproved:false — see dfesQuestionBank.ts),
// so exercising SELECTION needs a substituted APPROVED fixture copy (same
// vi.doMock + vi.resetModules() + dynamic-import isolation pattern as the
// gap.dose approval-gate suite above), while the "stays inert" case is
// proven against the REAL bank entry directly.
describe('selectDailyQuestion — Schedule tier (Task 3A)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    /** Same shape as the real schedule.category_planned_not_done bank entry, minus the approval flags. */
    const scheduleQuestionShape = {
        questionKey: 'schedule.category_planned_not_done', crop: '*', triggerType: 'Schedule', questionType: 'gap_fill',
        lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'आज ठरलेलं {category} काम झालं का?',
    } as const;

    /** Mounts a `dfesQuestionBank` mock whose `findQuestion('schedule.category_planned_not_done')`
     *  returns `question` (all other keys pass through to the REAL bank untouched). */
    async function selectWithSubstitutedScheduleQuestion(question: DfesQuestion, extra: Partial<DailyQuestionInputs> = {}) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findQuestion: (key: string) =>
                    key === 'schedule.category_planned_not_done' ? question : actual.findQuestion(key),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(base(extra));
    }

    it('selects the schedule question (APPROVED fixture) ahead of Gap when no higher-priority trigger fires', async () => {
        const approvedSchedule: DfesQuestion = { ...scheduleQuestionShape, agronomistApproved: true, marathiApproved: true };
        const result = await selectWithSubstitutedScheduleQuestion(approvedSchedule, {
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(result!.question.questionKey).toBe('schedule.category_planned_not_done');
    });

    it('a firing StageWindow still wins over Schedule (StageWindow=P3 is checked before Schedule=P4)', async () => {
        const approvedSchedule: DfesQuestion = { ...scheduleQuestionShape, agronomistApproved: true, marathiApproved: true };
        const result = await selectWithSubstitutedScheduleQuestion(approvedSchedule, {
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null, // stage window open
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        });
        expect(result!.question.questionKey).toBe('stage.confirm_current');
    });

    it('resolves {category} into resolvedPromptMr using scheduleContext.categoryLabelMr', async () => {
        const approvedSchedule: DfesQuestion = { ...scheduleQuestionShape, agronomistApproved: true, marathiApproved: true };
        const result = await selectWithSubstitutedScheduleQuestion(approvedSchedule, {
            scheduleContext: { category: 'IRRIGATION', categoryLabelMr: 'सिंचन' },
        });
        expect(result!.resolvedPromptMr).toBe('आज ठरलेलं सिंचन काम झालं का?');
    });

    it('CONTENT GATE: with the REAL (unapproved) bank entry, the schedule question is never selected even when scheduleContext fires', () => {
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const result = selectDailyQuestion(base({
            score: noGap,
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
        }));
        expect(result).toBeNull();
    });
});

// spec: dfes-companion-2026-07-11 (Task 4B) — WeatherReconcile tier, inserted
// BETWEEN P4 Schedule and P6 Gap. The real bank entry ships CONTENT-GATED
// (agronomistApproved:false, marathiApproved:false — see dfesQuestionBank.ts),
// so exercising SELECTION needs a substituted APPROVED fixture copy (same
// vi.doMock + vi.resetModules() + dynamic-import isolation pattern as the
// Schedule tier suite above), while the "stays inert" case is proven against
// the REAL bank entry directly.
describe('selectDailyQuestion — WeatherReconcile tier (Task 4B)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    /** Same shape as the real weather.severe_care_check bank entry, minus the approval flags. */
    const weatherReconcileQuestionShape = {
        questionKey: 'weather.severe_care_check', crop: '*', triggerType: 'WeatherReconcile', questionType: 'observation',
        lens: 'Execution', depthLevel: 1, priority: 5, cooldownDays: 1, answerModes: 'choice,voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr: 'आज हवा बरीच खराब होती — सगळं ठीक होतं ना?',
    } as const;

    /** Mounts a `dfesQuestionBank` mock whose `findQuestion('weather.severe_care_check')`
     *  returns `question` (all other keys pass through to the REAL bank untouched). */
    async function selectWithSubstitutedWeatherReconcileQuestion(question: DfesQuestion, extra: Partial<DailyQuestionInputs> = {}) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findQuestion: (key: string) =>
                    key === 'weather.severe_care_check' ? question : actual.findQuestion(key),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(base(extra));
    }

    it('selects the weather-reconcile question (APPROVED fixture) ahead of Gap when no higher-priority trigger fires', async () => {
        const approvedReconcile: DfesQuestion = { ...weatherReconcileQuestionShape, agronomistApproved: true, marathiApproved: true };
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const result = await selectWithSubstitutedWeatherReconcileQuestion(approvedReconcile, {
            score: noGap,
            weatherReconcileContext: { severity: 'severe', reason: 'precipMm 20 >= 15' },
        });
        expect(result!.question.questionKey).toBe('weather.severe_care_check');
    });

    it('a firing Schedule still wins over WeatherReconcile (Schedule=P4 is checked before WeatherReconcile=P5)', async () => {
        const approvedReconcile: DfesQuestion = { ...weatherReconcileQuestionShape, agronomistApproved: true, marathiApproved: true };
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            const approvedSchedule: DfesQuestion = {
                questionKey: 'schedule.category_planned_not_done', crop: '*', triggerType: 'Schedule', questionType: 'gap_fill',
                lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'choice,voice',
                safetyClass: 'informational', anchorDateType: 'log_date',
                promptMr: 'आज ठरलेलं {category} काम झालं का?', agronomistApproved: true, marathiApproved: true,
            };
            return {
                ...actual,
                findQuestion: (key: string) => {
                    if (key === 'weather.severe_care_check') return approvedReconcile;
                    if (key === 'schedule.category_planned_not_done') return approvedSchedule;
                    return actual.findQuestion(key);
                },
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const result = selectMocked(base({
            score: noGap,
            scheduleContext: { category: 'FOLIAR_SPRAY', categoryLabelMr: 'फवारणी' },
            weatherReconcileContext: { severity: 'severe', reason: 'precipMm 20 >= 15' },
        }));
        expect(result!.question.questionKey).toBe('schedule.category_planned_not_done');
    });

    it('CONTENT GATE: with the REAL (unapproved) bank entry, the weather-reconcile question is never selected even when weatherReconcileContext fires', () => {
        const noGap: VlogScore = { score: 90, outcome: 'SCORED', dimensions: [] };
        const result = selectDailyQuestion(base({
            score: noGap,
            weatherReconcileContext: { severity: 'severe', reason: 'precipMm 20 >= 15' },
        }));
        expect(result).toBeNull();
    });
});

// spec: dfes-companion-2026-07-11 (wave-3.2) — Ruling 1: an execution-gap question
// belongs to the SPECIFIC SOURCE LOG, not to a day. Monday's and Wednesday's spray logs
// both missing a dose may BOTH be asked; the same log must never receive the same
// question twice, ever. That has no time component, so the exclusion is PERMANENT and is
// deliberately not expressed as a longer cooldown.
describe('per-log dedupe for execution gaps (wave-3.2, Ruling 1)', () => {
    const gapDose = (o: Partial<DailyQuestionInputs['recentEvents'][number]> = {}): DailyQuestionInputs['recentEvents'][number] => ({
        questionKey: 'gap.dose', createdAtLocalDate: '2026-07-09', ageDays: 5,
        skipped: false, dailyLogId: null, ...o,
    });

    it('asks the dose question again for a DIFFERENT spray log', () => {
        // ageDays 2 is INSIDE gap.dose's 3-day cooldown, so this only passes if the
        // per-log rule genuinely replaces the day rule for execution gaps.
        const r = selectDailyQuestion(base({
            sourceLogId: 'log-wed',
            recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 2 })],
        }));
        expect(r?.question.questionKey).toBe('gap.dose');
    });

    it('never asks the dose question twice for the SAME log, however old', () => {
        // 400 days is far outside every cooldown in the bank. Only a PERMANENT
        // per-log exclusion can suppress this; a longer cooldown could not.
        const r = selectDailyQuestion(base({
            sourceLogId: 'log-mon',
            recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 400 })],
        }));
        expect(r?.question.questionKey).not.toBe('gap.dose');
    });

    it('falls back to the day cooldown when the old row has no log id', () => {
        // Every question_events row written before wave-3.1 has daily_log_id NULL.
        // Treating those as "asked about no log" would unblock every gap question at
        // once, the day the API deploys.
        const r = selectDailyQuestion(base({
            sourceLogId: 'log-wed',
            recentEvents: [gapDose({ dailyLogId: null, ageDays: 1 })],
        }));
        expect(r?.question.questionKey).not.toBe('gap.dose');
    });

    it('keeps day cooldowns for CONTEXT questions even across logs', () => {
        // stage.confirm_current is not a Gap/Execution question: it builds the
        // relationship rather than repairing one record, so it stays day-scoped.
        const r = selectDailyQuestion(base({
            score: { score: 90, outcome: 'SCORED', dimensions: [] },
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null,
            sourceLogId: 'log-wed',
            recentEvents: [{
                questionKey: 'stage.confirm_current', createdAtLocalDate: '2026-07-10',
                ageDays: 1, skipped: false, dailyLogId: 'log-mon',
            }],
        }));
        expect(r?.question.questionKey).not.toBe('stage.confirm_current');
    });

    it('a SKIPPED per-log ask still burns the question for that log, permanently', () => {
        // A skip is still "this log was asked". Ruling 1 has no answered/skipped
        // distinction — SKIP_COOLDOWN_DAYS is a DAY-scoped mechanism and must not
        // resurrect a question for a log that already received it.
        const r = selectDailyQuestion(base({
            sourceLogId: 'log-mon',
            recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 30, skipped: true })],
        }));
        expect(r?.question.questionKey).not.toBe('gap.dose');
    });

    it('does NOT relax the one-question-per-day gate — a new log on the same day still waits', () => {
        // MAX_QUESTIONS_PER_DAY is structural, not tunable. Per-log scoping must not
        // turn "one question a day" into "one question per log per day".
        const r = selectDailyQuestion(base({
            sourceLogId: 'log-wed',
            recentEvents: [gapDose({ dailyLogId: 'log-mon', createdAtLocalDate: '2026-07-11', ageDays: 0 })],
        }));
        expect(r).toBeNull();
    });

    /**
     * DOCUMENTED EDGE, asserted rather than left to be discovered.
     *
     * With no `sourceLogId`, a per-log question consults only the LEGACY (null-log) rows
     * for its cooldown, so a row belonging to some OTHER log does not suppress it. That
     * is the direct consequence of Ruling 1 — a different log may be asked the same
     * question — and it is deliberate, not an oversight in the null branch.
     *
     * It is also unreachable from the real app: LedgerRecognitionPanel derives BOTH
     * `sourceLogId` and `score` from the same `savedLog` (:193, :202), so a render with
     * no log id also has no score, and the Gap tier never runs. The one-question-per-day
     * gate caps it regardless. Pinned so that if a future caller ever supplies a score
     * WITHOUT a log id, this test states what will happen instead of it being a surprise.
     */
    it('with no sourceLogId, a per-log question is judged only against legacy (null-log) rows', () => {
        const r = selectDailyQuestion(base({
            recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 1 })],
        }));
        expect(r?.question.questionKey).toBe('gap.dose');

        // The same call with the row marked legacy IS suppressed — which is what proves
        // the assertion above is about the log id, not about the cooldown being dead.
        const legacy = selectDailyQuestion(base({
            recentEvents: [gapDose({ dailyLogId: null, ageDays: 1 })],
        }));
        expect(legacy).toBeNull();
    });
});
