// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE result screen's view model, on real
 * `DailyLog` shapes. What is pinned here is the CONTENT rules the founder set (PLR-D1 rounds 2-5, doctrine P4):
 * his words are marked only with VERIFIED phrases, a part he did not mention is "missing" (never a 0), the day
 * is the plot's whole day with earlier recordings newest first, nothing is summed, and no English label from
 * the parser reaches his screen.
 */
import { describe, expect, it } from 'vitest';
import { LogVerificationStatus, type DailyLog } from '../../../../../types';
import {
    PARTS, PART_OF_NODE, blockerOf, blockersOf, buildDayView, markTranscript, partEntriesOf, phrasesByPart, recordingKeyOf, ringNodesForDay,
    sameDayLogs, verifiedPhrase, whoSpoke, type PartKey, type WhoDeps,
} from '../resultModel';

const DATE = '2026-10-26';
const P1 = 'plot-1';

const log = (id: string, over: Record<string, unknown> = {}): DailyLog => ({
    id,
    date: DATE,
    dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: [P1], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T04:00:00.000Z', createdByOperatorId: 'op-me' },
    ...over,
}) as unknown as DailyLog;

const deps: WhoDeps = {
    youIds: new Set(['op-me']),
    nameOf: id => (id === 'op-ramesh' ? 'रमेश' : undefined),
    youLabel: 'तुम्ही',
    unknownLabel: 'अज्ञात',
};

describe('verifiedPhrase — only his own, checked words', () => {
    const said = 'आज दहा मजूर आले आणि छाटणी केली';

    it('a verified phrase that is really in his words is used', () => {
        expect(verifiedPhrase({ sourceText: 'दहा मजूर आले' }, said)).toBe('दहा मजूर आले');
        expect(verifiedPhrase({ sourceText: ' छाटणी केली ', provenanceVerified: true }, said)).toBe('छाटणी केली');
    });

    it('a phrase the server could NOT verify is never shown', () => {
        expect(verifiedPhrase({ sourceText: 'दहा मजूर आले', provenanceVerified: false }, said)).toBeUndefined();
    });

    it('a phrase that is not word-for-word in his transcript is never shown (no invented quote)', () => {
        expect(verifiedPhrase({ sourceText: 'बारा मजूर आले' }, said)).toBeUndefined();
        expect(verifiedPhrase({ sourceText: 'दहा मजूर आले' }, undefined)).toBeUndefined();
        expect(verifiedPhrase({}, said)).toBeUndefined();
    });
});

describe('partEntriesOf — what was understood, as recorded, in Marathi only', () => {
    it('reads every part of a log, in the parts\' order, each tied to its log', () => {
        const l = log('L1', {
            fullTranscript: 'छाटणी केली, दहा मजूर, दोन तास पाणी',
            plannedTasks: [{ id: 't1', title: 'उद्या फवारणी' }],
            labour: [{ id: 'lab1', count: 10, sourceText: 'दहा मजूर' }],
            irrigation: [{ id: 'irr1', durationHours: 2, sourceText: 'दोन तास पाणी' }],
            cropActivities: [{ id: 'a1', title: 'छाटणी', sourceText: 'छाटणी केली' }],
            activityExpenses: [{ id: 'e1', reason: 'डिझेल', totalAmount: 500 }],
        });
        const entries = partEntriesOf(l);
        expect(entries.map(e => e.part)).toEqual(['crop', 'labour', 'irrigation', 'expense', 'planned']);
        expect(entries.every(e => e.logId === 'L1')).toBe(true);
        expect(entries.find(e => e.part === 'labour')).toMatchObject({ value: '10 जण', quote: 'दहा मजूर' });
        expect(entries.find(e => e.part === 'irrigation')).toMatchObject({ value: '2 तास', quote: 'दोन तास पाणी' });
        expect(entries.find(e => e.part === 'expense')?.value).toBe('डिझेल · ₹500');
    });

    it('a labour entry with no number stated shows no number (unknown is never 0)', () => {
        const [entry] = partEntriesOf(log('L1', { labour: [{ id: 'lab1', type: 'HIRED' }] }));
        expect(entry.part).toBe('labour');
        expect(entry.value).toBeNull();
        expect(JSON.stringify(entry)).not.toMatch(/\b0\b/);
    });

    it('an English label written by the parser is NOT shown: his verified phrase stands in, else nothing', () => {
        const l = log('L1', {
            fullTranscript: 'आज छाटणी केली',
            cropActivities: [
                { id: 'a1', title: 'Pruning', sourceText: 'छाटणी केली' },
                { id: 'a2', title: 'Weeding' },
            ],
            inputs: [{ id: 'i1', productName: 'Bavistin' }],
        });
        const entries = partEntriesOf(l);
        expect(entries.find(e => e.id === 'a1')?.value).toBe('छाटणी केली');
        expect(entries.find(e => e.id === 'a2')?.value).toBeNull();
        expect(entries.find(e => e.id === 'i1')?.value).toBeNull();
        expect(entries.map(e => e.value ?? '').join(' ')).not.toMatch(/[A-Za-z]/);
    });
});

