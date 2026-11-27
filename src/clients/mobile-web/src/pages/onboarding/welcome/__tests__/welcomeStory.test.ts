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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CHAPTER_STARTS, INTRO_MAX_MS, INTRO_MIN_MS, STORY_CHAPTERS, STORY_DURATION, STORY_LINES,
    chapterIndexAt, cue, formatClock, formatTimeLeft, introState, lineIndexAt, parseWordStyle, skipSheetCopy, timeAtFraction,
    wordStateAt,
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

    it('formats the clock', () => {
        // A clock counts whole seconds passed: the 138.53 s note ends on 2:18, never 2:19 (R1 04).
        expect(formatClock(83.6)).toBe('1:23');
        expect(formatClock(59.99)).toBe('0:59');
        expect(formatClock(STORY_DURATION)).toBe('2:18');
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

// Repair R3 lane S1 (V6b-A, founder 27 Nov 2026): one drag bar with the part ticks, the time played and the time left under it,
// and the part name in a bubble while dragging. These are the bar's sums.
describe('the player bar (V6b-A)', () => {
    it('the part starts are the design\'s: 0, 8.58, 33.58, 56.87, 76.66, 94.39, 112.09 s', () => {
        expect(CHAPTER_STARTS).toEqual([0, 8.58, 33.58, 56.87, 76.66, 94.39, 112.09]);
    });

    it('names the part under any second: the last part that has started', () => {
        expect(chapterIndexAt(CHAPTER_STARTS, -3)).toBe(0);
        expect(chapterIndexAt(CHAPTER_STARTS, 0)).toBe(0);
        expect(chapterIndexAt(CHAPTER_STARTS, 8.57)).toBe(0);
        expect(chapterIndexAt(CHAPTER_STARTS, 8.58)).toBe(1);
        expect(chapterIndexAt(CHAPTER_STARTS, 56.86)).toBe(2);
        expect(chapterIndexAt(CHAPTER_STARTS, STORY_DURATION)).toBe(6);
        expect(STORY_CHAPTERS[chapterIndexAt(CHAPTER_STARTS, STORY_DURATION / 2)]).toBe('कामाची खात्री');
    });

    it('turns a place on the bar into a second, never outside the note', () => {
        expect(timeAtFraction(0.5, 100)).toBe(50);
        expect(timeAtFraction(0, 100)).toBe(0);
        expect(timeAtFraction(-0.2, 100)).toBe(0);
        expect(timeAtFraction(1.4, 100)).toBe(100);
        expect(timeAtFraction(Number.NaN, 100)).toBe(0);
    });

    it('the time left counts down to 0:00 with a minus sign, like the drawing ("−2:18")', () => {
        expect(formatTimeLeft(0, STORY_DURATION)).toBe('−2:18');
        expect(formatTimeLeft(60.2, STORY_DURATION)).toBe('−1:18');
        expect(formatTimeLeft(STORY_DURATION, STORY_DURATION)).toBe('−0:00');
        expect(formatTimeLeft(200, STORY_DURATION)).toBe('−0:00');
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

describe('tappable pictures', () => {
    // Full-size overlay layers sit on top of tappable art; each must let taps
    // through, or the picture under it silently stops responding (found on the
    // season wheel in the test-app check, 2026-11-26).
    const css = readFileSync(fileURLToPath(new URL('../welcomeStory.css', import.meta.url)), 'utf8');
    it.each(['.ws-wheel-core', '.ws-ripples', '.ws-target', '.ws-fog', '.ws-cross', '.ws-confetti', '.ws-leaves', '.ws-sparkle'])('%s does not swallow taps', (sel) => {
        const rule = css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*\\}'))?.[0] ?? '';
        expect(rule, `${sel} rule`).toContain('pointer-events: none');
    });
});
