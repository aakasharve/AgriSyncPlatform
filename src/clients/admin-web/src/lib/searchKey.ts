/**
 * ROMANISED SEARCH — the prototype's single most valuable non-visual addition.
 *
 * Ported from the v3 prototype `G:/VALIDATION/ADMIN_ REDESIGN/v3/app.js:33-101`
 * (`AS.roman` / `AS.searchKey`). The plan cites `app.js:35-101`; the block
 * actually opens at line 33 with its section comment. The prototype is
 * authoritative for behaviour, the repo for line numbers.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A farmer's name is written the way it is written: कांबळे. A support person on
 * a phone call HEARS "Kamble" and types it in Latin letters. Without this the
 * search compares Latin against Devanagari and finds nothing, while the person
 * on the other end of the call waits.
 *
 * `searchKey` turns one Devanagari string into every Latin spelling a person
 * might plausibly type. The caller appends the key to its haystack and keeps
 * searching with a plain substring test:
 *
 *     const hay = (raw + ' ' + searchKey(raw)).toLowerCase();
 *     hay.includes(query.toLowerCase());
 *
 * Nothing is transliterated for DISPLAY. A name is always shown in the script
 * it was written in — see `PersonName`. This module only builds a hidden index.
 *
 * ── The governing principle (founder ruling, 2026-08-31) ──────────────────
 * INDEX MORE SPELLINGS. Prefer over-matching to under-matching: a wrong extra
 * row costs a support person one glance, a missing row costs a farmer a phone
 * call that ends in "I cannot find you." Where a romanisation is arguable,
 * both readings are indexed rather than one being chosen.
 *
 * ── How the spellings are generated ───────────────────────────────────────
 * FOUR base romanisations, from two independent choices about the inherent
 * vowel (the silent 'a' every bare consonant carries):
 *
 *     dropInherent   drop it between consonants    भोसले  -> bhosle / bhosale
 *     dropFinal      drop it at the end of a word  गायकवाड -> gaykvad / gaykvada
 *
 * then FIVE respellings, applied in every combination and de-duplicated:
 *
 *     व  as v or w         वाघ        -> vagh / wagh
 *     ay as ay or ai       गायकवाड     -> gaykwad / gaikwad
 *     anusvāra m or n      कांबळे      -> kamble / kanble
 *     ज्ञ as dny or gy      ज्ञानेश्वर   -> dnyaneshwar / gyaneshwar
 *     nukta z/f or j/ph    ज़ाकीर       -> zakir / jakir
 *
 * A respelling that does not apply is a no-op and de-duplicates away, so the
 * combinatorial cost is paid ONLY by names that actually contain the feature.
 * A typical Marathi surname yields four to twelve spellings; the ceiling is
 * measured and asserted in `searchKey.test.ts`, not assumed.
 *
 * ── Rules that are correctness, not options ───────────────────────────────
 * 1. ANUSVĀRA ASSIMILATES to the following consonant's place of articulation:
 *    `m` before a labial (कांबळे = Kamble), `n` elsewhere (शिंदे = Shinde).
 * 2. THE SCHWA IS RETAINED BEFORE A CONJUNCT. कुलकर्णी is "kulkarni", not
 *    "kulkrni": the 'a' on क survives because the र् that follows it is a
 *    joined pair. Without this rule one of the most common surnames in
 *    Maharashtra is unfindable by the way everyone spells it.
 * 3. THE SCHWA IS RETAINED WORD-INITIALLY. Schwa deletion never touches the
 *    first syllable, so रमेश is "ramesh" and पवार is "pavar". Without this a
 *    multi-word name cannot be found by typing it in full.
 */

/** Devanagari, U+0900-U+097F. The ONE copy — `PersonName` imports this rather
 *  than declaring a fifth. Not global-flagged: a `/g` regex carries
 *  `lastIndex` between calls and would answer differently on alternate runs. */
export const DEVANAGARI = /[ऀ-ॿ]/;

