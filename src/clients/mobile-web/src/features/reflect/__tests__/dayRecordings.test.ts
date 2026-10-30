/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF)
 *
 * The day's work on आढावा, recording by recording, read through the result screen's own model: one recording that
 * named several plots stays one; time order; who said it ("तुम्ही" / name / "अज्ञात", never a guess) in his language;
 * a plot's view shows what was understood for THAT plot with his words from the log that carries them; nothing is
 * summed across recordings (P4); an older record kept only as task lines invents nothing (lane F1); money he may not
 * see is "—"; and ▶ is offered only where it may be (`listenModel`).
 */
import { describe, expect, it } from 'vitest';
import { LogVerificationStatus, type DailyLog } from '../../../types';
import { RESULT_STR } from '../../logs/components/voiceResult/resultStrings';
import { HIDDEN_MONEY, anyLog, dayPartsOf, dayRecordings, plotLogFilter, recordingOfLog, withMoneyShown, type DayRecording } from '../day/dayRecordings';
import { listenKind, serverMayPlay, type Viewer } from '../day/listenModel';
import { reflectCopy } from '../reflectCopy';
import { CROPS, TODAY_KEY, log } from './reflectFixtures';

const ME = 'user-me';
const depsIn = (language: 'mr' | 'en') => {
    const copy = reflectCopy(language);
    return { youIds: new Set([ME]), nameOf: (id: string) => ({ 'op-sunil': 'सुनील' } as Record<string, string>)[id], youLabel: copy.you, unknownLabel: copy.unknownPerson };
};
const mr = depsIn('mr');

const at = (hhmm: string) => `2026-10-25T${hhmm}:00.000Z`;
const said = (id: string, iso: string, who: string | undefined, extra: Partial<DailyLog> & { plotIds?: string[]; cropId?: string } = {}): DailyLog =>
    log({ id, meta: { createdAtISO: iso, ...(who ? { createdByOperatorId: who } : {}) }, ...extra });

describe('dayRecordings — one row per recording, in time order', () => {
    const morning = said('m', at('03:40'), ME, { fullTranscript: 'छाटणी केली', cropActivities: [{ id: 'a1', title: 'छाटणी', sourceText: 'छाटणी केली' }] });
    // one recording that named two plots: two logs, one clock, one speaker; only one carries his words
    const twoA = said('t-a', at('06:00'), 'op-sunil', { plotIds: ['g1'], fullTranscript: 'दोन्ही प्लॉटला पाणी दिलं', irrigation: [{ id: 'w1', durationHours: 2 }] });
    const twoB = said('t-b', at('06:00'), 'op-sunil', { plotIds: ['g2'], irrigation: [{ id: 'w2', durationHours: 3 }] });
    const nobody = said('n', at('09:30'), undefined, { cropId: 'cane', plotIds: ['c1'] });
    const deleted = said('d', at('10:00'), ME, { deletion: { deletedAtISO: at('10:05') } as DailyLog['deletion'] });
    const yesterday = said('y', '2026-10-24T05:00:00.000Z', ME, { date: '2026-10-24' });
    const history = [nobody, twoB, morning, twoA, deleted, yesterday];

    it('groups a recording that named two plots into ONE, morning first; deleted and other days are not work done', () => {
        const recs = dayRecordings(history, TODAY_KEY, anyLog, mr, CROPS);
        expect(recs.map(r => r.view.logIds)).toEqual([['m'], ['t-b', 't-a'], ['n']]);
        expect(recs[1].plotNames).toEqual(['g2', 'g1']);
        expect(recs[1].voiceLog.id).toBe('t-a');
        expect(recs[0].view.timeLabel).toBe('सकाळी 9:10');
        expect(recs[0].headline).toBe('छाटणी');
    });

    it('who said it: "तुम्ही" for the person holding this phone, else the recorded name, else "अज्ञात" — in English, English', () => {
        const recs = dayRecordings(history, TODAY_KEY, anyLog, mr, CROPS);
        expect(recs.map(r => r.view.who)).toEqual([{ name: RESULT_STR.you, you: true }, { name: 'सुनील', you: false }, { name: RESULT_STR.unknownPerson, you: false }]);
        const en = dayRecordings(history, TODAY_KEY, anyLog, depsIn('en'), CROPS);
        expect(en.map(r => r.view.who.name)).toEqual(['You', 'सुनील', 'Unknown']);
    });

    it('a plot\'s view of that recording: only what was understood for that plot, with his words from the log that carries them', () => {
        const [rec] = dayRecordings(history, TODAY_KEY, plotLogFilter({ cropId: 'grape', plotId: 'g2' }), mr, CROPS).filter(r => r.voiceLog.id === 't-a');
        expect(rec.view.logIds).toEqual(['t-b']);
        expect(rec.view.transcript).toBe('दोन्ही प्लॉटला पाणी दिलं');
        expect(rec.view.entries.map(e => e.value)).toEqual(['3 तास']);
        expect(recordingOfLog(dayRecordings(history, TODAY_KEY, anyLog, mr, CROPS), 't-b')?.voiceLog.id).toBe('t-a');
    });

    it('confirmed only when every log of the recording is', () => {
        const ok = { verification: { required: true, status: LogVerificationStatus.VERIFIED } } as Partial<DailyLog>;
        const recs = dayRecordings([{ ...twoA, ...ok }, twoB], TODAY_KEY, anyLog, mr, CROPS);
        expect(recs[0].view.confirmed).toBe(false);
        expect(dayRecordings([{ ...twoA, ...ok }, { ...twoB, ...ok }], TODAY_KEY, anyLog, mr, CROPS)[0].view.confirmed).toBe(true);
    });
});

