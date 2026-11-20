/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RWF, founder 2026-11-20: "each part must be flagged" and "how Shram Safal understood the
 * input too"). The REAL log of 2026-11-20 6:58 pm: the parser wrote the two sprays' phrases WITH a gap ("कराटे 250 ml ... फवारलं"), so they could never be found
 * word for word and the sprays were never coloured; and the six people's words sit inside the soil work's words, so only one of the two was flagged.
 * Now: each fragment of a gap phrase is found in order and marked, a stretch that made Sathi understand two parts carries both, and nothing unverified is marked (P4).
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../domain/types/log.types';
import { markTranscript, partEntriesOf, phraseSpans, phrasesByPart, verifiedParts } from '../resultModel';

const SAID = 'आज कराटे 250 ml आणि Confidor 100 ml 200 L पाण्यात फवारलं सहा जण आली होती त्यांनी माती लावून घेतली';

const realLog = (): DailyLog => ({
    id: 'log-now', date: '2026-11-20', fullTranscript: SAID,
    cropActivities: [{ id: 'c2', title: 'माती लावणे', workTypes: ['Tying'], sourceText: 'सहा जण आली होती त्यांनी माती लावून घेतली', provenanceVerified: true }],
    labour: [{ id: 'lb2', count: 6, sourceText: 'सहा जण आली होती', provenanceVerified: true }],
    inputs: [
        { id: 'n1', mix: [], type: 'pesticide', unit: 'ml', method: 'Spray', quantity: 250, sourceText: 'कराटे 250 ml ... फवारलं', productName: 'Karate', rawProductName: 'कराटे', provenanceVerified: true },
        { id: 'n2', mix: [], type: 'pesticide', unit: 'ml', method: 'Spray', quantity: 100, sourceText: 'Confidor 100 ml ... फवारलं', productName: 'Confidor', rawProductName: 'Confidor', provenanceVerified: true },
    ],
    irrigation: [], machinery: [],
}) as unknown as DailyLog;

describe('a phrase the parser wrote with a gap', () => {
    it('EachFragmentIsFoundInOrder_AsHisOwnWords', () => {
        expect(verifiedParts({ sourceText: 'कराटे 250 ml ... फवारलं', provenanceVerified: true }, SAID)).toEqual(['कराटे 250 ml', 'फवारलं']);
        expect(verifiedParts({ sourceText: 'Confidor 100 ml … फवारलं', provenanceVerified: true }, SAID)).toEqual(['Confidor 100 ml', 'फवारलं']);
    });

    it('AFragmentThatIsMissing_OrOutOfOrder_MeansNothingIsMarked', () => {
        expect(phraseSpans(SAID, 'कराटे 250 ml ... पावसात')).toBeNull();
        expect(phraseSpans(SAID, 'फवारलं ... कराटे 250 ml')).toBeNull();
        expect(verifiedParts({ sourceText: 'कराटे 250 ml ... फवारलं', provenanceVerified: false }, SAID)).toBeUndefined();
    });

    it('APhraseWithNoGap_IsOneSpan_AsBefore', () => {
        expect(verifiedParts({ sourceText: 'सहा जण आली होती', provenanceVerified: true }, SAID)).toEqual(['सहा जण आली होती']);
        expect(phraseSpans(SAID, '')).toBeNull();
    });
});

describe('the entries of the real log', () => {
    it('TheSpraysCarryTheirWordsInPieces_AndTheOtherPartsKeepOnePhrase', () => {
        const entries = partEntriesOf(realLog(), 'mr', true);
        const sprays = entries.filter(e => e.part === 'inputs');
        expect(sprays.map(e => e.quote)).toEqual(['कराटे 250 ml … फवारलं', 'Confidor 100 ml … फवारलं']);
        expect(sprays.map(e => e.quoteParts)).toEqual([['कराटे 250 ml', 'फवारलं'], ['Confidor 100 ml', 'फवारलं']]);
        expect(entries.find(e => e.part === 'labour')?.quoteParts).toBeUndefined();
        expect(entries.find(e => e.part === 'crop')?.quote).toBe('सहा जण आली होती त्यांनी माती लावून घेतली');
    });
});

describe('his words, marked', () => {
    const runs = () => markTranscript(SAID, partEntriesOf(realLog(), 'mr', true));
    const marked = () => runs().filter(r => r.part).map(r => [r.text.trim(), r.part, ...(r.also ?? [])]);

    it('EverySprayPieceIsColoured_AndTheSharedWordIsMarkedOnce', () => {
        expect(marked()).toEqual([
            ['कराटे 250 ml', 'inputs'],
            ['Confidor 100 ml', 'inputs'],
            ['फवारलं', 'inputs'],
            ['सहा जण आली होती', 'crop', 'labour'],
            ['त्यांनी माती लावून घेतली', 'crop'],
        ]);
    });

    it('WordsThatMadeTwoPartsAreFlaggedForBoth_NotOnlyTheFirst', () => {
        const both = runs().find(r => r.text.trim() === 'सहा जण आली होती');
        expect(both?.part).toBe('crop');
        expect(both?.also).toEqual(['labour']);
        expect(phrasesByPart(runs()).map(g => g.part).sort()).toEqual(['crop', 'inputs', 'labour']);
    });

    it('WhatWasNotPlaced_StaysPlain_TheWaterHeSaidIsNotColoured', () => {
        const plain = runs().filter(r => !r.part).map(r => r.text).join('|');
        expect(plain).toContain('200 L पाण्यात');
        expect(plain).toContain('आज');
        expect(plain).toContain('आणि');
    });

    it('TheRunsAlwaysAddUpToHisExactWords', () => {
        expect(runs().map(r => r.text).join('')).toBe(SAID);
    });

    it('TwoPartsWithTheSameOneWord_BothAreFlagged', () => {
        const log = {
            id: 'l', date: '2026-11-20', fullTranscript: 'कराटे',
            cropActivities: [{ id: 'c', title: 'फवारणी', workTypes: ['Spraying'], sourceText: 'कराटे', provenanceVerified: true }],
            inputs: [{ id: 'i', mix: [], type: 'pesticide', method: 'Spray', sourceText: 'कराटे', productName: 'Karate', provenanceVerified: true }],
            labour: [], irrigation: [], machinery: [],
        } as unknown as DailyLog;
        const r = markTranscript('कराटे', partEntriesOf(log, 'mr', true));
        expect(r).toEqual([{ text: 'कराटे', part: 'crop', also: ['inputs'] }]);
    });

    it('APhraseThatIsNotInHisWords_IsNeverMarked', () => {
        const log = { ...realLog(), cropActivities: [{ id: 'c2', title: 'माती लावणे', sourceText: 'दहा जण आले', provenanceVerified: true }] } as unknown as DailyLog;
        expect(markTranscript(SAID, partEntriesOf(log, 'mr', true)).some(r => r.part === 'crop' && !r.also)).toBe(false);
    });
});