describe('his words, colour-marked ONLY from verified phrases', () => {
    const said = 'आज दहा मजूर आले, दोन तास पाणी दिलं';

    it('marks each verified phrase with its part; an unverified one stays plain text', () => {
        const l = log('L1', {
            fullTranscript: said,
            labour: [{ id: 'lab1', count: 10, sourceText: 'दहा मजूर' }],
            irrigation: [{ id: 'irr1', durationHours: 2, sourceText: 'दोन तास पाणी', provenanceVerified: false }],
        });
        const runs = markTranscript(said, partEntriesOf(l));
        expect(runs.map(r => r.text).join('')).toBe(said); // nothing dropped, nothing added
        expect(runs.filter(r => r.part)).toEqual([{ text: 'दहा मजूर', part: 'labour' }]);
        expect(phrasesByPart(runs)).toEqual([{ part: 'labour', phrases: ['दहा मजूर'] }]);
    });

    it('no transcript, no marks', () => {
        expect(markTranscript('', partEntriesOf(log('L1', { labour: [{ id: 'x', count: 2, sourceText: 'दोन' }] })))).toEqual([]);
    });
});

describe('buildDayView — the plot\'s WHOLE day', () => {
    const now = log('NOW', {
        fullTranscript: 'दोन तास पाणी दिलं',
        irrigation: [{ id: 'irr-now', durationHours: 2, sourceText: 'दोन तास पाणी' }],
        meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: 'op-me' },
    });
    const morning = log('MORNING', {
        labour: [{ id: 'lab-m', count: 10 }],
        meta: { createdAtISO: '2026-10-26T03:00:00.000Z', createdByOperatorId: 'op-ramesh' },
        verification: { status: LogVerificationStatus.VERIFIED, required: true },
    });
    const noon = log('NOON', {
        labour: [{ id: 'lab-n', count: 2 }],
        meta: { createdAtISO: '2026-10-26T06:30:00.000Z', createdByOperatorId: 'op-me' },
    });
    const otherPlot = log('OTHER', {
        context: { selection: [{ cropId: 'c1', selectedPlotIds: ['plot-2'] }] },
        labour: [{ id: 'lab-o', count: 7 }],
    });
    const yesterday = log('YDAY', { date: '2026-10-25', labour: [{ id: 'lab-y', count: 5 }] });
    const deleted = log('DEL', { deletion: { deletedAtISO: 'x' }, labour: [{ id: 'lab-d', count: 9 }] });
    const history = [now, morning, noon, otherPlot, yesterday, deleted];

    it('lists only today\'s recordings of the same plot, earlier ones NEWEST FIRST, never the one just made', () => {
        const day = buildDayView([now], history, deps);
        expect(day.current.map(r => r.id)).toEqual(['NOW']);
        expect(day.earlier.map(r => r.id)).toEqual(['NOON', 'MORNING']);
        expect(sameDayLogs([now], history).map(l => l.id).sort()).toEqual(['MORNING', 'NOON', 'NOW']);
    });

    it('nothing is summed: two labour statements stay two entries, each tied to its own recording', () => {
        const day = buildDayView([now], history, deps);
        expect(day.byPart.labour.map(e => [e.logId, e.value])).toEqual([['NOON', '2 जण'], ['MORNING', '10 जण']]);
        expect(JSON.stringify(day)).not.toContain('12 जण');
    });

    it('a part the day does not mention is MISSING — listed by name, never given a 0', () => {
        const day = buildDayView([now], history, deps);
        expect(day.missing).toEqual(['crop', 'inputs', 'expense', 'machinery', 'observation', 'planned']);
        expect(day.missing).not.toContain('labour');
        expect(day.missing).not.toContain('irrigation');
        for (const key of day.missing) expect(day.byPart[key]).toEqual([]);
        expect(PARTS).toHaveLength(8);
    });

    it('what THIS recording added is known apart from the rest of the day', () => {
        const day = buildDayView([now], history, deps);
        expect([...day.touchedNow]).toEqual(['irrigation']);
    });

    it('each recording names who spoke it: "तुम्ही" for this phone\'s person, else the author\'s name', () => {
        const day = buildDayView([now], history, deps);
        expect(day.current[0].who).toEqual({ name: 'तुम्ही', you: true });
        expect(day.earlier.find(r => r.id === 'MORNING')?.who).toEqual({ name: 'रमेश', you: false });
        expect(whoSpoke(log('X', { meta: { createdAtISO: DATE, createdByOperatorId: 'op-stranger' } }), deps)).toEqual({ name: 'अज्ञात', you: false });
        expect(day.speakers).toEqual([{ name: 'रमेश', you: false, times: 1 }, { name: 'तुम्ही', you: true, times: 2 }]);
    });

    it('confirmed / not confirmed comes from the log\'s own verification', () => {
        const day = buildDayView([now], history, deps);
        expect(day.earlier.find(r => r.id === 'MORNING')?.confirmed).toBe(true);
        expect(day.earlier.find(r => r.id === 'NOON')?.confirmed).toBe(false);
    });
});

