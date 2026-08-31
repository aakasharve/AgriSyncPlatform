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
 * `toContain`, because `searchKey` returns many space-joined spellings and the
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
    /* पवार — the word-initial schwa survives, so the tight form is
       "pavar" and व as w reaches "pawar". */
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
    /* कुलकर्णी — the schwa retained before a conjunct. One of the most common
       surnames in Maharashtra, and unfindable without that rule. */
    ['कुलकर्णी', 'kulkarni'],
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
    expect(roman('कांबळे', { dropInherent: true })).toBe('kamble');
  });

  it('romanises शिंदे with an n, because द is not', () => {
    expect(roman('शिंदे', { dropInherent: true })).toBe('shinde');
  });

  it('still indexes the n spelling, so a caller who types kanble finds her', () => {
    // The rule is right; the caller does not have to know it.
    expect(searchKey('कांबळे')).toContain('kanble');
  });
});

describe('the schwa survives before a conjunct — कुलकर्णी is Kulkarni', () => {
  /**
   * The hidden 'a' on क is NOT dropped, because the र् that follows it is a
   * joined pair and dropping it would collide three consonants: kul-KAR-ni.
   *
   * This was a real gap until 2026-08-31. Without the rule the name romanised
   * only as "kulkrni" and "kulakarni", so a caller typing the ordinary English
   * spelling found nothing.
   */
  it('keeps the a before the conjunct, and drops the one that has no conjunct', () => {
    expect(roman('कुलकर्णी', { dropInherent: true })).toBe('kulkarni');
  });

  it('does not keep it where no conjunct follows — भोसले stays bhosle', () => {
    expect(roman('भोसले', { dropInherent: true })).toBe('bhosle');
  });
});

describe('ज्ञ reads dny in Marathi and gy in Hindi — both must find the row', () => {
  /**
   * ज्ञ is irregular: it is not ज + ञ. In Marathi it is *Dnyaneshwar*; the same
   * character in Hindi is read *gyan*, and people type the Hindi form out of
   * habit. Both are real typings, so both are indexed.
   *
   * Before this, ज्ञ fell through the table entirely and became a blank.
   */
  it.each([
    ['dnyaneshwar'],
    ['gyaneshwar'],
    ['dnyaneshvar'],
    ['dnya'],
  ])('ज्ञानेश्वर is findable by typing %s', (typed) => {
    expect(searchKey('ज्ञानेश्वर')).toContain(typed);
  });

  it('is not mistaken for a plain ज — that would romanise to j', () => {
    expect(roman('ज्ञानेश्वर')).not.toContain('j');
  });
});

describe('the dotted letters, and both ways they are typed', () => {
  /**
   * ज़ क़ फ़ carry a nukta and appear in Persian- and Urdu-origin names. Some
   * people type the dot (zakir), some type the plain letter (jakir); both are
   * indexed.
   *
   * NOTE for the founder: `z`/`f` are MY choice of primary reading, not his.
   */
  it('indexes ज़ as both z and j', () => {
    const key = searchKey('ज़ाकीर');
    expect(key).toContain('zakir');
    expect(key).toContain('jakir');
  });

  it('reads the precomposed and the decomposed spelling identically', () => {
    // Written as explicit code points, because the two are indistinguishable
    // on screen and a literal would silently test one string against itself.
    // U+095B is ZA as a single character; U+091C U+093C is JA + nukta. NFC is
    // what makes them agree: U+095B sits on the Unicode composition-exclusion
    // list, so NFC yields the decomposed form for both.
    const rest = 'ाकीर'; // aa-matra, ka, ii-matra, ra
    const precomposed = 'ज़' + rest;
    const decomposed = 'ज़' + rest;

    expect(precomposed).not.toBe(decomposed);

    expect(searchKey(precomposed)).toBe(searchKey(decomposed));
    expect(searchKey(decomposed)).toContain('zakir');
  });

  it('ignores a stray nukta that follows no letter', () => {
    expect(roman('़')).toBe('');
  });
});

