import { describe, expect, it } from 'vitest';

import { hasDevanagari, roman, searchKey } from '@/lib/searchKey';

/**
 * THE PHONE CALL, AS A TEST.
 *
 * A support person hears "Kamble" and types it in Latin letters. The row says
 * कांबळे. Every assertion in this file is that call succeeding.
 *
 * The surnames below are REAL Marathi surnames, not invented strings — an
 * invented string can be made to pass by an algorithm that helps nobody. Each
 * `typed` column is what a person would plausibly type; each is asserted with
 * `toContain`, because `searchKey` returns seven space-joined spellings and the
 * caller searches with a substring test.
 */

describe('a Marathi surname is findable by typing it in Latin letters', () => {
  it.each([
    /* The four named in the plan. */
    ['भोसले', 'bhosale'],
    ['गायकवाड', 'gaikwad'],
    ['कांबळे', 'kamble'],
    ['वाघ', 'wagh'],

    /* Six more, each chosen because it exercises a DIFFERENT rule. */

    /* शिंदे — anusvāra before a dental: `n`, not `m`. The other half of the
       rule कांबळे proves. */
    ['शिंदे', 'shinde'],
    /* पवार — only the FULL spelling with व as w reaches "pawar"; the tight
       spelling is "pvara". This is the one case that needs variant 3. */
    ['पवार', 'pawar'],
    /* जाधव — a word-final consonant, and व as v rather than w. */
    ['जाधव', 'jadhav'],
    /* देशमुख — aspirates (ख = kh, श = sh) and a cluster written without a
       halant. */
    ['देशमुख', 'deshmukh'],
    /* साळुंखे — ळ, the retroflex lateral Marathi has and Hindi does not, plus
       an anusvāra before a velar. */
    ['साळुंखे', 'salunkhe'],
    /* पाटील — retroflex ट and the ी mātrā. */
    ['पाटील', 'patil'],
  ])('%s is findable by typing %s', (deva, typed) => {
    expect(searchKey(deva)).toContain(typed);
  });
});

describe('the anusvāra rule — the reason कांबळे is Kamble and not Kanble', () => {
  /**
   * अनुस्वार assimilates to the PLACE OF ARTICULATION of the consonant that
   * follows it. Before a labial (प फ ब भ म) the mouth is already closed at the
   * lips, so it is heard and typed as `m`. Everywhere else it is `n`.
   *
   * Flattening this to a single `n` is the single most common way to make a
   * Marathi surname unsearchable, and it is invisible in review because
   * "kanble" looks like a perfectly reasonable romanisation to a reader who
   * does not speak the language.
   */
  it('romanises कांबळे with an m, because ब is a labial', () => {
    expect(roman('कांबळे', true)).toBe('kamble');
  });

  it('romanises शिंदे with an n, because द is not', () => {
    expect(roman('शिंदे', true)).toBe('shinde');
  });

  it('still indexes the n spelling, so a caller who types kanble finds her', () => {
    // The rule is right; the caller does not have to know it.
    expect(searchKey('कांबळे')).toContain('kanble');
  });
});

describe('the seven spellings', () => {
  it('produces exactly seven, space-joined', () => {
    expect(searchKey('वाघ').split(' ')).toHaveLength(7);
  });

  it('indexes व as both v and w — Marathi writes it both ways in Latin', () => {
    const key = searchKey('वाघ');
    expect(key).toContain('wagh');
    expect(key).toContain('vagh');
  });

  it('indexes ay as ai — gaykwad and gaikwad are the same surname', () => {
    const key = searchKey('गायकवाड');
    expect(key).toContain('gaikwad');
    expect(key).toContain('gaykvad');
  });

  it('indexes the inherent a both kept and dropped — bhosale and bhosle', () => {
    const key = searchKey('भोसले');
    expect(key).toContain('bhosale');
    expect(key).toContain('bhosle');
  });
});

describe('what roman actually does with the inherent vowel', () => {
  /**
   * A bare consonant carries an inherent `a`. The "tight" form drops it —
   * EXCEPT at the end of a word, where the prototype keeps it. So गायकवाड
   * romanises "gaykvada", never "gaykvad".
   *
   * Substring search is unaffected (typing "gaikwad" still matches
   * "gaikwada"), which is why this is documented rather than changed. It is
   * on the founder's list: it is a transliteration judgement, not a bug a
   * test can settle.
   */
  it('keeps the inherent a on a word-final consonant, even when dropping', () => {
    expect(roman('गायकवाड', true)).toBe('gaykvada');
    expect(roman('गायकवाड', false)).toBe('gayakavada');
  });

  it('lets digits and Latin characters through untouched', () => {
    // A name field often carries a phone fragment. It must survive the pass.
    expect(roman('राम 8888', true)).toContain('8888');
  });
});

describe('KNOWN GAP — a halant conjunct after a dropped inherent vowel', () => {
  /**
   * कुलकर्णी yields "kulkrni" (tight) and "kulakarni" (full). A caller typing
   * "kulkarni" — the ordinary English spelling — matches NEITHER, because the
   * real spelling sits between the two forms.
   *
   * Inherited from the v3 prototype and deliberately NOT fixed in this task:
   * fixing it changes the shape of the key and needs the founder's eyes on the
   * result. Recorded here so it cannot be forgotten. When it is fixed, ADD the
   * "kulkarni" assertion — this test does not assert the gap is desirable, only
   * that the row is reachable by something today.
   */
  it('is still reachable by the tight spelling', () => {
    expect(searchKey('कुलकर्णी')).toContain('kulkrni');
  });
});

describe('a Latin name needs no index', () => {
  it.each([
    ['Ramesh Patil'],
    ['ACME Agri FPO'],
    ['9764012345'],
  ])('%s indexes to nothing — it is already searchable as itself', (name) => {
    expect(searchKey(name)).toBe('');
  });

  it.each([[null], [undefined], ['']])('%s indexes to nothing', (name) => {
    expect(searchKey(name)).toBe('');
  });
});

describe('hasDevanagari', () => {
  it('answers the same way every time it is asked', () => {
    // A /g-flagged regex carries `lastIndex` between calls and would alternate
    // true/false on the same input. DEVANAGARI is deliberately not global.
    expect(hasDevanagari('कांबळे')).toBe(true);
    expect(hasDevanagari('कांबळे')).toBe(true);
    expect(hasDevanagari('कांबळे')).toBe(true);
  });

  it('is false for Latin, digits, empty and absent', () => {
    expect(hasDevanagari('Kamble')).toBe(false);
    expect(hasDevanagari('9764')).toBe(false);
    expect(hasDevanagari('')).toBe(false);
    expect(hasDevanagari(null)).toBe(false);
    expect(hasDevanagari(undefined)).toBe(false);
  });

  it('is true for a mixed string — one Devanagari character is enough', () => {
    expect(hasDevanagari('Farm 12 — कांबळे')).toBe(true);
  });
});