describe('ringNodesForDay — nothing on the ring stays grey', () => {
    it('every orb is told or missed (the red X), never neutral', () => {
        const nodes = ringNodesForDay([log('L1', { irrigation: [{ id: 'i', durationHours: 1 }] })], DATE);
        expect(nodes.length).toBeGreaterThan(0);
        expect(nodes.some(n => n.state === 'missed')).toBe(true);
        expect(nodes.every(n => n.state !== 'neutral')).toBe(true);
    });
});

describe('round 2 — numbers as he said them, nothing invented', () => {
    it('labour with no total but a split shows the split as he said it, never a sum the app made', () => {
        const [split] = partEntriesOf(log('L1', { labour: [{ id: 'l', maleCount: 3, femaleCount: 2 }] }));
        expect(split.value).toBe('3 पुरुष · 2 महिला');
        expect(split.value).not.toContain('5');
        // "५ बायका": the parser sets count 5 AND femaleCount 5 — the same five people. The split says who they were.
        const [women] = partEntriesOf(log('L2', { labour: [{ id: 'l', count: 5, femaleCount: 5 }] }));
        expect(women.value).toBe('5 महिला');
    });

    it('labour headcount by the app\'s own rule: a total counts only above 0, else the split (round 3)', () => {
        const value = (labour: Record<string, unknown>) => partEntriesOf(log('L', { labour: [{ id: 'l', ...labour }] }))[0].value;
        expect(value({ count: 0, maleCount: 3, femaleCount: 2 })).toBe('3 पुरुष · 2 महिला'); // never "0 जण" for a job workers did
        expect(value({ count: 4 })).toBe('4 जण');
        expect(value({ count: 6, maleCount: 3 })).toBe('6 जण · 3 पुरुष'); // a total beside a part of it: both, as said
        expect(value({ type: 'HIRED' })).toBeNull(); // silence is not 0
    });

    it('F23 (lane AI-1): a labour count of 0 is never "0 जण" — it reads as silence: the task, else his words', () => {
        const value = (labour: Record<string, unknown>, extra: Partial<DailyLog> = {}) =>
            partEntriesOf(log('L', { ...extra, labour: [{ id: 'l', ...labour }] }))[0].value;
        expect(value({ count: 0 })).toBeNull();
        expect(value({ count: 0, maleCount: 0, femaleCount: 0 })).toBeNull();
        expect(value({ count: 0, activity: 'छाटणी' })).toBe('छाटणी');
        // His own words stand for it when he said them (an older record that still carries the 0).
        const words = value({ count: 0, sourceText: 'आज कोणी आलं नाही' }, { fullTranscript: 'आज कोणी आलं नाही' });
        expect(words).toBe('आज कोणी आलं नाही');
        for (const v of [value({ count: 0 }), words]) expect(v ?? '').not.toMatch(/(^|\s)[0०]\s*जण/);
    });

    it('F22 (lane AI-1): 5 women and 2 men read as women 5 · men 2, never a total the app made', () => {
        const value = (labour: Record<string, unknown>) => partEntriesOf(log('L', { labour: [{ id: 'l', ...labour }] }))[0].value;
        // The guard's one-row shape (no total said) and its two-row shape.
        expect(value({ femaleCount: 5, maleCount: 2, gender: 'mixed' })).toBe('2 पुरुष · 5 महिला');
        expect(value({ count: 5, femaleCount: 5, gender: 'female' })).toBe('5 महिला');
        expect(value({ count: 2, maleCount: 2, gender: 'male' })).toBe('2 पुरुष');
        expect(value({ femaleCount: 5, maleCount: 2 })).not.toContain('7');
    });

    it('an expense with no amount stated (0) shows no "₹0"', () => {
        const [e] = partEntriesOf(log('L1', { activityExpenses: [{ id: 'e', reason: 'डिझेल', totalAmount: 0 }] }));
        expect(e.value).toBe('डिझेल');
        expect(e.value).not.toContain('₹');
    });
});

