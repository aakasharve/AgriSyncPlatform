// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13, round 2) — the result screen's model over logs built
 * by the REAL log factories, not hand-made fixtures. Round 1's fixtures left out two things every real log has:
 *   - the parser writes a Marathi title beside ENGLISH work types ({title:'फवारणी', workTypes:['Spraying']});
 *   - both factories write every planned task TWICE (the task + a mirrored "reminder" note), and turn a reminder
 *     note into a task that points back at it.
 * So: the crop work must read "फवारणी" (not just "पीक काम"), and "उद्या फवारणी" must show ONCE.
 */
import { describe, expect, it } from 'vitest';
import { LogFactory } from '../../../../../core/domain/LogFactory';
import type { Clock } from '../../../../../core/domain/services/Clock';
import { workDoneOf } from '../../../../../core/navigation/activityFeedEntries';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../../types';
import { buildDayView, partEntriesOf, type WhoDeps } from '../resultModel';

const AT = '2026-10-26T05:00:00.000Z';
const clock: Clock = { now: () => new Date(AT), nowISO: () => AT, nowEpoch: () => Date.parse(AT) };
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const crops = [{
    id: 'crop-g', name: 'Grapes', iconName: 'grapes', color: 'purple', supportedTasks: [], workflow: [],
    plots: [{ id: 'plot-a', name: 'सोनाका', baseline: { unit: 'Acre' } }, { id: 'plot-b', name: 'थॉमसन', baseline: { unit: 'Acre' } }],
}] as unknown as CropProfile[];
const onePlot: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };
const deps: WhoDeps = { youIds: new Set(['owner']), nameOf: () => undefined, ownName: 'सुनील', unknownLabel: 'अज्ञात' };

const voice = (over: Partial<AgriLogResponse>): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], ...over,
} as AgriLogResponse);

const fromVoice = (r: AgriLogResponse, scope: LogScope = onePlot) =>
    LogFactory.createFromVoiceResult(r, scope, crops, profile, undefined, undefined, clock);