describe('the inherent vowel, kept and dropped, at both ends of a word', () => {
  /**
   * A bare consonant carries a hidden 'a'. Two independent choices about it —
   * drop it between consonants, drop it at the end of a word — give four base
   * spellings, and all four are indexed.
   *
   * The word-final one matters for MULTI-WORD searches. Indexing only
   * "gaykvada" means typing "gaikwad patil" finds nothing, because the index
   * reads "gaikwada patila". That was a real gap until 2026-08-31.
   */
  it('romanises गायकवाड four ways', () => {
    expect(roman('गायकवाड')).toBe('gayakavada');
    expect(roman('गायकवाड', { dropFinal: true })).toBe('gayakavad');
    expect(roman('गायकवाड', { dropInherent: true })).toBe('gaykvada');
    expect(roman('गायकवाड', { dropInherent: true, dropFinal: true })).toBe('gaykvad');
  });

  it('finds a two-word name typed the way a person says it', () => {
    expect(searchKey('गायकवाड पाटील')).toContain('gaikwad patil');
  });

  it('finds a three-word name typed in full', () => {
    expect(searchKey('रमेश गायकवाड पाटील')).toContain('ramesh gaikwad patil');
  });

  it('lets digits and Latin characters through untouched', () => {
    // A name field often carries a phone fragment. It must survive the pass.
    expect(roman('राम 8888', { dropInherent: true })).toContain('8888');
  });

  it('treats a comma or an adjacent Latin word as the end of a word', () => {
    expect(roman('वाघ, Pune', { dropFinal: true })).toContain('vagh');
  });
});

describe('the arguable readings are all indexed, never chosen between', () => {
  it('indexes व as both v and w — Marathi writes it both ways in Latin', () => {
    const key = searchKey('वाघ');
    expect(key).toContain('wagh');
    expect(key).toContain('vagh');
  });

  it('indexes ay as ai — gaykwad and gaikwad are the same surname', () => {
    const key = searchKey('गायकवाड');
    expect(key).toContain('gaikwad');
    expect(key).toContain('gaykwad');
  });

  it('indexes the inherent a both kept and dropped — bhosale and bhosle', () => {
    const key = searchKey('भोसले');
    expect(key).toContain('bhosale');
    expect(key).toContain('bhosle');
  });
});

describe('what the index costs — measured, so Task 8 inherits a number', () => {
  /**
   * Measured 2026-08-31 on 3,000 rows of real Marathi names, single run under
   * jsdom on one machine — order-of-magnitude, not a benchmark. Task 8
   * (`DataList`) builds a haystack from these keys and searches it on every
   * keystroke, so the SHAPE of the cost matters more than the size:
   *
   *   BUILD  3,000 rows -> ~60 ms one-time, ~355 KB of index held in memory
   *   SCAN   3,000 rows -> ~0.4 ms per keystroke
   *
   * The scan is free. The BUILD is not, and it must be memoised on the row
   * data — recomputing it inside a keystroke handler turns a 0.4 ms search
   * into a 60 ms one. The ceilings below exist so a later change to the
   * respelling rules cannot quietly make that build ten times worse.
   */
  it('keeps a single surname in single digits', () => {
    // Measured: शिंदे 1, भोसले 2, कांबळे 4, गायकवाड 16 (the worst single word).
    expect(searchKey('कांबळे').split(' ').length).toBeLessThanOrEqual(8);
    expect(searchKey('गायकवाड').split(' ').length).toBeLessThanOrEqual(16);
  });

  it('keeps a full three-word name under a kilobyte', () => {
    // Measured: 48 spellings, 503 characters — the worst case in the sample.
    const key = searchKey('ज्ञानेश्वर बाळासाहेब कुलकर्णी');
    expect(key.split(' ').length).toBeLessThanOrEqual(64);
    expect(key.length).toBeLessThan(1024);
  });

  it('costs nothing for a name without an arguable reading', () => {
    // A respelling that does not apply is a no-op and de-duplicates away.
    // शिंदे has no व, no ay, no labial anusvāra, no ज्ञ and no nukta.
    expect(searchKey('शिंदे')).toBe('shinde');
  });
});

describe('a Latin name needs no index', () => {
  it.each([['Ramesh Patil'], ['ACME Agri FPO'], ['9764012345']])(
    '%s indexes to nothing — it is already searchable as itself',
    (name) => {
      expect(searchKey(name)).toBe('');
    }
  );

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