describe('round 2 — an item the server could not verify', () => {
    it('is marked verified:false and does NOT make its part told (the ring\'s own rule)', () => {
        const now = log('NOW', {
            fullTranscript: 'चार मजूर आले',
            labour: [{ id: 'lab', count: 4, sourceText: 'चार मजूर आले', provenanceVerified: false }],
        });
        const [entry] = partEntriesOf(now);
        expect(entry).toMatchObject({ part: 'labour', value: '4 जण', verified: false, quote: undefined });
        const day = buildDayView([now], [now], deps);
        // Not told — but he said it: "not sure", never "not said" (round 3).
        expect(day.unsure).toEqual(['labour']);
        expect(day.missing).not.toContain('labour');
        expect(day.byPart.labour).toHaveLength(1); // still listed (flagged), never dropped
    });

    it('a part with one verified item is told even beside an unverified one', () => {
        const now = log('NOW', { labour: [{ id: 'a', count: 4, provenanceVerified: false }, { id: 'b', count: 2 }] });
        expect(buildDayView([now], [now], deps).missing).not.toContain('labour');
    });
});

describe('round 2 — a stoppage, a typed entry, the farm, the recording', () => {
    it('a stoppage he reported is understood as said ("पाऊस आला"), with his verified phrase', () => {
        const l = log('L1', {
            fullTranscript: 'पाऊस आला, काम झालं नाही',
            disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'Rain', note: 'पाऊस आला', blockedSegments: [], sourceText: 'पाऊस आला' },
        });
        expect(blockerOf(l)).toEqual({ id: 'L1:blocker', logId: 'L1', value: 'पाऊस आला', quote: 'पाऊस आला', verified: true });
        expect(blockerOf(log('L2'))).toBeNull();
        expect(buildDayView([l], [l], deps).blockersNow).toHaveLength(1);
    });

    it('a log filled in by hand is "typed"; a voice log or one with no claim is not', () => {
        const typed = log('T', { meta: { createdAtISO: '2026-10-26T01:00:00.000Z', provenance: { source: 'manual', timestamp: 'x' } } });
        const spoken = log('S', { meta: { createdAtISO: '2026-10-26T02:00:00.000Z', provenance: { source: 'ai', timestamp: 'x' } } });
        const day = buildDayView([log('NOW', { meta: { createdAtISO: '2026-10-26T09:00:00.000Z' } })], [typed, spoken], deps);
        expect(day.earlier.map(r => [r.id, r.typed])).toEqual([['S', false], ['T', true]]);
    });

    it('another farm\'s whole-farm records of the same day are not this farm\'s day (when both farms are known)', () => {
        const whole = (id: string, farmId?: string) => log(id, { context: { selection: [{ cropId: 'FARM_GLOBAL', selectedPlotIds: [] }] }, meta: { createdAtISO: '2026-10-26T01:00:00.000Z', farmId } });
        const now = whole('NOW', 'farm-a');
        const ids = sameDayLogs([now], [now, whole('SAME', 'farm-a'), whole('OTHER', 'farm-b'), whole('UNKNOWN')]).map(l => l.id);
        expect(ids).toEqual(['NOW', 'SAME', 'UNKNOWN']); // an unrecorded farm is never guessed away
    });

    it('logs of one save share a recording key; another moment, speaker or parse is another recording', () => {
        const at = '2026-10-26T03:00:00.000Z';
        const a = log('A', { meta: { createdAtISO: at, createdByOperatorId: 'op', provenance: { source: 'ai', sourceAiJobId: 'job-1', timestamp: at } } });
        const b = log('B', { meta: { createdAtISO: at, createdByOperatorId: 'op', provenance: { source: 'ai', sourceAiJobId: 'job-1', timestamp: at } } });
        const c = log('C', { meta: { createdAtISO: at, createdByOperatorId: 'op', provenance: { source: 'ai', sourceAiJobId: 'job-2', timestamp: at } } });
        expect(recordingKeyOf(a)).toBe(recordingKeyOf(b));
        expect(recordingKeyOf(a)).not.toBe(recordingKeyOf(c));
        expect(recordingKeyOf(log('D', { meta: undefined }))).toBe('log:D');
    });
});

