/**
 * ROMANISED SEARCH — the prototype's single most valuable non-visual addition.
 *
 * Ported from the v3 prototype `G:/VALIDATION/ADMIN_ REDESIGN/v3/app.js:33-101`
 * (`AS.roman` / `AS.searchKey`). The plan cites `app.js:35-101`; the block
 * actually opens at line 33 with its section comment. The prototype is
 * authoritative for behaviour, the repo for line numbers.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A farmer's name is stored the way it is written: कांबळे. A support person on
 * a phone call HEARS "Kamble" and types it in Latin letters. Today that search
 * compares Latin against Devanagari and finds nothing, while the person on the
 * other end of the call waits.
 *
 * `searchKey` turns one Devanagari string into SEVEN Latin spellings, so any
 * reasonable way a person might type the name matches. The caller appends the
 * key to its haystack and keeps searching with a plain substring test:
 *
 *     const hay = (raw + ' ' + searchKey(raw)).toLowerCase();
 *     hay.includes(query.toLowerCase());
 *
 * Nothing is transliterated for DISPLAY. A name is always shown in the script
 * it was written in — see `PersonName`. This module only builds a hidden index.
 *
 * ── The seven spellings, and why each one is needed ────────────────────────
 *  1. `full`  — every inherent 'a' kept:            भोसले -> bhosale
 *  2. `tight` — inherent 'a' dropped mid-word:      भोसले -> bhosle
 *  3. `full`  with व as w:                          पवार  -> pawar
 *  4. `tight` with व as w:                          वाघ   -> wagh
 *  5. (4) with `ay` respelled `ai`:                 गायकवाड -> gaikwad
 *  6. `tight` with `ay` respelled `ai`
 *  7. `tight` with an anusvāra 'm' respelled 'n':   कांबळे -> kanble
 *
 * Spelling 7 is the deliberate counterpart to the anusvāra rule in `roman`.
 * The rule is right — अनुस्वार assimilates to the following consonant's place
 * of articulation, so कांबळे is *Kamble* with an m — but a caller who does not
 * know that may well type "Kanble", and a search that punishes them for it is
 * a search that fails the phone call.
 *
 * ── A known gap, recorded rather than hidden ───────────────────────────────
 * A conjunct written with a halant, where the preceding syllable also drops
 * its inherent vowel, lands between the two spellings and matches neither:
 * कुलकर्णी yields `kulkrni` (tight) and `kulakarni` (full), so a caller typing
 * "kulkarni" finds nothing. This is inherited from the prototype and is NOT
 * fixed here — fixing it changes the shape of the key and belongs in its own
 * task with the founder's eyes on the result.
 */

/** Devanagari, U+0900-U+097F. The ONE copy — `PersonName` imports this rather
 *  than declaring a fifth. Not global-flagged: a `/g` regex carries
 *  `lastIndex` between calls and would answer differently on alternate runs. */
export const DEVANAGARI = /[ऀ-ॿ]/;

/** True when the string contains at least one Devanagari character. */
export function hasDevanagari(s: string | null | undefined): boolean {
  return !!s && DEVANAGARI.test(s);
}

/* Consonants. `ळ` (the retroflex lateral, which Marathi has and Hindi does
   not) maps to plain `l`: nobody types it any other way. */
const R_CONS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd',
  ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y',
  र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l',
};

/* Dependent vowel signs (मात्रा) — they replace the inherent 'a'. */
const R_MATRA: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ru',
};

/* Independent vowels — a word-initial vowel is written with its own letter. */
const R_VOWEL: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u',
  ऊ: 'u', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};

const R_HALANT = '्';
const R_ANUSVARA = 'ं';
const R_CHANDRA = 'ँ';
const R_VISARGA = 'ः';

/** The labials. अनुस्वार before one of these is heard — and typed — as `m`. */
const R_LABIAL: Record<string, true> = { प: true, फ: true, ब: true, भ: true, म: true };

/**
 * Romanise one Devanagari string.
 *
 * @param dropInherent  When true, a bare consonant contributes no 'a' UNLESS
 *   it ends the word. That yields the "tight" spelling (भोसले -> bhosle) while
 *   the false form yields the "full" one (bhosale). Real typing sits between
 *   the two, which is exactly why `searchKey` indexes both.
 *
 * Characters with no mapping become a space, so a Latin fragment or a digit
 * inside a Devanagari string survives and nothing else leaks into the key.
 */
export function roman(s: string | null | undefined, dropInherent: boolean): string {
  if (s == null) return '';
  const str = String(s);
  let out = '';
  let i = 0;

  while (i < str.length) {
    const ch = str.charAt(i);
    const next = str.charAt(i + 1);

    if (R_CONS[ch]) {
      /* Halant kills the inherent vowel outright — a conjunct, in both forms. */
      if (next === R_HALANT) {
        out += R_CONS[ch];
        i += 2;
        continue;
      }
      /* A मात्रा replaces the inherent vowel with its own. */
      if (R_MATRA[next]) {
        out += R_CONS[ch] + R_MATRA[next];
        i += 2;
        continue;
      }
      const wordEnd = next === '' || next === ' ';
      out += R_CONS[ch] + (dropInherent && !wordEnd ? '' : 'a');
      i += 1;
      continue;
    }

    if (R_VOWEL[ch]) {
      out += R_VOWEL[ch];
      i += 1;
      continue;
    }

    if (R_MATRA[ch]) {
      out += R_MATRA[ch];
      i += 1;
      continue;
    }

    /* THE ANUSVĀRA RULE. अनुस्वार assimilates to the place of articulation of
       the consonant that follows it, so it is `m` before a labial and `n`
       everywhere else: कांबळे is "kamble", शिंदे is "shinde". Collapsing this
       to a flat `n` is the single most common way to make a Marathi surname
       unsearchable, which is why `searchKey` still indexes the `n` form
       separately instead of pretending the rule does not exist. */
    if (ch === R_ANUSVARA || ch === R_CHANDRA) {
      out += R_LABIAL[next] ? 'm' : 'n';
      i += 1;
      continue;
    }

    if (ch === R_VISARGA) {
      out += 'h';
      i += 1;
      continue;
    }

    out += /[a-z0-9]/i.test(ch) ? ch : ' ';
    i += 1;
  }

  return out;
}

/**
 * Every spelling a person might type for one Devanagari string — seven of them,
 * space-joined, ready to be appended to a search haystack.
 *
 * Returns '' for anything with no Devanagari in it. A Latin name needs no
 * index: it is already searchable as itself, and adding a second copy would
 * only double the haystack.
 */
export function searchKey(s: string | null | undefined): string {
  if (!s || !hasDevanagari(String(s))) return '';

  const full = roman(s, false);
  const tight = roman(s, true);
  const w = tight.replace(/v/g, 'w'); // व is written both v and w

  return [
    full,
    tight,
    full.replace(/v/g, 'w'),
    w,
    w.replace(/ay/g, 'ai'), // gaykwad -> gaikwad
    tight.replace(/ay/g, 'ai'),
    tight.replace(/m([pbm])/g, 'n$1'), // kamble / kanble both findable
  ].join(' ');
}
