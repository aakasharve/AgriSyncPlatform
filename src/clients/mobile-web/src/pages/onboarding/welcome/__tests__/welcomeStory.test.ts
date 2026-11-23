/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The welcome voice story only works if text, pictures and voice agree. These
 * tests pin that: the words are the founder's (with the app's brand spelling),
 * the timings run forward inside the recording, every picture cue points at a
 * real spoken word inside its own scene, and the intro starts the voice by
 * itself at the right moment.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CHAPTER_STARTS, INTRO_MAX_MS, INTRO_MIN_MS, STORY_CHAPTERS, STORY_DURATION, STORY_LINES,
    chapterFills, cue, formatClock, introState, lineIndexAt, parseWordStyle, skipSheetCopy, wordStateAt,
} from '../welcomeTimeline';
import { STORY_SCENES, sceneIndexForLine } from '../welcomeScenes';

const allWords = STORY_LINES.flatMap((l) => l.words);

describe('welcome note script', () => {
    it('carries the founder transcript word for word, brand written "श्रम सफल"', () => {
        expect(allWords).toHaveLength(283);
        expect(STORY_LINES[0].text).toBe('नमस्कार!');
        expect(STORY_LINES[STORY_LINES.length - 1].text).toBe('चला, श्रम सफलसोबत सुरुवात करूया!');
        expect(allWords.some((w) => w.text.startsWith('श्रमसफल'))).toBe(false);
        expect(STORY_LINES.filter((l) => l.text.includes('श्रम सफल'))).toHaveLength(5);
    });

    it('runs forward in time, inside the recording', () => {
        let prev = 0;
        for (const w of allWords) {
            expect(w.t1).toBeGreaterThanOrEqual(w.t0);
            expect(w.t0).toBeGreaterThanOrEqual(prev - 0.2);
            expect(w.t1).toBeLessThanOrEqual(STORY_DURATION);
            prev = w.t0;
        }
    });

    it('gives every section at least one phrase, in order', () => {
        expect(CHAPTER_STARTS).toHaveLength(STORY_CHAPTERS.length);
        CHAPTER_STARTS.forEach((s, i) => { if (i) expect(s).toBeGreaterThan(CHAPTER_STARTS[i - 1]); });
    });
});

describe('sync helpers', () => {
    it('finds the phrase on screen, slightly ahead of its first word', () => {
        expect(lineIndexAt(STORY_LINES, -1)).toBe(-1);
        expect(lineIndexAt(STORY_LINES, 0)).toBe(0);
        const l5 = STORY_LINES[5];
        expect(lineIndexAt(STORY_LINES, l5.t0 - 0.05)).toBe(5);
        expect(lineIndexAt(STORY_LINES, l5.t0 - 0.5)).toBe(4);
        expect(lineIndexAt(STORY_LINES, STORY_DURATION + 5)).toBe(STORY_LINES.length - 1);
    });

    it('lights a word only while it is spoken', () => {
        const w = { t0: 10, t1: 11 };
        expect(wordStateAt(w, 9.9)).toBe('ahead');
        expect(wordStateAt(w, 10.5)).toBe('now');
        expect(wordStateAt(w, 11)).toBe('said');
    });

    it('fills section bars and formats the clock', () => {
        const fills = chapterFills([0, 10, 20], 30, 15);
        expect(fills).toEqual([1, 0.5, 0]);
        expect(formatClock(83.6)).toBe('1:24');
        expect(formatClock(STORY_DURATION)).toBe('2:19');
    });

    it('reads word styles and ignores unknown tokens', () => {
        expect(parseWordStyle('xl gold bounce')).toEqual({ size: 'xl', tone: 'gold', fx: 'bounce' });
        expect(parseWordStyle(undefined)).toEqual({ size: 'm' });
        expect(parseWordStyle('l nonsense')).toEqual({ size: 'l' });
    });

    it('tells the truth about time left on the skip sheet', () => {
        expect(skipSheetCopy(STORY_DURATION, false).left).toBe('फक्त 2 मिनिटं लागतील');
        expect(skipSheetCopy(70, true).left).toBe('फक्त एक मिनिट उरलं आहे');
        expect(skipSheetCopy(12, true).left).toBe('फक्त काही सेकंद उरले आहेत');
        expect(skipSheetCopy(70, true).title).toBe('थोडंच राहिलं आहे');
    });
});

describe('auto-start intro', () => {
    it('counts 3, 2, 1 and never starts before the count ends', () => {
        expect(introState(0, true)).toMatchObject({ count: 3, shouldStart: false });
        expect(introState(INTRO_MIN_MS / 2, true)).toMatchObject({ count: 2, shouldStart: false });
        expect(introState(INTRO_MIN_MS - 1, true)).toMatchObject({ count: 1, shouldStart: false });
    });

    it('starts when the count ends and the audio is ready', () => {
        expect(introState(INTRO_MIN_MS, true)).toMatchObject({ count: 0, shouldStart: true });
    });

    it('waits for slow audio, but not forever', () => {
        expect(introState(INTRO_MIN_MS + 1000, false).shouldStart).toBe(false);
        expect(introState(INTRO_MAX_MS, false).shouldStart).toBe(true);
    });
});

describe('picture track', () => {
    it('opens on the first phrase and moves forward', () => {
        expect(STORY_SCENES[0].line).toBe(0);
        STORY_SCENES.forEach((s, i) => { if (i) expect(s.line).toBeGreaterThan(STORY_SCENES[i - 1].line); });
        expect(sceneIndexForLine(0)).toBe(0);
        expect(sceneIndexForLine(STORY_LINES.length - 1)).toBe(STORY_SCENES.length - 1);
    });

    it('rejects a cue that points at a word that does not exist', () => {
        expect(() => cue(0, 5)).toThrow();
        expect(() => cue(999)).toThrow();
    });

    it('keys every moving part to a spoken moment inside its own scene', () => {
        STORY_SCENES.forEach((scene, i) => {
            const html = renderToStaticMarkup(scene.art() as React.ReactElement);
            const from = STORY_LINES[scene.line].t0 - 0.5;
            const next = STORY_SCENES[i + 1];
            const to = next ? STORY_LINES[next.line].t0 : STORY_DURATION;
            for (const m of html.matchAll(/data-at="([\d.]+)"/g)) {
                const at = Number(m[1]);
                expect(at, `scene ${i} cue ${at}s outside ${from.toFixed(1)}–${to.toFixed(1)}s`).toBeGreaterThanOrEqual(from);
                expect(at).toBeLessThanOrEqual(to);
            }
        });
    });
});