/** True when the string contains at least one Devanagari character. */
export function hasDevanagari(s: string | null | undefined): boolean {
  return !!s && DEVANAGARI.test(s);
}

/* Consonants. `ळ` (the retroflex lateral Marathi has and Hindi does not) maps
   to plain `l`; `ञ` and `ङ` (the palatal and velar nasals) to plain `n`; `ऱ`
   (the Marathi eyelash ra) to `r`. Nobody types any of them another way. */
const R_CONS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh',
  ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd',
  ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y',
  र: 'r', ऱ: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l',
};

/** The combining nukta, U+093C. */
const R_NUKTA_SIGN = '़';

/* The dotted letters, used for Persian- and Urdu-origin names. Input is
   normalised to NFC first, which DECOMPOSES क़ ज़ फ़ into base + nukta — those
   code points sit on the Unicode composition-exclusion list — so this one
   table covers both the precomposed and the decomposed spelling. Verified in
   node, not assumed: NFC('\u095B') === '\u091C\u093C'. */
const R_NUKTA: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', ज: 'z', ड: 'd', ढ: 'dh', फ: 'f', य: 'y',
};

/* Dependent vowel signs (मात्रा) — they replace the inherent 'a'. `ॉ` and `ॅ`
   are the candra vowels Marathi uses for borrowed words (डॉक्टर). */
const R_MATRA: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ru',
  'ॉ': 'o', 'ॅ': 'e',
};

/* Independent vowels — a word-initial vowel is written with its own letter.
   `ऋ` reads `ru` in Marathi (Krushna), not the Hindi `ri`; `ॲ` is the Marathi
   candra a. */
const R_VOWEL: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ru',
  ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e', ॲ: 'a',
};

const R_HALANT = '्';
const R_ANUSVARA = 'ं';
const R_CHANDRA = 'ँ';
const R_VISARGA = 'ः';

/** The labials. अनुस्वार before one of these is heard — and typed — as `m`. */
const R_LABIAL: Record<string, true> = { प: true, फ: true, ब: true, भ: true, म: true };

/**
 * ज्ञ is irregular: it is NOT ज + ञ. Marathi reads it `dny` (ज्ञानेश्वर =
 * Dnyaneshwar); the same character in Hindi reads `gy` (ज्ञान = gyan), and
 * people type the Hindi form out of habit — including Marathi speakers typing
 * quickly. Both are indexed; see RESPELLINGS.
 */
const JNA = 'ज्ञ';
const JNA_ROMAN = 'dny';

export interface RomanOptions {
  /** Drop the inherent 'a' BETWEEN consonants. भोसले -> bhosle, not bhosale. */
  dropInherent?: boolean;
  /** Drop the inherent 'a' on a WORD-FINAL consonant. गायकवाड -> gaykvad. */
  dropFinal?: boolean;
}

/**
 * Romanise one Devanagari string.
 *
 * Characters with no mapping become a space, so a Latin fragment or a digit
 * inside a Devanagari string survives and nothing else leaks into the key.
 */