describe('never summed across recordings (P4)', () => {
    const first = said('r1', at('03:00'), ME, { labour: [{ id: 'l1', type: 'HIRED', count: 2, totalCost: 400 }] });
    const second = said('r2', at('08:00'), 'op-sunil', { labour: [{ id: 'l2', type: 'HIRED', count: 3, totalCost: 600 }] });

    it('each recording keeps its own headcount and its own money; the day lists both, never 5 जण or ₹1000', () => {
        const recs = dayRecordings([first, second], TODAY_KEY, plotLogFilter({ cropId: 'grape', plotId: 'g1' }), mr, CROPS);
        const { byPart, byLog } = dayPartsOf(recs);
        expect(byPart.labour.map(e => e.value)).toEqual(['3 जण', '2 जण']); // newest first, each as said
        expect(byPart.expense.map(e => e.value)).toEqual(['मजूर · ₹600', 'मजूर · ₹400']);
        const all = JSON.stringify(recs.map(r => r.view.entries));
        expect(all).not.toContain('5 जण');
        expect(all).not.toContain('1000');
        // every entry stays tied to the recording (time and speaker) it came from
        expect(byLog.get('r2')?.who.name).toBe('सुनील');
    });
});

describe('an older record kept only as task lines (lane F1 legacyPartial) invents nothing', () => {
    // what `detailsFromTasks` makes of "Irrigation" (with the phone's English task note), "Spray इथरेल" and "Spraying"
    const legacy = said('old', at('04:00'), 'op-sunil', {
        legacyPartial: true,
        irrigation: [{ id: 'w', notes: 'Method: Drip | Duration: 2 hrs' }],
        inputs: [{ id: 'i', mix: [{ id: 'mix_i', productName: 'इथरेल' }], productName: 'इथरेल' }],
        cropActivities: [{ id: 'c', title: 'Spraying', workTypes: ['Spraying'] }],
    } as Partial<DailyLog>);

    it('says it is an older record; water mentioned is water mentioned — never a stoppage; no number, no rupee, no English', () => {
        const [rec] = dayRecordings([legacy], TODAY_KEY, anyLog, mr, CROPS);
        expect(rec.view.legacyPartial).toBe(true);
        expect(rec.view.blockers).toEqual([]);
        expect(rec.view.entries.map(e => [e.part, e.value])).toEqual([['crop', null], ['irrigation', null], ['inputs', 'इथरेल']]);
        const shown = JSON.stringify(rec.view.entries.map(e => e.value));
        for (const invented of ['₹', 'तास', 'लिटर', 'Drip', 'Spray']) expect(shown).not.toContain(invented);
    });

    it('a record the server holds in full is not touched by that rule', () => {
        const full = { ...legacy, legacyPartial: false } as DailyLog;
        const [rec] = dayRecordings([full], TODAY_KEY, anyLog, mr, CROPS);
        expect(rec.view.legacyPartial).toBe(false);
        expect(rec.view.blockers.length).toBe(1); // the result model's own reading, unchanged for a full record
    });
});