describe('round 3 — ONE rule for the ring and the eight parts (I13-V2-M1)', () => {
    /** The parts the RING says were told (its own coverage rules, the same call the screen makes). */
    const ringTold = (logs: DailyLog[]): Set<PartKey> => new Set(ringNodesForDay(logs, DATE)
        .filter(n => n.state === 'told').map(n => PART_OF_NODE[n.id]).filter((p): p is PartKey => !!p));
    const gridTold = (l: DailyLog): Set<PartKey> => {
        const day = buildDayView([l], [l], deps);
        return new Set(PARTS.map(p => p.key).filter(k => !day.missing.includes(k) && !day.unsure.includes(k)));
    };

    const withMoney = log('MONEY', {
        fullTranscript: 'चार मजूर आले, चारशे रुपये रोज, इथरेल पाचशे रुपये',
        labour: [{ id: 'lab', count: 4, wagePerPerson: 400, totalCost: 1600, sourceText: 'चार मजूर आले' }],
        inputs: [{ id: 'inp', productName: 'इथरेल', cost: 500 }],
        machinery: [{ id: 'm', type: 'tractor', hoursUsed: 2, rentalCost: 1200, fuelCost: 300 }],
    });

    it('money he said on labour, a spray or a machine makes खर्च told — and is shown exactly as he said it', () => {
        const day = buildDayView([withMoney], [withMoney], deps);
        expect(day.missing).not.toContain('expense');
        expect(day.unsure).not.toContain('expense');
        expect(day.byPart.expense.map(e => e.value)).toEqual([
            'मजूर · ₹1600 · ₹400 प्रत्येकी', 'इथरेल · ₹500', 'ट्रॅक्टर · भाडे खर्च ₹1200 · इंधन खर्च ₹300',
        ]);
        expect(ringTold([withMoney]).has('expense')).toBe(true); // the ring on the same screen says the same
        // Nothing summed, and the money never marks his words a second time (the labour part already does).
        expect(JSON.stringify(day.byPart.expense)).not.toMatch(/₹(2100|3600|1500|3100)/);
        expect(day.byPart.expense.every(e => e.quote === undefined)).toBe(true);
        expect(markTranscript(withMoney.fullTranscript ?? '', day.current[0].entries).filter(r => r.part).map(r => r.part)).toEqual(['labour']);
    });

    it('water he could NOT give is a stoppage, never "पाणी ✓" (the ring shows the same red X)', () => {
        const l = log('NOWATER', {
            fullTranscript: 'लाईट नव्हती, पाणी देता आले नाही',
            irrigation: [{ id: 'w', method: 'Drip', source: 'विहीर', sourceText: 'पाणी देता आले नाही', issue: { issueType: 'ELECTRICITY', reason: 'लाईट नव्हती', severity: 'HIGH' } }],
        });
        const day = buildDayView([l], [l], deps);
        expect(day.byPart.irrigation).toEqual([]);
        expect(day.missing).toContain('irrigation');
        expect(day.blockersNow.map(b => [b.value, b.quote])).toEqual([['पाणी · लाईट नव्हती', 'पाणी देता आले नाही']]);
        expect(ringTold([l]).has('irrigation')).toBe(false);
    });

    it('a spray tank\'s water belongs to the spray; an "issue" note is a stoppage, not an observation', () => {
        const l = log('SPRAY', {
            irrigation: [{ id: 'carrier', role: 'spray-carrier', waterVolumeLitres: 600 }],
            inputs: [{ id: 'i', productName: 'गंधक' }],
            observations: [{ id: 'o', noteType: 'issue', textRaw: 'घडांवर डाग' }],
        });
        expect(partEntriesOf(l).map(e => e.part)).toEqual(['inputs']);
        expect(blockersOf(l).map(b => b.value)).toEqual(['घडांवर डाग']);
    });

    it('for every kind of day, a part is told on the grid EXACTLY when the ring says so', () => {
        const days = [
            withMoney,
            log('UNSURE', { labour: [{ id: 'u', count: 4, provenanceVerified: false }] }),
            log('CANCELLED', { plannedTasks: [{ id: 't', title: 'उद्या फवारणी', status: 'cancelled' }] }),
            log('TYPEDTOTAL', { manualTotalCost: 2500 }),
            log('MIXED', {
                irrigation: [{ id: 'given', durationHours: 2 }, { id: 'carrier', role: 'spray-carrier', waterVolumeLitres: 600 }],
                observations: [{ id: 'n1', noteType: 'observation', textRaw: 'वाढ चांगली' }, { id: 'n2', noteType: 'issue', textRaw: 'डाग' }, { id: 'n3', noteType: 'reminder', textRaw: 'उद्या पाणी' }],
                activityExpenses: [{ id: 'e', reason: 'डिझेल', totalAmount: 500, provenanceVerified: false }],
            }),
        ];
        for (const l of days) expect([l.id, gridTold(l)]).toEqual([l.id, ringTold([l])]);
        expect(buildDayView([days[3]], [days[3]], deps).byPart.expense.map(e => e.value)).toEqual(['एकूण खर्च ₹2500']);
    });
});

