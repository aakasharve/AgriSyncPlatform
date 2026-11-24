/** spec: voice-flow-v2-2026-11-23 — the v2 words are complete twins, one language at a time. */
import { describe, expect, it } from 'vitest';
import { VOICE_FLOW_EN, VOICE_FLOW_MR, voiceFlowWords } from '../voiceFlowWords';

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

// `placeSub` takes the plot names (a plot named "7" keeps both language checks about the words themselves).
const strings = (w: object): string[] => Object.entries(w).flatMap(([k, v]) =>
    typeof v === 'string' ? [v]
        : typeof v === 'function' ? [String(k === 'placeSub' ? (v as (p: string[]) => string)(['7']) : (v as (a: number, b?: number) => string)(7, 8))]
            : Array.isArray(v) ? v.flatMap(p => [p.q, p.ex]) : []);

describe('voiceFlowWords', () => {
    it('Marathi and English carry the same keys', () => {
        expect(Object.keys(VOICE_FLOW_MR).sort()).toEqual(Object.keys(VOICE_FLOW_EN).sort());
        expect(VOICE_FLOW_MR.prompts).toHaveLength(VOICE_FLOW_EN.prompts.length);
    });
    it('every Marathi line is Devanagari, with no Latin letters', () => {
        for (const s of strings(VOICE_FLOW_MR)) {
            expect(s).toMatch(DEVANAGARI);
            expect(s).not.toMatch(LATIN);
        }
    });
    it('every English line has no Devanagari', () => {
        for (const s of strings(VOICE_FLOW_EN)) expect(s).not.toMatch(DEVANAGARI);
    });
    it('numbers follow the language: Devanagari in Marathi, 0-9 in English', () => {
        expect(VOICE_FLOW_MR.autoIn(7)).toContain('७');
        expect(VOICE_FLOW_MR.keptSub(46)).toContain('४६');
        expect(VOICE_FLOW_MR.closesIn(30)).toContain('३०');
        expect(VOICE_FLOW_EN.closesIn(30)).toContain('30');
    });
    it('the first step never claims the server has the voice (P10)', () => {
        expect(VOICE_FLOW_MR.keptSub(5)).not.toContain('सर्व्हर');
        expect(VOICE_FLOW_EN.keptSub(5).toLowerCase()).not.toContain('server');
    });
    it('chooses English only for "en"', () => {
        expect(voiceFlowWords('en')).toBe(VOICE_FLOW_EN);
        expect(voiceFlowWords('mr')).toBe(VOICE_FLOW_MR);
        expect(voiceFlowWords(undefined)).toBe(VOICE_FLOW_MR);
    });
});
