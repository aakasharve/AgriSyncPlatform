// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6) — the calm step list's pure model. Every tick maps to a real event of the save
 * path (`voiceJourneySignal`); nothing depends on time; a journey older than the screen is no journey (P4).
 */
import { describe, expect, it } from 'vitest';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../../types';
import type { VoiceJourneySnapshot } from '../../../../../infrastructure/voice/voiceJourneySignal';
import { journeyFactsOf, journeyStepsOf, liveJourney, STALE_MS, type JourneyFacts } from '../journeyModel';

const crops = [{
    id: 'crop-g', name: 'Grapes', iconName: 'grapes', color: 'purple', supportedTasks: [], workflow: [],
    plots: [{ id: 'plot-a', name: 'सोनाका', baseline: { unit: 'Acre' } }, { id: 'plot-b', name: 'थॉमसन', baseline: { unit: 'Acre' } }],
}] as unknown as CropProfile[];
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const onePlot: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };
const twoPlots: LogScope = { ...onePlot, selectedPlotIds: ['plot-a', 'plot-b'] };

const SAID = 'कॉन्फिडॉर अडीचशे एमएल आणि उथाणे पाचशे ग्रॅम दोनशे लिटर पाण्यात फवारलं, एकोणीस एकोणीस एकोणीस पाच किलो ठिबकने, दहा मजूर होते';
const draft = (over: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], machinery: [], activityExpenses: [], missingSegments: [],
    fullTranscript: SAID,
    inputs: [
        { id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर अडीचशे एमएल आणि उथाणे पाचशे ग्रॅम', carrierVolume: 200, carrierUnit: 'L',
            mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }, { id: 'm2', productName: 'उथाणे', dose: 500, unit: 'g' }] },
        { id: 'ev-drip', method: 'Drip', sourceText: 'एकोणीस एकोणीस एकोणीस पाच किलो ठिबकने',
            mix: [{ id: 'd1', productName: '19:19:19', npkGrade: '19:19:19', dose: 5, unit: 'kg' }] },
    ],
    labour: [{ id: 'lab', type: 'HIRED', count: 10, sourceText: 'दहा मजूर होते' }],
    ...over,
} as unknown as AgriLogResponse);

const MOUNT = 1_000_000;
const snap = (over: Partial<VoiceJourneySnapshot> = {}): VoiceJourneySnapshot => ({ startedAt: MOUNT + 100, input: 'audio', durationMs: 46_400, keptAt: MOUNT + 100, ...over });
const facts = (d: AgriLogResponse | undefined, language: 'mr' | 'en' = 'mr', scope: LogScope = onePlot): JourneyFacts =>
    journeyFactsOf(d, scope, crops, profile, language);
const states = (s: VoiceJourneySnapshot | null, f: JourneyFacts = facts(s?.draft), language: 'mr' | 'en' = 'mr') =>
    Object.fromEntries(journeyStepsOf(liveJourney(s, MOUNT), f, language).steps.map(x => [x.key, x.state]));

describe('journeyFactsOf — what the step list shows, from the save\'s own factory and the result screen\'s models', () => {
    it('lists the three products with their type words, as {part, text} chips', () => {
        const f = facts(draft());
        expect(f.products).toHaveLength(3);
        f.products.forEach(c => expect(c.part).toBe('inputs'));
        expect(f.products[0].text).toContain('कॉन्फिडॉर');
        expect(f.products[0].text).toContain('कीटकनाशक');
        expect(f.products[2].text).toContain('खत');
    });

    it('the parts include labour (his count, in Devanagari digits) and the sprays by their part name', () => {
        const f = facts(draft());
        const labour = f.parts.find(c => c.part === 'labour');
        expect(labour?.text).toContain('१०');
        expect(f.parts.find(c => c.part === 'inputs')?.text).toBe('औषध / खत');
    });

    it('two plots: the same products are not listed twice', () => {
        expect(facts(draft(), 'mr', twoPlots).products).toHaveLength(3);
    });

    it('English mode: English part and type words', () => {
        const f = facts(draft(), 'en');
        expect(f.parts.find(c => c.part === 'inputs')?.text).toBe('Sprays / fertiliser');
        expect(f.products[0].text).toContain('Insecticide');
    });

    it('the excerpt is his first eight words, marked when cut; none for an empty transcript; nothing without a draft', () => {
        expect(facts(draft()).excerpt).toBe(`${SAID.split(' ').slice(0, 8).join(' ')} …`);
        expect(facts(draft({ fullTranscript: 'दहा मजूर होते' })).excerpt).toBe('दहा मजूर होते');
        expect(facts(draft({ fullTranscript: '   ' })).excerpt).toBeNull();
        expect(facts(undefined)).toEqual({ excerpt: null, parts: [], products: [] });
    });
});

