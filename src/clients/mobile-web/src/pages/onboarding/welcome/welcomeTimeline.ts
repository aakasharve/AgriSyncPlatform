/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure timing helpers for the welcome voice story. No React, no DOM: given the
 * playback second, answer "which phrase is on screen, which word is being
 * spoken, how far is each section". Kept pure so the sync is unit-tested.
 */
import {
    WELCOME_NOTE_CHAPTERS,
    WELCOME_NOTE_DURATION,
    WELCOME_NOTE_LINES,
} from './welcomeNoteScript';

export type WordSize = 'xl' | 'l' | 'm' | 's';
export type WordTone = 'gold' | 'leaf' | 'warn' | 'sky' | 'earth' | 'muted';
export type WordFx = 'rise' | 'glow' | 'bounce' | 'wave' | 'shake' | 'grow' | 'shrink' | 'blur' | 'stamp';

export interface StoryWord {
    text: string;
    t0: number;
    t1: number;
    size: WordSize;
    tone?: WordTone;
    fx?: WordFx;
}

export interface StoryLine {
    chapter: number;
    t0: number;
    t1: number;
    text: string;
    words: StoryWord[];
}

const SIZES = new Set<WordSize>(['xl', 'l', 'm', 's']);
const TONES = new Set<WordTone>(['gold', 'leaf', 'warn', 'sky', 'earth', 'muted']);
const EFFECTS = new Set<WordFx>(['rise', 'glow', 'bounce', 'wave', 'shake', 'grow', 'shrink', 'blur', 'stamp']);

/** "xl gold bounce" → { size: 'xl', tone: 'gold', fx: 'bounce' }. Unknown tokens are ignored. */
export function parseWordStyle(style?: string): Pick<StoryWord, 'size' | 'tone' | 'fx'> {
    const out: Pick<StoryWord, 'size' | 'tone' | 'fx'> = { size: 'm' };
    for (const token of (style ?? '').split(/\s+/)) {
        if (SIZES.has(token as WordSize)) out.size = token as WordSize;
        else if (TONES.has(token as WordTone)) out.tone = token as WordTone;
        else if (EFFECTS.has(token as WordFx)) out.fx = token as WordFx;
    }
    return out;
}

export const STORY_LINES: readonly StoryLine[] = WELCOME_NOTE_LINES.map((line) => {
    const words = line.w.map(([text, t0, t1, style]) => ({ text, t0, t1, ...parseWordStyle(style) }));
    return {
        chapter: line.ch,
        t0: words[0].t0,
        t1: words[words.length - 1].t1,
        text: words.map((w) => w.text).join(' '),
        words,
    };
});

export const STORY_CHAPTERS = WELCOME_NOTE_CHAPTERS;
export const STORY_DURATION = WELCOME_NOTE_DURATION;

/** Second at which each section's first phrase starts. */
export const CHAPTER_STARTS: readonly number[] = STORY_CHAPTERS.map((_, ci) => {
    const first = STORY_LINES.find((l) => l.chapter === ci);
    if (!first) throw new Error(`welcome note: section ${ci} has no phrases`);
    return first.t0;
});

/** A phrase appears this long before its first word, so the eye is ready. */
export const LINE_LEAD_SEC = 0.12;

/** Index of the phrase on screen at second `t`: the last one that has started; -1 before the first. */
export function lineIndexAt(lines: readonly StoryLine[], t: number, lead = LINE_LEAD_SEC): number {
    let lo = 0;
    let hi = lines.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t0 - lead <= t) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

export type WordState = 'ahead' | 'now' | 'said';

export function wordStateAt(word: Pick<StoryWord, 't0' | 't1'>, t: number): WordState {
    if (t >= word.t1) return 'said';
    if (t >= word.t0) return 'now';
    return 'ahead';
}

/** 0..1 fill for each section bar at second `t`. */
export function chapterFills(starts: readonly number[], duration: number, t: number): number[] {
    return starts.map((start, i) => {
        const end = starts[i + 1] ?? duration;
        return Math.max(0, Math.min(1, (t - start) / (end - start)));
    });
}

/** 83.6 → "1:24". */
export function formatClock(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Start second of word `w` in phrase `line` — the cue clock for visuals. */
export function cue(line: number, word = 0): number {
    const l = STORY_LINES[line];
    if (!l || !l.words[word]) throw new Error(`welcome note: no word ${word} in phrase ${line}`);
    return l.words[word].t0;
}

/** Copy for the "please listen" sheet, honest about the time actually left. */
export function skipSheetCopy(remainingSec: number, started: boolean): { title: string; body: string; left: string } {
    const m = Math.max(1, Math.round(remainingSec / 60));
    const left = remainingSec < 30
        ? 'फक्त काही सेकंद उरले आहेत'
        : started
            ? (m <= 1 ? 'फक्त एक मिनिट उरलं आहे' : `फक्त ${m} मिनिटं उरली आहेत`)
            : (m <= 1 ? 'फक्त एक मिनिट लागेल' : `फक्त ${m} मिनिटं लागतील`);
    return started
        ? {
            title: 'थोडंच राहिलं आहे',
            body: 'पूर्ण ऐकलं तर श्रम सफल तुमच्यासाठी का आहे, आणि रोजच्या कामात ते कशी साथ देईल, हे नीट समजेल.',
            left,
        }
        : {
            title: 'एक छोटी विनंती',
            body: 'हा संदेश आम्ही खास तुमच्यासाठी तयार केला आहे. श्रम सफल का बनवलं, आणि तुमच्या रोजच्या शेतीकामात ते कशी साथ देईल, हे एकदा ऐकून घ्या.',
            left,
        };
}

/** The intro runs at least this long (a 3·2·1 count), so the screen can come alive first. */
export const INTRO_MIN_MS = 3600;
/** …and never longer than this: a slow file starts and buffers rather than holding the farmer. */
export const INTRO_MAX_MS = 9000;
const COUNT_STEP_MS = INTRO_MIN_MS / 3;

/** What the intro shows at `elapsedMs`, and whether the voice should start now. */
export function introState(elapsedMs: number, audioReady: boolean): { count: number; progress: number; shouldStart: boolean } {
    const counting = elapsedMs < INTRO_MIN_MS;
    return {
        count: counting ? Math.ceil((INTRO_MIN_MS - elapsedMs) / COUNT_STEP_MS) : 0,
        progress: Math.min(1, Math.max(0, elapsedMs / INTRO_MIN_MS)),
        shouldStart: !counting && (audioReady || elapsedMs >= INTRO_MAX_MS),
    };
}
