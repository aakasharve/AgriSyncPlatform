/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the tank count of a spray / drip release and HIS OWN words under
 * each value of "यातून काय समजलं" (the release's water and tanks, and each product). Pure.
 *
 * The tank count (founder: "take it from the parse when present, else from his words; if neither has it, show no count"):
 *   1. the parse: the release's own row says its carrier is a tank (`carrierType: 'Tank'`) with a count above 0, he did not say he
 *      does not know it (`numbers.carrierCount.certainty !== 'unknown'`) and the row is not marked as worked out or assumed;
 *   2. else his words: "<number> टाक्या" / "<number> टाकी" / "<number> tanks", the number as he said it (a digit or a number word up to
 *      twenty). Only when the log holds exactly ONE spray / drip release (else the words cannot be tied to one release without a
 *      guess), only when every such phrase in his words says the same number, and never a range ("दोन-तीन टाक्या");
 *   3. else none. Nothing is ever worked out or rounded (P4).
 *
 * His words are always a stretch of HIS transcript, exactly as it is written there (P8: what he told us, never what we inferred).
 */
import type { DailyLog, InputEvent } from '../../../../types';
import { findPhrase } from '../voiceResult/resultModel';
import { productBoxesOf, type ProductBox, type ProductItem } from '../voiceResult/productModel';

export interface TankCount {
    count: number;
    /** Where the count came from: the parse's own row, or a phrase of his words. */
    from: 'parse' | 'words';
    /** His words for it, exactly as in his transcript; null when they cannot be found there. */
    words: string | null;
}

const MR_NUMBERS: Readonly<Record<string, number>> = {
    'एक': 1, 'दोन': 2, 'तीन': 3, 'चार': 4, 'पाच': 5, 'सहा': 6, 'सात': 7, 'आठ': 8, 'नऊ': 9, 'दहा': 10,
    'अकरा': 11, 'बारा': 12, 'तेरा': 13, 'चौदा': 14, 'पंधरा': 15, 'सोळा': 16, 'सतरा': 17, 'अठरा': 18, 'एकोणीस': 19, 'वीस': 20,
};
const EN_NUMBERS: Readonly<Record<string, number>> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const WORDS = [...Object.keys(MR_NUMBERS), ...Object.keys(EN_NUMBERS)].sort((a, b) => b.length - a.length);
const NUM = `(?:${WORDS.join('|')}|[0-9]{1,2}|[०-९]{1,2})`;
/** A tank word: the plural (and its oblique forms), the plain singular, or English. Never "टाकीत" / "टाकीला" (in / per one tank). */
const TANK = '(?:टाक्या|टाक्यां[\\p{L}\\p{M}]*|टाकी(?![\\p{L}\\p{M}])|tanks?(?![\\p{L}]))';
const TANK_PHRASE = new RegExp(`(?<![\\p{L}\\p{M}0-9०-९])(${NUM})\\s*${TANK}`, 'giu');
/** A number right before the matched one: "दोन-तीन टाक्या", "दोन ते तीन टाक्या", "2 or 3 tanks" — a range, never one count. */
const RANGE_BEFORE = new RegExp(`(?<![\\p{L}\\p{M}0-9०-९])${NUM}\\s*(?:-|–|—|/|ते|किंवा|or|to)?\\s*$`, 'iu');
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
/** Spacing and punctuation two of his phrases may be apart by and still be one stretch of his words. */
const JOINER = /^[\s,.;:-]{0,3}$/;

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
const numberOf = (token: string): number | null => {
    const t = token.trim();
    if (MR_NUMBERS[t] !== undefined) return MR_NUMBERS[t];
    const en = EN_NUMBERS[t.toLowerCase()];
    if (en !== undefined) return en;
    const ascii = [...t].map(ch => { const d = DEVANAGARI_DIGITS.indexOf(ch); return d >= 0 ? String(d) : ch; }).join('');
    return /^[0-9]{1,2}$/.test(ascii) ? Number(ascii) : null;
};

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

interface Span { start: number; end: number }

/** A stretch widened to whole words of his transcript (a phrase found inside "कॉन्फिडॉरचे" is "कॉन्फिडॉरचे"). */
function wholeWords(transcript: string, span: Span): Span {
    let { start, end } = span;
    while (start > 0 && WORD_CHAR.test(transcript[start - 1])) start -= 1;
    while (end < transcript.length && WORD_CHAR.test(transcript[end])) end += 1;
    return { start, end };
}

/** Where a phrase of his sits in his transcript (letters compared, spacing aside), widened to whole words; null when it is not there. */
function spanIn(transcript: string, phrase: string | undefined | null): Span | null {
    const p = (phrase ?? '').trim();
    if (!transcript || !p) return null;
    const hit = findPhrase(transcript, p);
    return hit ? wholeWords(transcript, hit) : null;
}

/** The clause of his words around a span (between the punctuation on either side), when it is short enough to read; else the span. */
function clauseAround(transcript: string, span: Span): string {
    const before = transcript.slice(0, span.start);
    const after = transcript.slice(span.end);
    const from = Math.max(before.lastIndexOf('.'), before.lastIndexOf(','), before.lastIndexOf('।'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
    const stop = after.search(/[.,।!?]/);
    const to = span.end + (stop < 0 ? after.length : stop);
    const clause = transcript.slice(from, to).trim();
    return clause.length > 0 && clause.length <= 48 ? clause : transcript.slice(span.start, span.end).trim();
}

/** Every "<number> टाक्या" phrase of his words, with the count it says. A range anywhere makes the whole reading ambiguous (null). */
export function tankPhrasesIn(transcript: string): Array<{ count: number; span: Span }> | null {
    if (!transcript) return [];
    const out: Array<{ count: number; span: Span }> = [];
    for (const m of transcript.matchAll(TANK_PHRASE)) {
        const start = m.index ?? 0;
        if (RANGE_BEFORE.test(transcript.slice(0, start))) return null;
        const count = numberOf(m[1]);
        if (count === null || count <= 0) continue;
        out.push({ count, span: { start, end: start + m[0].length } });
    }
    return out;
}

/** The release's own input row, by its box's place in the log. */
function inputOfBox(log: DailyLog, boxId: string): { event: InputEvent; boxes: ProductBox[] } | null {
    const boxes = productBoxesOf(log);
    const i = boxes.findIndex(b => b.id === boxId);
    const event = i >= 0 ? (log.inputs ?? [])[i] : undefined;
    return event ? { event, boxes } : null;
}

/** The tank count of one release: from the parse, else from his words, else none (see the header). */
export function tankCountOf(log: DailyLog | undefined, boxId: string, transcript: string): TankCount | null {
    if (!log) return null;
    const found = inputOfBox(log, boxId);
    if (!found) return null;
    const { event, boxes } = found;
    const box = boxes.find(b => b.id === boxId);
    if (!box || box.kind === 'other') return null;
    const phrases = tankPhrasesIn(transcript);
    const sayingOf = (count: number): string | null => {
        const same = (phrases ?? []).filter(p => p.count === count);
        return same.length > 0 ? clauseAround(transcript, same[0].span) : null;
    };

    // 1. The parse's own row.
    const fact = event.numbers?.carrierCount;
    // A count the system worked out or assumed ('derived' / 'assumed') is not one he stated: it is never shown as his (P4, P8).
    const stated = event.provenance === undefined || event.provenance === 'spoken' || event.provenance === 'confirmed';
    if (event.carrierType === 'Tank' && positive(event.carrierCount) && fact?.certainty !== 'unknown' && stated) {
        const spoken = spanIn(transcript, fact?.spokenText);
        return { count: event.carrierCount, from: 'parse', words: spoken ? clauseAround(transcript, spoken) : sayingOf(event.carrierCount) };
    }

    // 2. His words, only when they can belong to this release alone.
    const tankBoxes = boxes.filter(b => b.kind !== 'other');
    if (tankBoxes.length !== 1 || !phrases || phrases.length === 0) return null;
    const counts = new Set(phrases.map(p => p.count));
    if (counts.size !== 1) return null;
    const count = phrases[0].count;
    return { count, from: 'words', words: clauseAround(transcript, phrases[0].span) };
}

/** His words for the release's water (his own words for the number, when they are in his transcript). */
export function waterWordsOf(box: ProductBox, transcript: string): string[] {
    const out: string[] = [];
    for (const w of box.water) {
        const span = spanIn(transcript, w.spoken);
        if (span) out.push(transcript.slice(span.start, span.end).trim());
    }
    return [...new Set(out)];
}

/**
 * His words for one product: the name as he said it and the amount as he said it, each only when it is in his transcript; one
 * stretch when they sit side by side ("कॉन्फिडॉर पन्नास मिली"), else each on its own.
 */
export function productWordsOf(item: ProductItem, transcript: string): string[] {
    if (!transcript) return [];
    const name = [item.said, item.spokenName, item.label].map(n => spanIn(transcript, n)).find((s): s is Span => !!s) ?? null;
    if (item.spokenIsPhrase) return name ? [transcript.slice(name.start, name.end).trim()] : [];
    const amount = item.amount && 'spoken' in item.amount ? spanIn(transcript, item.amount.spoken) : null;
    if (name && amount) {
        const [a, b] = name.start <= amount.start ? [name, amount] : [amount, name];
        if (b.start >= a.end && JOINER.test(transcript.slice(a.end, b.start))) return [transcript.slice(a.start, b.end).trim()];
        if (b.start < a.end) return [transcript.slice(a.start, Math.max(a.end, b.end)).trim()];
    }
    return [name, amount].filter((s): s is Span => !!s).map(s => transcript.slice(s.start, s.end).trim());
}
