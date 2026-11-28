/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B3) — one talk read as the saved screen reads a day: its own parts
 * only, products first; "missing" is never worked out per talk (only the day's, passed in); and the round initial of a speaker.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { buildDayView, type WhoDeps } from '../../voiceResult/resultModel';
import { logsOfTalk, partsOfTalk, talkDayOf } from '../talkDay';
import { initialOf } from '../TalkList';

const deps: WhoDeps = { youIds: new Set(['me']), nameOf: () => undefined, ownName: 'सुनील', unknownLabel: 'अज्ञात', language: 'mr', nativeDigits: true };
const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: '2026-10-26', dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: 'me' },
    ...over,
}) as unknown as DailyLog;

const NOW = log('N', {
    fullTranscript: 'दहा मजूर आले, कॉन्फिडॉर फवारलं',
    labour: [{ id: 'lab', count: 10, sourceText: 'दहा मजूर आले' }],
    inputs: [{ id: 'ev', method: 'Spray', sourceText: 'कॉन्फिडॉर फवारलं', mix: [{ id: 'm', productName: 'कॉन्फिडॉर', dose: 50, unit: 'ml' }] }],
});
const EARLY = log('E', {
    fullTranscript: 'छाटणी केली', cropActivities: [{ id: 'c', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    meta: { createdAtISO: '2026-10-26T04:00:00.000Z', createdByOperatorId: 'me' },
});

describe('talkDayOf', () => {
    const day = buildDayView([NOW], [NOW, EARLY], deps);

    it('holds only THAT talk\'s parts (an earlier talk\'s work is not in it)', () => {
        const talk = talkDayOf(day.current, [NOW], day.missing);
        expect(talk.byPart.labour.map(e => e.logId)).toEqual(['N']);
        expect(talk.byPart.crop).toEqual([]);
        expect(talk.earlier).toEqual([]);
        const early = talkDayOf(day.earlier, [EARLY]);
        expect(early.byPart.crop.map(e => e.value)).toEqual(['छाटणी']);
        expect(early.byPart.labour).toEqual([]);
    });

    it('missing is the day\'s, passed in, never worked out per talk: a part an earlier talk told is not missing', () => {
        const talk = talkDayOf(day.current, [NOW], day.missing);
        expect(day.missing).not.toContain('crop');
        expect(talk.missing).not.toContain('crop');
        expect(talk.missing).toContain('machinery');
        expect(talkDayOf(day.earlier, [EARLY]).missing).toEqual([]);
    });

    it('partsOfTalk: products first, then the parts\' own order', () => {
        expect(partsOfTalk(day.current)).toEqual(['inputs', 'labour']);
        expect(partsOfTalk(day.earlier)).toEqual(['crop']);
    });

    it('logsOfTalk: each recording\'s logs as the phone holds them, else its own log', () => {
        expect(logsOfTalk(day.current, () => undefined).map(l => l.id)).toEqual(['N']);
        expect(logsOfTalk(day.current, id => (id === 'N' ? NOW : undefined))).toEqual([NOW]);
    });
});

describe('initialOf', () => {
    it('the first letter as it is written, with its vowel sign and conjunct', () => {
        expect(initialOf('रामू पाटील')).toBe('रा');
        expect(initialOf('सुनीता')).toBe('सु');
        expect(initialOf('क्षितिज')).toBe('क्षि');
        expect(initialOf('Ramesh')).toBe('R');
        expect(initialOf('  ')).toBe('');
    });
});