describe('round 4 — a time he can read, a note he said (I13-V3 M1, m3)', () => {
    it('a recording\'s time is in his words; a typed entry\'s midday placeholder is no time at all (never "दुपारी 12:00")', () => {
        const now = log('NOW', { labour: [{ id: 'l', count: 4 }], meta: { createdAtISO: '2026-10-26T05:00:00.000Z', createdByOperatorId: 'op-me' } });
        const typed = log('TYPED', {
            labour: [{ id: 'lt', count: 2 }],
            meta: { createdAtISO: '2026-10-26T12:00:00', createdByOperatorId: 'op-me', provenance: { source: 'manual' } },
        });
        const day = buildDayView([now], [now, typed], deps);
        expect(day.current[0].timeLabel).toBe('सकाळी 10:30');
        expect(day.earlier.map(r => [r.id, r.timeLabel])).toEqual([['TYPED', '']]);
    });

    it('a free note on the work or the water is shown with it when it is Marathi; an English note is not', () => {
        const l = log('NOTES', {
            cropActivities: [{ id: 'a', title: 'फवारणी', notes: 'दोन ओळी राहिल्या' }, { id: 'b', title: 'छाटणी', notes: 'Done after rain' }],
            irrigation: [{ id: 'w', durationHours: 2, notes: 'ठिबकची नळी फुटली' }],
        });
        expect(partEntriesOf(l).map(e => e.value)).toEqual(['फवारणी · दोन ओळी राहिल्या', 'छाटणी', '2 तास · ठिबकची नळी फुटली']);
    });
});

describe('F63 (lane AI-1) — an older record kept only as task lines invents no stoppage on the result screen', () => {
    // What lane F1's `detailsFromTasks` makes of a pre-F1 "Irrigation" task line: no method, no hours, no reason.
    const old = log('OLD', {
        legacyPartial: true,
        meta: { createdAtISO: '2026-10-26T02:00:00.000Z', createdByOperatorId: 'op-me' },
        irrigation: [{ id: 'w', notes: 'Method: Drip | Duration: 2 hrs' }],
    });
    const now = log('NOW', { cropActivities: [{ id: 'a', title: 'छाटणी' }] });

    it('its water is "mentioned, no value" — the same rule आढावा reads — never "अडथळे: पाणी"', () => {
        const [earlier] = buildDayView([now], [now, old], deps).earlier;
        expect(earlier.id).toBe('OLD');
        expect(earlier.blockers).toEqual([]);
        expect(earlier.entries.map(e => [e.part, e.value])).toEqual([['irrigation', null]]);
    });

    it('the same water on a full record is still the stoppage it reports', () => {
        const full = { ...old, legacyPartial: false } as DailyLog;
        const [earlier] = buildDayView([now], [now, full], deps).earlier;
        expect(earlier.blockers.map(b => b.id)).toEqual(['w:stopped']);
    });
});
