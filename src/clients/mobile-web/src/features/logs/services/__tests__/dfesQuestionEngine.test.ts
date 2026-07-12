import { describe, it, expect } from 'vitest';
import { selectDailyQuestion, type DailyQuestionInputs } from '../dfesQuestionEngine';
import type { VlogScore } from '../../../../domain/types/log.types';

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