export function roman(s: string | null | undefined, opts: RomanOptions = {}): string {
  if (s == null) return '';
  const { dropInherent = false, dropFinal = false } = opts;
  const str = String(s).normalize('NFC');

  let out = '';
  let i = 0;

  while (i < str.length) {
    const ch = str.charAt(i);

    /* A consonant, which may be one character, the ज्ञ digraph, or a letter
       carrying a nukta. Resolve which it is, then apply ONE inherent-vowel
       rule to all three rather than three near-copies of it. */
    let cons = '';
    let len = 0;

    if (str.startsWith(JNA, i)) {
      cons = JNA_ROMAN;
      len = JNA.length;
    } else if (R_CONS[ch]) {
      const dotted = str.charAt(i + 1) === R_NUKTA_SIGN;
      cons = (dotted && R_NUKTA[ch]) || R_CONS[ch];
      len = dotted ? 2 : 1;
    }

    if (cons) {
      const after = str.charAt(i + len);

      /* A halant kills the inherent vowel outright — a conjunct, in every form. */
      if (after === R_HALANT) {
        out += cons;
        i += len + 1;
        continue;
      }
      /* A मात्रा replaces the inherent vowel with its own. */
      if (R_MATRA[after]) {
        out += cons + R_MATRA[after];
        i += len + 1;
        continue;
      }

      /* End of word: anything that is not Devanagari ends it, so a comma or an
         adjacent Latin word breaks the run as reliably as a space does. */
      const wordEnd = after === '' || !DEVANAGARI.test(after);

      /* THE SCHWA-BEFORE-A-CONJUNCT RULE. The inherent 'a' survives when the
         next consonant is itself halanted, because dropping it would collide
         three consonants. This is what makes कुलकर्णी "kulkarni". */
      const conjunctAhead = !!R_CONS[after] && str.charAt(i + len + 1) === R_HALANT;

      /* THE WORD-INITIAL RULE. Schwa deletion never touches the first syllable
         of a word: रमेश is "ramesh", never "rmesh", and पवार is "pavar", never
         "pvar". Without this a multi-word name cannot be found by typing it in
         full, because the first word of each is mangled. */
      const before = i === 0 ? '' : str.charAt(i - 1);
      const wordStart = before === '' || !DEVANAGARI.test(before);

      const keep = wordEnd ? !dropFinal : !dropInherent || conjunctAhead || wordStart;
      out += cons + (keep ? 'a' : '');
      i += len;
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
       unsearchable, which is why the `n` form is still indexed separately
       instead of pretending the rule does not exist. */
    if (ch === R_ANUSVARA || ch === R_CHANDRA) {
      out += R_LABIAL[str.charAt(i + 1)] ? 'm' : 'n';
      i += 1;
      continue;
    }

    if (ch === R_VISARGA) {
      out += 'h';
      i += 1;
      continue;
    }

    /* A stray nukta with no letter in front of it carries no sound. */
    if (ch === R_NUKTA_SIGN) {
      i += 1;
      continue;
    }

    out += /[a-z0-9]/i.test(ch) ? ch : ' ';
    i += 1;
  }

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * The arguable readings. Each is a no-op on a name that lacks the feature, so
 * it costs nothing after de-duplication.
 */
const RESPELLINGS: Array<(s: string) => string> = [
  (s) => s.replace(/v/g, 'w'), // व is written both v and w
  (s) => s.replace(/ay/g, 'ai'), // gaykwad -> gaikwad
  (s) => s.replace(/m([pbm])/g, 'n$1'), // kamble / kanble both findable
  (s) => s.replace(/dny/g, 'gy'), // Dnyaneshwar / Gyaneshwar
  (s) => s.replace(/z/g, 'j').replace(/f/g, 'ph'), // the dotted letters, typed plain
];

/**
 * Every combination of the respellings above, de-duplicated.
 *
 * One pass per respelling over everything collected so far. The respellings
 * touch disjoint characters and are idempotent, so this reaches the full
 * subset lattice without a fixpoint loop that could fail to terminate.
 */
function respell(base: string): Set<string> {
  const all = new Set<string>([base]);
  for (const t of RESPELLINGS) {
    for (const s of [...all]) all.add(t(s));
  }
  return all;
}

/** The two independent choices about the inherent vowel, as four bases. */
const BASE_FORMS: RomanOptions[] = [
  { dropInherent: false, dropFinal: false },
  { dropInherent: false, dropFinal: true },
  { dropInherent: true, dropFinal: false },
  { dropInherent: true, dropFinal: true },
];

/**
 * Every spelling a person might type for one Devanagari string, space-joined
 * and ready to be appended to a search haystack.
 *
 * Returns '' for anything with no Devanagari in it. A Latin name needs no
 * index: it is already searchable as itself, and a second copy would only
 * double the haystack.
 */
export function searchKey(s: string | null | undefined): string {
  if (!s || !hasDevanagari(String(s))) return '';

  const out = new Set<string>();
  for (const form of BASE_FORMS) {
    for (const spelling of respell(roman(s, form))) out.add(spelling);
  }
  return [...out].join(' ');
}
