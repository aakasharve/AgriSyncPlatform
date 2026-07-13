import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectDailyQuestion, type DailyQuestionInputs } from '../dfesQuestionEngine';
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
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-11', ageDays: 0 }],
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
            recentEvents: [{ questionKey: 'gap.dose', createdAtLocalDate: '2026-07-09', ageDays: 2 }], // < 3d cooldown
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