describe('withMoneyShown — money he may not see is "—"', () => {
    const someoneElse = said('s', at('05:00'), 'op-sunil', { labour: [{ id: 'l', type: 'HIRED', count: 2, totalCost: 900 }] });
    const mine = said('me', at('06:00'), ME, { labour: [{ id: 'l2', type: 'HIRED', count: 1, totalCost: 300 }] });
    const recs = dayRecordings([someoneElse, mine], TODAY_KEY, anyLog, mr, CROPS);

    it('another person\'s amount becomes "—" (the part stays: money was said); the headcount stays', () => {
        const hidden = withMoneyShown(recs[0], false);
        expect(hidden.view.entries.find(e => e.part === 'expense')).toMatchObject({ value: HIDDEN_MONEY, quote: undefined });
        expect(hidden.view.entries.find(e => e.part === 'labour')?.value).toBe('2 जण');
        expect(JSON.stringify(hidden.view.entries)).not.toContain('900');
    });

    it('his own recording keeps it (he said it); money he may see is untouched', () => {
        expect(withMoneyShown(recs[1], false).view.entries.find(e => e.part === 'expense')?.value).toBe('मजूर · ₹300');
        expect(withMoneyShown(recs[0], true)).toBe(recs[0]);
    });
});

describe('listenModel — ▶ only where it may be offered', () => {
    const viewer = (over: Partial<Viewer> = {}): Viewer => ({ youIds: new Set([ME]), farmRole: 'Worker', farmId: 'farm-1', ...over });
    const recOf = (l: DailyLog): DayRecording => dayRecordings([l], TODAY_KEY, anyLog, mr, CROPS)[0];
    const spoken = (extra: Partial<DailyLog>) => said('v', at('05:00'), 'op-sunil', { fullTranscript: 'पाणी दिलं', ...extra });

    it('a typed entry has nothing to hear', () => {
        const typed = recOf(spoken({ typedEntry: true }));
        expect(listenKind(typed, true, viewer({ farmRole: 'PrimaryOwner' }))).toBe('none');
    });

    it('the clip on this phone plays here', () => {
        expect(listenKind(recOf(spoken({})), true, viewer())).toBe('clip');
    });

    it('a record the server sent in full: ▶ exactly when the server sent its words (its one rule for both)', () => {
        expect(serverMayPlay(spoken({ legacyPartial: false }), viewer())).toBe(true);
        expect(serverMayPlay(spoken({ legacyPartial: false, fullTranscript: undefined }), viewer({ farmRole: 'PrimaryOwner' }))).toBe(false);
    });

    it('any other record: the speaker himself or the primary owner the server named — never assumed for anyone else', () => {
        expect(serverMayPlay(spoken({ legacyPartial: true }), viewer())).toBe(false); // a worker, someone else's record
        expect(listenKind(recOf(spoken({ legacyPartial: true })), false, viewer())).toBe('none');
        expect(serverMayPlay(spoken({ legacyPartial: true }), viewer({ farmRole: 'PrimaryOwner' }))).toBe(true);
        expect(serverMayPlay(spoken({ meta: { createdAtISO: at('05:00'), createdByOperatorId: ME } }), viewer())).toBe(true);
        expect(serverMayPlay(spoken({ legacyPartial: true }), viewer({ farmRole: null }))).toBe(false); // role not told yet
    });

    it('no farm to ask → nothing offered', () => {
        expect(serverMayPlay(spoken({ legacyPartial: false }), viewer({ farmId: null }))).toBe(false);
    });
});
