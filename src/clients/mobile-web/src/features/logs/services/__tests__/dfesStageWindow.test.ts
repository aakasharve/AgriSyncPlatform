import { describe, it, expect } from 'vitest';
import { isStageConfirmationWindowOpen } from '../dfesStageWindow';
import type { StageContext } from '../meterGaps';

const stage = (o: Partial<StageContext>): StageContext => ({ crop: 'grapes', ...o });

describe('isStageConfirmationWindowOpen (Phase 5)', () => {
    it('is CLOSED when there is no expected stage to confirm against', () => {
        expect(isStageConfirmationWindowOpen(stage({ expectedStage: undefined }), null)).toBe(false);
    });

    it('is OPEN when the farmer has never confirmed a stage', () => {
        expect(isStageConfirmationWindowOpen(stage({ expectedStage: 'flowering' }), null)).toBe(true);
    });

    it('is OPEN when the expected stage differs from the last confirmed actual stage', () => {
        const ctx = stage({ expectedStage: 'veraison', farmerConfirmedActualStage: 'flowering' });
        expect(isStageConfirmationWindowOpen(ctx, { questionKey: 'stage.confirm_current', ageDays: 2 })).toBe(true);
    });

    it('is CLOSED when stage matches and it was confirmed within the 7-day cooldown', () => {
        const ctx = stage({ expectedStage: 'flowering', farmerConfirmedActualStage: 'flowering' });
        expect(isStageConfirmationWindowOpen(ctx, { questionKey: 'stage.confirm_current', ageDays: 3 })).toBe(false);
    });

    it('re-OPENS once the 7-day confirmation cooldown has elapsed even if stage matches', () => {
        const ctx = stage({ expectedStage: 'flowering', farmerConfirmedActualStage: 'flowering' });
        expect(isStageConfirmationWindowOpen(ctx, { questionKey: 'stage.confirm_current', ageDays: 8 })).toBe(true);
    });
});
