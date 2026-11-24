// @vitest-environment jsdom
/**
 * spec: voice-flow-v2-2026-11-23 (F1, F8) - the REAL server answer for the founder's first note, through the real
 * log factory and the day view. Sathi understood the product ("05234 चं खत" = 0-52-34, verified): the screen may
 * never say it was "not understood".
 */
import { describe, expect, it } from 'vitest';
import { LogFactory } from '../../../../../core/domain/LogFactory';
import type { Clock } from '../../../../../core/domain/services/Clock';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../../types';
import { buildDayView, partEntriesOf, type WhoDeps } from '../resultModel';
import job from './fixtures/job_23d384ea.json';

const AT = '2026-11-24T05:00:00.000Z';
const clock: Clock = { now: () => new Date(AT), nowISO: () => AT, nowEpoch: () => Date.parse(AT) };
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const crops = [{
    id: 'crop-g', name: 'Grapes', iconName: 'grapes', color: 'purple', supportedTasks: [], workflow: [],
    plots: [{ id: 'plot-a', name: 'प्लॉट १', baseline: { unit: 'Acre' } }],
}] as unknown as CropProfile[];
const scope: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };
const deps: WhoDeps = { youIds: new Set(['owner']), nameOf: () => undefined, ownName: 'सुनील', unknownLabel: 'अज्ञात' };

const logs = () => LogFactory.createFromVoiceResult(job.result as unknown as AgriLogResponse, scope, crops, profile, undefined, undefined, clock);

describe('job_23d384ea (real server answer)', () => {
    it('F1: the verified product is understood - never in the "not understood" list, shown as 0-52-34', () => {
        const [log] = logs();
        const day = buildDayView([log], [log], deps);
        expect(day.unsure).toEqual([]);
        expect(day.missing).not.toContain('inputs');
        const [input] = day.byPart.inputs;
        expect(input).toMatchObject({ value: '0-52-34', verified: true });
    });

    it('F1: a part the ring does not call told but that holds a VERIFIED entry is partial, not unsure', () => {
        const [log] = logs();
        const noted = { ...log, observations: [{ id: 'o1', textRaw: 'पाने पिवळी आहेत', provenanceVerified: true }], plannedTasks: [] } as unknown as typeof log;
        const day = buildDayView([noted], [noted], deps);
        expect(day.partial).toContain('observation');
        expect(day.unsure).not.toContain('observation');
    });

    it('F1: only an entry the server could NOT verify stays unsure', () => {
        const [log] = logs();
        const bad = { ...log, observations: [{ id: 'o1', textRaw: 'पाने पिवळी आहेत', provenanceVerified: false }], plannedTasks: [] } as unknown as typeof log;
        const day = buildDayView([bad], [bad], deps);
        expect(day.unsure).toContain('observation');
        expect(day.partial).not.toContain('observation');
    });

    it('F8: tomorrow urea (note + its extracted task + the planned task) shows ONCE', () => {
        const [log] = logs();
        const planned = partEntriesOf(log, 'mr', true).filter(e => e.part === 'planned');
        expect(planned).toHaveLength(1);
        expect(planned[0].value).toBe('युरिया टाकणे'); // the app's own Marathi wording
        expect(planned[0].quote).toBe('उद्या urea टाकायचा आहे'); // his words, for the marks in the transcript
        expect(buildDayView([log], [log], deps).byPart.planned).toHaveLength(1);
    });

    it('F8: two different future tasks both stay', () => {
        const [log] = logs();
        const two = { ...log, plannedTasks: [...(log.plannedTasks ?? []), { id: 'x', title: 'फवारणी करणे', status: 'pending', sourceType: 'ai_extracted' }] } as unknown as typeof log;
        expect(partEntriesOf(two, 'mr', true).filter(e => e.part === 'planned').map(e => e.value)).toEqual(['युरिया टाकणे', 'फवारणी करणे']);
    });
});
