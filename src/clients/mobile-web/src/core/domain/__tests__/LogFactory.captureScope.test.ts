/**
 * PR #82 review (B002, client half; spec: 2026-08-25-prod-cutover-waves) — a
 * record written by the labour (हजेरी) door's बरोबर says so: `captureScope:
 * 'labour'` on the DailyLog, copied from the submission, so the sync layer can
 * tell the server to take labour only from the voice job (that mapping lands
 * with the contract change in PR #83; until then the field is not sent).
 *
 * Both manual branches (a plot, and संपूर्ण शेत), and an ordinary record keeps
 * exactly its old shape: no key at all.
 */
import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import type { CropProfile, FarmerProfile, LabourEvent, LogScope } from '../../../types';

const profile = { activeOperatorId: 'owner', operators: [] } as unknown as FarmerProfile;
const crops = [{ id: 'crop-grapes', name: 'Grapes', plots: [{ id: 'plot-a', name: 'Plot A' }] }] as unknown as CropProfile[];
const plotScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-grapes'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;
const farmScope = { selectedPlotIds: [], selectedCropIds: ['FARM_GLOBAL'], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;
const labour = [{ id: 'l1', type: 'HIRED', count: 4, workerNames: ['गणेश', 'शंकर', 'बाळू', 'नवीन'] }] as unknown as LabourEvent[];

describe('LogFactory — captureScope from the labour door', () => {
    it('is copied onto a plot record', () => {
        const [log] = LogFactory.createFromManualEntry({ date: '2026-10-17', labour, captureScope: 'labour' }, plotScope, crops, profile);
        expect(log.captureScope).toBe('labour');
    });

    it('is copied onto a संपूर्ण शेत (farm-wide) record', () => {
        const [log] = LogFactory.createFromManualEntry({ date: '2026-10-17', labour, captureScope: 'labour' }, farmScope, crops, profile);
        expect(log.captureScope).toBe('labour');
    });

    it('an ordinary record carries no captureScope key at all', () => {
        const [plotLog] = LogFactory.createFromManualEntry({ date: '2026-10-17', labour }, plotScope, crops, profile);
        const [farmLog] = LogFactory.createFromManualEntry({ date: '2026-10-17', labour }, farmScope, crops, profile);
        expect(plotLog).not.toHaveProperty('captureScope');
        expect(farmLog).not.toHaveProperty('captureScope');
    });
});