describe('journeyStepsOf — each tick a real event', () => {
    it('no journey: step 1 active, progress 0', () => {
        const view = journeyStepsOf(liveJourney(null, MOUNT), facts(undefined), 'mr');
        expect(view.steps[0]).toMatchObject({ key: 'kept', state: 'active' });
        expect(view.progress).toBe(0);
        expect(view.complete).toBe(false);
    });

    it('kept only: step 1 done with his seconds "on the phone", the next one active', () => {
        const view = journeyStepsOf(liveJourney(snap(), MOUNT), facts(undefined), 'mr');
        expect(view.steps[0]).toMatchObject({ key: 'kept', state: 'done', label: 'आवाज जतन केला', sub: '४६ सेकंदांचा आवाज · फोनवर सुरक्षित' });
        expect(view.steps[1]).toMatchObject({ key: 'words', state: 'active' });
        expect(view.steps.filter(s => s.state === 'active')).toHaveLength(1);
    });

    it('typed: step 1 reads "तुम्ही लिहिलेलं मिळालं", no seconds', () => {
        const view = journeyStepsOf(liveJourney(snap({ input: 'text', durationMs: undefined }), MOUNT), facts(undefined), 'mr');
        expect(view.steps[0]).toMatchObject({ key: 'kept', state: 'done', label: 'तुम्ही लिहिलेलं मिळालं' });
        expect(view.steps[0].sub).toBeUndefined();
    });

    it('understood: words, parts and products done in the same call (chips on parts and products); the plot step active', () => {
        const d = draft();
        const s = snap({ draft: d, understoodAt: MOUNT + 900 });
        expect(states(s)).toEqual({ kept: 'done', words: 'done', parts: 'done', place: 'active', products: 'done', saved: 'waiting' });
        const view = journeyStepsOf(liveJourney(s, MOUNT), facts(d), 'mr');
        expect(view.steps.find(x => x.key === 'parts')?.chips?.length).toBeGreaterThan(0);
        expect(view.steps.find(x => x.key === 'products')?.chips).toHaveLength(3);
        expect(view.steps.find(x => x.key === 'words')?.sub).toContain('कॉन्फिडॉर');
    });

    it('no inputs: the products step is not drawn and the total shrinks', () => {
        const d = draft({ inputs: [] });
        const view = journeyStepsOf(liveJourney(snap({ draft: d, understoodAt: MOUNT + 900, place: 'same', writtenAt: MOUNT + 950 }), MOUNT), facts(d), 'mr');
        expect(view.steps.map(x => x.key)).toEqual(['kept', 'words', 'parts', 'place', 'saved']);
        expect(view.progress).toBe(1);
    });

    it('an empty transcript: the words step is skipped (never ticked), and it does not hold the bar back', () => {
        const d = draft({ fullTranscript: '' });
        const s = snap({ draft: d, understoodAt: MOUNT + 900, place: 'same', writtenAt: MOUNT + 950 });
        expect(states(s).words).toBe('skipped');
        expect(journeyStepsOf(liveJourney(s, MOUNT), facts(d), 'mr')).toMatchObject({ progress: 1, complete: true });
    });

    it('another plot (or unclear): the plot step stays active, never done, and nothing is saved', () => {
        const d = draft();
        expect(states(snap({ draft: d, understoodAt: MOUNT + 900, place: 'otherPlot' })).place).toBe('active');
        expect(states(snap({ draft: d, understoodAt: MOUNT + 900, place: 'unclear' })).place).toBe('active');
        expect(states(snap({ draft: d, understoodAt: MOUNT + 900, place: 'otherPlot' })).saved).toBe('waiting');
    });

    it('written: every step done, progress 1, complete', () => {
        const d = draft();
        const view = journeyStepsOf(liveJourney(snap({ draft: d, understoodAt: MOUNT + 900, place: 'same', writtenAt: MOUNT + 950 }), MOUNT), facts(d), 'mr');
        expect(view.steps.every(x => x.state === 'done')).toBe(true);
        expect(view.progress).toBe(1);
        expect(view.complete).toBe(true);
    });

    it('the bar moves in whole steps: done / drawn steps', () => {
        const d = draft();
        const at = (s: VoiceJourneySnapshot | null) => journeyStepsOf(liveJourney(s, MOUNT), facts(s?.draft), 'mr').progress;
        expect(at(snap())).toBe(1 / 5); // products unknown until understood: 5 steps drawn
        expect(at(snap({ draft: d, understoodAt: MOUNT + 900 }))).toBe(4 / 6);
        expect(at(snap({ draft: d, understoodAt: MOUNT + 900, place: 'same' }))).toBe(5 / 6);
    });

    it('a journey older than the screen (more than the grace before its mount) counts as none', () => {
        const old = snap({ startedAt: MOUNT - STALE_MS - 1, keptAt: MOUNT - STALE_MS - 1, draft: draft(), understoodAt: MOUNT - 10, place: 'same', writtenAt: MOUNT - 5 });
        expect(liveJourney(old, MOUNT)).toBeNull();
        expect(states(old, facts(undefined))).toMatchObject({ kept: 'active', words: 'waiting', saved: 'waiting' });
        expect(liveJourney(snap({ startedAt: MOUNT - 500 }), MOUNT)).not.toBeNull();
    });

    it('no time dependence: the same inputs give the same steps at any moment', () => {
        const s = snap({ draft: draft(), understoodAt: MOUNT + 900 });
        const a = journeyStepsOf(liveJourney(s, MOUNT), facts(s.draft), 'mr');
        const b = journeyStepsOf(liveJourney(s, MOUNT), facts(s.draft), 'mr');
        expect(b).toEqual(a);
    });

    it('English words in English mode', () => {
        const view = journeyStepsOf(liveJourney(snap(), MOUNT), facts(undefined), 'en');
        expect(view.steps[0]).toMatchObject({ label: 'Voice kept', sub: '46 seconds of voice · safe on the phone' });
    });
});
