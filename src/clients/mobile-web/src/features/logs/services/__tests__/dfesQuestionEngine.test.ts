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
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-11', ageDays: 0, skipped: false }],
        }));
        expect(r).toBeNull();
    });

    it('Safety beats Weather beats StageWindow beats Gap (priority order)', () => {
        const inputs = base({
            weather: { rainProbNext6h: 80, windKph: 30, hasActiveAlert: true },
            stageContext: { crop: 'grapes', expectedStage: 'flowering' },
            lastStageConfirm: null,
        });
        expect(selectDailyQuestion(inputs)!.question.questionKey).toBe('safety.spray_wind_high');
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
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-09', ageDays: 2, skipped: false }], // < 3d cooldown
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
    it('a question skipped 1 day ago is still on the (shorter) skip-cooldown — excluded, distinct from the one-per-day gate', () => {
        // 'gap.dose' has cooldownDays 3 (== SKIP_COOLDOWN_DAYS); skipped 1 day
        // ago (not today) means the per-day gate does NOT apply here — only
        // the skip-cooldown does, and 1 < 3 keeps it suppressed. With only one
        // gap dimension in the score there is no other gap to fall back to.
        const r = selectDailyQuestion(base({
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-10', ageDays: 1, skipped: true }],
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
            { questionKey: 'stage.confirm_current', createdAtLocalDate: '2026-07-08', ageDays: SKIP_COOLDOWN_DAYS, skipped: true },
        ]));
        expect(skippedThreeDaysAgo!.question.questionKey).toBe('stage.confirm_current');

        const answeredThreeDaysAgo = selectDailyQuestion(stageInputs([
            { questionKey: 'stage.confirm_current', createdAtLocalDate: '2026-07-08', ageDays: SKIP_COOLDOWN_DAYS, skipped: false },
        ]));
        expect(answeredThreeDaysAgo).toBeNull(); // normal cooldownDays (7) still in effect, no other trigger fires
    });

    it('clamps the skip cooldown to the question\'s own (shorter) cooldownDays — a skip never outlasts the normal cooldown', () => {
        // 'safety.spray_wind_high' has cooldownDays 1, shorter than SKIP_COOLDOWN_DAYS (3).
        // Without the clamp, ageDays 1 < SKIP_COOLDOWN_DAYS(3) would wrongly suppress it.
        const r = selectDailyQuestion(base({
            weather: { windKph: 30 },
            recentEvents: [{ questionKey: 'safety.spray_wind_high', createdAtLocalDate: '2026-07-10', ageDays: 1, skipped: true }],
        }));
        expect(r!.question.questionKey).toBe('safety.spray_wind_high');
    });

    it('one-question-per-day gate is unchanged: a SKIPPED event today still stops today\'s question (no same-day re-ask)', () => {
        const r = selectDailyQuestion(base({
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-11', ageDays: 0, skipped: true }],
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