describe('real voice logs — what the result screen says Sathi understood', () => {
    it('"उद्या फवारणी" said once shows ONCE as उद्याचं काम (the mirrored reminder note is not a second one)', () => {
        const [log] = fromVoice(voice({
            fullTranscript: 'उद्या फवारणी करायची आहे',
            plannedTasks: [{ title: 'उद्या फवारणी', dueHint: 'उद्या', category: 'maintenance', sourceText: 'उद्या फवारणी', systemInterpretation: 'Spray tomorrow' }],
        }));
        // The factory really does write it twice — this is what the model must see through.
        expect(log.plannedTasks?.filter(t => t.title === 'उद्या फवारणी')).toHaveLength(1);
        expect(log.observations?.filter(o => o.noteType === 'reminder' && o.textRaw === 'उद्या फवारणी')).toHaveLength(1);

        const planned = partEntriesOf(log).filter(e => e.part === 'planned');
        expect(planned.map(e => e.value)).toEqual(['उद्या फवारणी']);
        const day = buildDayView([log], [log], deps);
        expect(day.byPart.planned).toHaveLength(1);
    });

    it('a reminder note the parser split into a task is shown once, as the note he said', () => {
        const [log] = fromVoice(voice({
            fullTranscript: 'परवा खताची गाडी येणार',
            observations: [{
                id: 'obs-1', noteType: 'reminder', textRaw: 'परवा खताची गाडी येणार', sourceText: 'परवा खताची गाडी येणार',
                extractedTasks: [{ id: 'task-1', title: 'खत गाडी', confidence: 80 }],
            }] as unknown as AgriLogResponse['observations'],
        }));
        expect(log.plannedTasks?.some(t => t.sourceObservationId)).toBe(true); // the factory made the derived task
        const planned = partEntriesOf(log).filter(e => e.part === 'planned');
        expect(planned).toHaveLength(1);
        expect(planned[0]).toMatchObject({ value: 'परवा खताची गाडी येणार', quote: 'परवा खताची गाडी येणार', verified: true });
    });

    it('crop work reads his Marathi title, not the part name — the parser\'s English work types never show', () => {
        const [log] = fromVoice(voice({
            fullTranscript: 'आज फवारणी केली',
            cropActivities: [{ id: 'a1', title: 'फवारणी', workTypes: ['Spraying'] }] as unknown as AgriLogResponse['cropActivities'],
        }));
        const [crop] = partEntriesOf(log).filter(e => e.part === 'crop');
        expect(crop.value).toBe('फवारणी');
        expect(workDoneOf(log)).toBe('फवारणी'); // the feed card's headline too
    });

    it('a title in English only is said in Marathi when it is a known work type (spec I18), else his verified phrase, else nothing', () => {
        const [log] = fromVoice(voice({
            fullTranscript: 'आज छाटणी केली',
            cropActivities: [
                { id: 'a1', title: 'Pruning', workTypes: ['छाटणी'] },
                { id: 'a2', title: 'Pruning', workTypes: ['Pruning'], sourceText: 'छाटणी केली' },
                { id: 'a3', title: 'Weeding', workTypes: ['Weeding'] },
                { id: 'a4', title: 'Canopy management', workTypes: ['Canopy management'], sourceText: 'छाटणी केली' },
                { id: 'a5', title: 'Canopy management', workTypes: ['Canopy management'] },
            ] as unknown as AgriLogResponse['cropActivities'],
        }));
        const values = partEntriesOf(log).filter(e => e.part === 'crop').map(e => e.value);
        expect(values).toEqual(['छाटणी', 'छाटणी', 'खुरपणी', 'छाटणी केली', null]);
    });

    it('his own words keep a brand name written in Latin letters; a label with no Marathi at all is dropped', () => {
        const [log] = fromVoice(voice({
            fullTranscript: 'रोगर Rogor फवारले',
            inputs: [
                { id: 'i1', productName: 'Rogor औषध' },
                { id: 'i2', productName: 'Bavistin' },
            ] as unknown as AgriLogResponse['inputs'],
            observations: [{ id: 'o1', noteType: 'observation', textRaw: 'पानांवर Downy दिसला' }] as unknown as AgriLogResponse['observations'],
        }));
        const entries = partEntriesOf(log);
        // (the factory gives each input its own id, so they are read in order)
        expect(entries.filter(e => e.part === 'inputs').map(e => e.value)).toEqual(['Rogor औषध', null]);
        expect(entries.find(e => e.part === 'observation')?.value).toBe('पानांवर Downy दिसला');
    });

    it('one recording that names two plots becomes two logs but ONE earlier recording on a later screen', () => {
        const twoPlots: LogScope = { selectedPlotIds: ['plot-a', 'plot-b'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };
        const earlier = fromVoice(voice({
            fullTranscript: 'सोनाका आणि थॉमसनला पाणी दिलं',
            irrigation: [
                { id: 'w1', durationHours: 1, targetPlotName: 'सोनाका' },
                { id: 'w2', durationHours: 2, targetPlotName: 'थॉमसन' },
            ] as unknown as AgriLogResponse['irrigation'],
        }), twoPlots);
        const later = LogFactory.createFromVoiceResult(voice({ fullTranscript: 'फवारणी केली', cropActivities: [{ id: 'c', title: 'फवारणी' }] as unknown as AgriLogResponse['cropActivities'] }),
            twoPlots, crops, profile, undefined, undefined, { ...clock, nowISO: () => '2026-10-26T09:00:00.000Z' });
        const day = buildDayView(later, [...later, ...earlier], deps);
        expect(earlier.length).toBeGreaterThan(1);
        expect(day.earlier).toHaveLength(1);
        expect(day.earlier[0].logIds.sort()).toEqual(earlier.map(l => l.id).sort());
        expect(day.speakers).toEqual([{ name: 'सुनील', you: true, times: 2 }]);
    });
});

describe('real manual logs — typed tasks and reminders', () => {
    it('a typed task and a typed reminder each show once', () => {
        const [log] = LogFactory.createFromManualEntry({
            date: '2026-10-26',
            plannedTasks: [{ id: 'pt-1', title: 'उद्या खत टाका', status: 'pending', priority: 'normal', createdAt: AT }],
            observations: [{ id: 'ob-1', plotId: 'plot-a', dateKey: '2026-10-26', timestamp: AT, textRaw: 'पंप दुरुस्त करायचा', noteType: 'reminder', severity: 'normal', source: 'manual' }],
        } as never, onePlot, crops, profile, clock);
        const planned = partEntriesOf(log).filter(e => e.part === 'planned').map(e => e.value).sort();
        expect(planned).toEqual(['उद्या खत टाका', 'पंप दुरुस्त करायचा'].sort());
    });
});
