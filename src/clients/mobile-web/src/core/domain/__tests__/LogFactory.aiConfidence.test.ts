/**
 * WAVE 2.1 — the log factory may not score an observation the AI never scored.
 *
 * spec: dfes-companion-2026-07-11 (wave-2.1)
 *
 * `aiConfidence: obs.aiConfidence || 90` stamped a 90% confidence figure on every
 * observation whose parse carried no score. Nothing computed 90 — it is a number the
 * app wrote about itself and then showed the farmer as the AI's own certainty.
 *
 * It is not cosmetic. `ObservationEventCard` renders its low-confidence caveat only
 * when `aiConfidence < 60`, so the invented 90 SUPPRESSED the one signal telling the
 * farmer the machine was unsure. Doctrine P4: no default fills a bucket the farmer
 * did not fill.
 *
 * Both voice branches carried the same line — the per-plot log and the farm-global
 * log — so both are covered here.
 */

import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import type { Clock } from '../services/Clock';
import type {
    FarmerProfile,
    CropProfile,
    LogScope,
    AgriLogResponse,
} from '../../../types';

const FIXED_ISO = '2026-08-16T06:00:00.000Z';

const fixedClock: Clock = {
    now: () => new Date(FIXED_ISO),
    nowISO: () => FIXED_ISO,
    nowEpoch: () => new Date(FIXED_ISO).getTime(),
};

function makeProfile(): FarmerProfile {
    return {
        activeOperatorId: 'owner',
        trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false },
        operators: [],
    } as unknown as FarmerProfile;
}

function makeCrops(): CropProfile[] {
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [
                { id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } },
            ] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeSinglePlotScope(): LogScope {
    return {
        selectedPlotIds: ['plot-a'],
        selectedCropIds: ['crop-grapes'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

/** No plot resolved + the FARM_GLOBAL sentinel → createFarmGlobalVoiceLog. */
function makeFarmGlobalScope(): LogScope {
    return {
        selectedPlotIds: [],
        selectedCropIds: ['FARM_GLOBAL'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

/** One observation the AI reported without any confidence figure, plus one it scored. */
function makeVoiceResponseWithObservations(): AgriLogResponse {
    return {
        summary: 'पानं पिवळी पडली आहेत',
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        observations: [
            { id: 'obs-unscored', textRaw: 'पानं पिवळी पडली आहेत' },
            { id: 'obs-scored', textRaw: 'बुरशी दिसली', aiConfidence: 35 },
        ],
        plannedTasks: [],
        missingSegments: [],
    } as unknown as AgriLogResponse;
}

function runVoice(scope: LogScope) {
    return LogFactory.createFromVoiceResult(
        makeVoiceResponseWithObservations(),
        scope,
        makeCrops(),
        makeProfile(),
        undefined,
        undefined,
        fixedClock,
    );
}

describe('LogFactory voice path — an unscored observation stays unscored', () => {
    it('per-plot log: leaves aiConfidence unset when the parse carried none', () => {
        const logs = runVoice(makeSinglePlotScope());
        expect(logs).toHaveLength(1);

        const unscored = logs[0].observations?.find(o => o.textRaw === 'पानं पिवळी पडली आहेत');
        expect(unscored).toBeDefined();
        expect(unscored!.aiConfidence).toBeUndefined();
    });

    it('per-plot log: still passes a REAL low score through untouched', () => {
        // Not vacuous, and the reason the field exists: a genuine 35 must survive so
        // ObservationEventCard can render its `< 60` caveat.
        const logs = runVoice(makeSinglePlotScope());

        const scored = logs[0].observations?.find(o => o.textRaw === 'बुरशी दिसली');
        expect(scored).toBeDefined();
        expect(scored!.aiConfidence).toBe(35);
    });

    it('farm-global log: leaves aiConfidence unset when the parse carried none', () => {
        const logs = runVoice(makeFarmGlobalScope());
        expect(logs).toHaveLength(1);

        const unscored = logs[0].observations?.find(o => o.textRaw === 'पानं पिवळी पडली आहेत');
        expect(unscored).toBeDefined();
        expect(unscored!.aiConfidence).toBeUndefined();
    });

    it('farm-global log: still passes a REAL low score through untouched', () => {
        const logs = runVoice(makeFarmGlobalScope());

        const scored = logs[0].observations?.find(o => o.textRaw === 'बुरशी दिसली');
        expect(scored).toBeDefined();
        expect(scored!.aiConfidence).toBe(35);
    });
});
