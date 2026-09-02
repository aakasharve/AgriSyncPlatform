/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import html from '../../../index.html?raw';

/**
 * CONTRACT TEST for the ONE token layer.
 *
 * Task 3 says "no component may introduce a raw hex value from here on" and
 * "light mode is locked". Both are promises about every task that follows,
 * and a promise nothing checks is a hope. This file is what checks them.
 *
 * globals.css is read from DISK rather than imported as `?raw`:
 * vitest.config.ts sets `css: false`, which stubs every css request to an
 * empty string — `?raw` included — so the import form silently yields '' and
 * every assertion here would then pass against nothing. That is exactly the
 * "gate that cannot fail" shape, which is why the length check below is not
 * decoration; it is the thing that makes the rest of the file mean anything.
 */
const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf-8');

it('read the real stylesheet — not an empty stub', () => {
  expect(css.length).toBeGreaterThan(2000);
  expect(css).toContain('@theme');
});

/** Every first-party source file, minus the tests — so a test asserting on a
 *  banned literal is not itself reported as containing one. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  ).filter(([path]) => !/\.test\.tsx?$/.test(path))
);

const PRIMITIVES = [
  '/src/components/ui/Button.tsx',
  '/src/components/ui/Card.tsx',
  '/src/components/ui/KpiCard.tsx',
];

/**
 * A rule is what a file DECLARES, not what its prose mentions.
 *
 * Every "must not contain" assertion below runs against comment-stripped
 * source. Without this, globals.css explaining that it carries no dark
 * variant would itself fail the test that says so — and the repair a hurried
 * reader reaches for is deleting the explanation. The C7 and C8 assertions
 * deliberately use the RAW text, because there the comment IS the artefact
 * under test.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const cssRules = css.replace(BLOCK_COMMENT, '');
const htmlMarkup = html.replace(/<!--[\s\S]*?-->/g, '');
const code = (path: string) =>
  (SOURCES[path] ?? '').replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');

describe('light mode is locked (D1, CONTRACT.md §8)', () => {
  it('declares no dark variant, no dark palette and no OS colour-scheme rule', () => {
    // Each of these is a different way the same bug gets back in.
    expect(cssRules).not.toContain('@custom-variant dark');
    expect(cssRules).not.toContain('prefers-color-scheme');
    expect(cssRules).not.toContain("data-mode='dark'");
    expect(cssRules).not.toContain('data-mode="dark"');
    expect(cssRules).not.toContain("data-theme='dark'");
  });

  it('drops the dusk palette with it (D2 — setTheme had zero callers)', () => {
    expect(cssRules).not.toContain('dusk');
    expect(htmlMarkup).not.toContain('data-theme');
  });

  it('pins color-scheme to light so the OS does not repaint form controls', () => {
    expect(cssRules).toContain('color-scheme: light');
  });

  it('has no ThemeProvider left to reintroduce it', () => {
    // A deleted file whose module still resolves is how a dropped feature
    // grows back. Assert on the module graph, not on an import list.
    expect(Object.keys(SOURCES)).not.toContain('/src/app/ThemeProvider.tsx');
  });
});

describe('the two product colour constraints carry their IDs (register A37)', () => {
  /*
   * The values are asserted WITH their constraint IDs because the reason has
   * to survive the person who knew it. Anyone raising the teal to a brighter
   * green has to first delete a comment that says, in words, not to.
   */
  it('C7 — a healthy pillar tops out at teal, never bright green', () => {
    expect(css).toContain('--color-pillar-good: #0e7d7b;');
    expect(css).toMatch(/C7[\s\S]{0,400}--color-pillar-good/);
    expect(css).toMatch(/C7[\s\S]{0,400}Do not raise this value/);
  });

  it('C8 — privileged ops panels carry a slate inset border', () => {
    expect(css).toContain('--color-ops-inset: rgba(100, 116, 139, 0.55);');
    expect(css).toMatch(/C8[\s\S]{0,400}--color-ops-inset/);
  });

  it('is the only place those two values are written', () => {
    // FOUR components inlined them, not the three the plan listed:
    // DwcScoreCard, AiHealthBlock, SyncStateBlock and FarmerHealthDrilldown.
    // A constraint with two homes has only one of them carrying the reason.
    const offenders = Object.keys(SOURCES).filter(
      (path) => code(path).includes('#0e7d7b') || code(path).includes('rgba(100, 116, 139, 0.55)')
    );
    expect(offenders).toEqual([]);
  });
});

describe('the v3 signal palette exists as tokens (CONTRACT.md §7.7)', () => {
  it.each([
    ['--color-blue', '#4f46e5'],
    ['--color-green', '#0f8a5f'],
    ['--color-red', '#e11d48'],
    ['--color-amber', '#b45309'],
    ['--color-text-3', '#8a9990'],
  ])('%s is %s', (token, value) => {
    expect(cssRules).toContain(`${token}: ${value};`);
  });
});

describe('two Latin faces, and the rule that says there should be one', () => {
  /*
   * 🛑 THIS ASSERTION USED TO READ "uses DM Sans for English and Noto Sans
   * Devanagari for Marathi", and it went red on 2026-09-02. It is rewritten
   * rather than relaxed, and what it now pins is the DIVERGENCE — so the
   * divergence cannot spread, and cannot be forgotten.
   *
   * Root `CLAUDE.md`: English, brand and numbers are DM Sans; Marathi is Noto
   * Sans Devanagari; `system-ui`, `Arial` and bare generics are never used for
   * visible text. The founder's instruction the same day was "change the font
   * make it more friendly to read", and one face cannot be both the brand
   * voice and the friendliest reading face.
   *
   * So the split is asserted, in both directions:
   *   the PROSE face may change  — that is the founder's call, one line;
   *   the DISPLAY face may NOT quietly stop being DM Sans;
   *   MARATHI MAY NOT MOVE AT ALL, and it must be in BOTH stacks, so a
   *   farmer's name resolves whichever face the surrounding text is in.
   */
  it('splits prose from display, and keeps DM Sans as the display face', () => {
    expect(cssRules).toContain("--font-sans: 'Nunito Sans', 'Noto Sans Devanagari', sans-serif;");
    expect(cssRules).toContain("--font-display: 'DM Sans', 'Noto Sans Devanagari', sans-serif;");
  });

  it('carries Noto Sans Devanagari in BOTH Latin stacks — Marathi never falls out', () => {
    for (const token of ['sans', 'display']) {
      const stack = new RegExp(`--font-${token}:\\s*([^;]+);`).exec(cssRules)?.[1] ?? '';
      expect(`${token} carries Devanagari: ${stack.includes("'Noto Sans Devanagari'")}`).toBe(
        `${token} carries Devanagari: true`
      );
    }
    expect(cssRules).toContain("--font-devanagari: 'Noto Sans Devanagari', sans-serif;");
  });

  it('LOADS all three — the `<link>`, not just the CSS', () => {
    /*
     * A stylesheet naming a face that was never fetched is a silent failure,
     * and this repo has already proved the shape: Task 6 deleted the
     * Devanagari face from index.html and 20 of 23 tests still passed,
     * because they asserted the CSS. So the tag is asserted, not the token.
     */
    expect(htmlMarkup).toContain('family=Nunito+Sans');
    expect(htmlMarkup).toContain('family=DM+Sans');
    expect(htmlMarkup).toContain('family=Noto+Sans+Devanagari');
  });

  it('says out loud, in the file, that it diverges from the project rule', () => {
    // Anyone dropping DM Sans altogether has to first delete the paragraph
    // saying this was a founder decision and how to undo it. Same device as
    // C7, C8 and §A.10.
    expect(css).toMatch(/§A\.1 type[\s\S]{0,600}DIVERGENCE FROM THE\s*\n\s*\*\s*PROJECT FONT RULE/i);
    expect(css).toMatch(/put DM Sans back at the head of `--font-sans`/);
  });

  it('never falls back to system-ui or Arial for visible text', () => {
    expect(cssRules).not.toContain('system-ui');
    expect(cssRules).not.toContain('Arial');
  });
});

describe('the console is no longer desktop-only by construction', () => {
  it('replaced the fixed 1280 viewport with device-width', () => {
    expect(htmlMarkup).not.toContain('width=1280');
    expect(htmlMarkup).toContain('content="width=device-width, initial-scale=1"');
  });
});

describe('quality floor (CONTRACT.md §10)', () => {
  it('honours prefers-reduced-motion for animation, transition and scrolling', () => {
    expect(cssRules).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssRules).toContain('scroll-behavior: auto !important');
  });

  it('prints without chrome and never splits a panel across a page break', () => {
    expect(cssRules).toContain('@media print');
    expect(cssRules).toContain('break-inside: avoid');
  });

  it('declares one focus ring — 2px indigo at 2px offset — and removes none', () => {
    expect(cssRules).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-blue\)/);
    expect(cssRules).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px/);
    // Killing the outline in a primitive is how a keyboard user loses the
    // console. The old Button did it and then rebuilt its own ring in teal.
    for (const path of PRIMITIVES) {
      expect(code(path)).not.toContain('outline-none');
    }
  });
});

describe('the glass layer, and the ban it reverses (§A.12, founder 2026-09-02)', () => {
  /*
   * 🛑 THIS DESCRIBE BLOCK USED TO ASSERT THE OPPOSITE, AND THAT IS WHY IT IS
   * WRITTEN OUT AT LENGTH RATHER THAN QUIETLY EDITED.
   *
   * Until 2026-09-02 it read `.glass-panel is deleted — it had zero
   * consumers`, and it belonged to a family of assertions enforcing
   * CONTRACT.md §8: *"Banned: … Glassmorphism, translucency, gradients."*
   * Task 27 named the last surviving glass panel as a LIVE VIOLATION on /403
   * and the aesthetic pass deleted it.
   *
   * THE FOUNDER THEN OVERRULED §8, in these words:
   *
   *     "the overall colour theme is too dark make it aesthetic and use the
   *      Glass morphism effect not theme to highlight the aesthetics and re
   *      design it all"
   *
   * That is his call: §8 is a design document, not a safety rule. So the old
   * assertions went red, correctly, and they were REWRITTEN IN THE SAME
   * COMMIT AS THE CODE rather than deleted — which is the whole difference
   * between a reversal and a silent weakening. What is below is not a smaller
   * test than what it replaces; it is a test of the thing that is now true,
   * and it is strictly harder to satisfy, because glass has a contrast floor
   * and a ban does not.
   *
   * The reversal is recorded in three places, and this file asserts the first
   * of them: globals.css §A.12, ledger entry C12, and the git history.
   */

  /** The v2 classes. Still gone, and their absence still matters: they came
   *  from the old console, they carried decorative gradients, and none of
   *  them is what §A.12 built. */
  const V2_GONE = ['glass', 'glass-kpi', 'glass-sidebar', 'nav-active'] as const;

  /** The seven §A.12 surfaces. Two-sided ON PURPOSE, exactly as the list
   *  they replace was: a class that is USED must be DEFINED (deleting it
   *  gives a console that builds green and renders unstyled, which no build
   *  gate catches), and a class that is DEFINED must be USED (leaving it
   *  behind gives dead CSS nobody dares touch, which is how the old §B
   *  reached 25 references). */
  const GLASS = [
    'glass-panel',
    'glass-float',
    'glass-chrome',
    'glass-nav',
    'glass-quiet',
    'glass-tile',
  ] as const;

  const KEPT = ['chip-fresh', 'chip-live', 'chip-mat'] as const;

  /**
   * WHY NOT A WORD-BOUNDARY ANCHOR. It reads as the obvious choice and it is
   * wrong here: a hyphen is a non-word character, so a word-boundary anchor
   * around `glass` matches inside `glass-panel`, and every "is it gone?"
   * assertion built on one passes while the class is still there. The
   * boundary that means "this whole class name and not a longer one" has to
   * exclude the hyphen explicitly.
   */
  const NOT_NAME_CHAR = '[A-Za-z0-9_-]';
  const exactly = (name: string) =>
    new RegExp(`(?<!${NOT_NAME_CHAR})${name}(?!${NOT_NAME_CHAR})`);

  it('carries the reversal in the stylesheet, in the founder’s own words', () => {
    // Anyone deleting the glass has to first delete the sentence recording
    // that a founder decision put it there — the same device the C7, C8 and
    // §A.10 assertions use. The RAW text, because here the comment IS the
    // artefact under test.
    expect(css).toMatch(/§A\.12[\s\S]{0,3000}REVERSES A BAN/i);
    expect(css).toContain('use the\n   *      Glass morphism effect');
    expect(css).toMatch(/§A\.12[\s\S]{0,4000}DECISION-LEDGER/);
  });

  it('states its contrast floor as a rule, not as a hope', () => {
    // The one constraint in this redesign that is not taste. If the sentence
    // goes, the next person to thin out an alpha has nothing telling them
    // what the alpha was for.
    expect(css).toMatch(/BODY TEXT ON ANY GLASS SURFACE HOLDS ≥ 4\.5:1/);
    expect(css).toMatch(/NO POINT ON THE PAGE IS DARKER THAN `--color-ground`/);
    expect(css).toMatch(/A\s*\n?\s*\*\s*text colour is never lowered to rescue a background/);
  });

  it.each(GLASS)('.%s is declared', (name) => {
    expect(cssRules).toContain(`.${name} {`);
  });

  it.each(GLASS)('.%s has at least one consumer', (name) => {
    const consumers = Object.keys(SOURCES).filter((path) => exactly(name).test(code(path)));
    expect(consumers.length).toBeGreaterThan(0);
  });

  it('every translucent surface declares a fill AND a backdrop-filter', () => {
    /*
     * A `backdrop-filter` with no fill is a blur with nothing to tint, and a
     * fill with no `backdrop-filter` is a flat pale rectangle. Either alone
     * is a broken pane, and neither fails a build. `glass-tile` is exempt and
     * named: it is the FRAME without the frost, for the KPI tile, which stays
     * opaque so the honesty tint cannot pick up the page behind it (§A.6).
     */
    /* `glass-quiet` is the one surface with NO shadow, and that is the
       design rather than an omission: it is a chip or an inset sitting ON a
       glass panel, so it is not above anything and a shadow would claim a
       height it does not have. Named here so the exception cannot spread. */
    for (const name of GLASS) {
      const rule = cssRules.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(`${name} has a shadow: ${rule.includes('box-shadow')}`).toBe(
        `${name} has a shadow: ${name !== 'glass-quiet'}`
      );
      if (name === 'glass-tile') {
        expect(`${name} frosts: ${rule.includes('backdrop-filter')}`).toBe(
          `${name} frosts: false`
        );
        continue;
      }
      expect(`${name} frosts: ${rule.includes('backdrop-filter')}`).toBe(`${name} frosts: true`);
      expect(`${name} has a fill: ${rule.includes('background-color: var(--color-')}`).toBe(
        `${name} has a fill: true`
      );
      // Both spellings, or Safari renders the console unfrosted and nothing
      // in the build says so.
      expect(rule).toContain('-webkit-backdrop-filter');
    }
  });

  it('no glass rule states a colour — chrome may not speak for data', () => {
    /*
     * The rule the whole token layer is organised around: colour on chrome
     * asserts nothing. A glass class that set `color` would be a chrome class
     * choosing the ink of whatever it wrapped, which is how an unmeasured
     * value ends up looking measured.
     */
    for (const name of GLASS) {
      const rule = cssRules.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(`${name} sets colour: ${/(^|[;{\s])color:/.test(rule)}`).toBe(
        `${name} sets colour: false`
      );
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('the honesty tint is not translucent — §A.6, and it is asserted', () => {
    // The one place the glass stops. A KPI tile floats its tint over the page
    // if this ever changes, and `--color-tint-grey` — the colour of "we did
    // not measure this" — would pick up whatever hue is behind it.
    for (const tint of ['blue', 'green', 'red', 'amber', 'grey']) {
      expect(cssRules).toMatch(new RegExp(`--color-tint-${tint}: #[0-9a-f]{6};`));
    }
    expect(cssRules).not.toMatch(/--color-tint-[a-z]+: rgba/);
  });

  it.each(V2_GONE)('the v2 class .%s is still deleted', (name) => {
    expect(cssRules).not.toMatch(exactly(`[.]${name}`));
  });

  it.each(V2_GONE)('the v2 class .%s is referenced by no source file', (name) => {
    const consumers = Object.keys(SOURCES).filter((path) => exactly(name).test(code(path)));
    expect(consumers).toEqual([]);
  });

  it.each(KEPT)('.%s is still defined, because it is still rendered', (name) => {
    expect(cssRules).toContain(`.${name} {`);
  });

  /*
   * The consumers, by name. If FreshnessChip is ever restyled, this list is
   * what tells the next person the classes may go — rather than a comment
   * claiming a number nobody re-counted.
   *
   * These three were listed for two years as a §8 disagreement needing the
   * founder: they are translucent `color-mix()` fills. HALF OF THAT OBJECTION
   * RETIRED WITH THE REVERSAL — translucency is the house style now. What
   * survives is the half that was always the real one: their green and their
   * teal state where a number came from, which is data colour, and no styling
   * pass restyles a colour that states a fact.
   */
  it('names every file still holding the three survivors alive', () => {
    const holders = (name: string) =>
      Object.keys(SOURCES)
        .filter((path) => exactly(name).test(code(path)))
        .sort();

    for (const name of KEPT) {
      expect(holders(name)).toEqual(['/src/components/ui/FreshnessChip.tsx']);
    }
  });

  /*
   * `--radius-kpi` went with `.glass-kpi` in Task 27; `--radius-card` was
   * read ONLY by the v2 `.glass-panel` and went with it. The NAME
   * `.glass-panel` came back on 2026-09-02; the TOKEN did not, and that is
   * the cleanest single proof that §A.12 is a new rule rather than the old
   * one restored. §A.9's `--radius-panel` is what the new class uses.
   */
  it('neither radius token came back with the name', () => {
    expect(cssRules).not.toContain('--radius-kpi');
    expect(cssRules).not.toContain('--radius-card');
    expect(cssRules).toContain('--radius-panel');
  });
});

describe('--font-mono outlived its deletion date, and says so (Task 27)', () => {
  /*
   * The token's own comment promised it would die with the last `font-mono`
   * caller in Task 27. It did not: seven ported files still use it 21 times.
   * That is a real disagreement between CONTRACT.md §8 and seven shipped
   * screens, and it is the founder's to settle — so the token stays and the
   * comment now states the measured count instead of a stale promise.
   *
   * This test exists so the token cannot be quietly deleted without those
   * seven files moving first, and cannot be quietly kept once they have.
   */
  const MONO_FILES = [
    '/src/features/farmer-health/components/FarmerSearchBox.tsx',
    '/src/features/farmer-health/FarmerHealthPage.tsx',
    '/src/pages/ForbiddenPage.tsx',
    '/src/pages/LoginPage.tsx',
    '/src/pages/ops/OpsErrorsPage.tsx',
    '/src/pages/schedules/ScheduleTemplatesPage.tsx',
  ];

  it('is still declared, because callers still exist', () => {
    expect(cssRules).toContain('--font-mono');
  });

  it('is used by exactly the files the comment names', () => {
    const users = Object.keys(SOURCES)
      .filter((path) => /(?<![A-Za-z0-9_-])font-mono(?![A-Za-z0-9_-])/.test(code(path)))
      .sort();
    expect(users).toEqual(MONO_FILES.sort());
  });
});

describe('no raw hex from here on', () => {
  it('the three v3 primitives contain none', () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    for (const path of PRIMITIVES) {
      expect(code(path)).not.toMatch(HEX);
    }
  });
});

describe('the ONE gradient: the chart gap hatch (CONTRACT.md §8, added Task 9)', () => {
  /*
   * §8 bans gradients outright with a single named exception: the hard-stop
   * 45° hatch that marks a period with no measurement. Its own words are "Do
   * not add a second one", which is a rule about every task that follows —
   * so it is asserted here, in the file that owns the stylesheet, rather than
   * left as a comment in a component.
   *
   * These assertions run against the stylesheet READ FROM DISK at the top of
   * this file, for the reason stated there: `css: false` would otherwise hand
   * every one of them an empty string to pass against.
   */
  it('exists, and is the only repeating gradient in the stylesheet', () => {
    const hatches = cssRules.match(/repeating-linear-gradient/g) ?? [];
    expect(hatches).toHaveLength(1);
    expect(cssRules).toContain('.chart-gap-hatch {');
  });

  it('is drawn from tokens — the honesty grey, never a literal', () => {
    const rule = cssRules.match(/\.chart-gap-hatch\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(rule).toContain('var(--color-tint-grey)');
    expect(rule).toContain('var(--color-page)');
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('carries its reason in the file, not in someone’s memory', () => {
    // Anyone deleting the exception has to first delete the sentence saying
    // what it encodes — the same device the C7 and C8 assertions use.
    // Anchored on the BANNER, not on the section number: §A.10 is also named
    // from inside §A.9 and §A.11, so a bare number anchor starts the window
    // in the wrong block and the assertion becomes a distance measurement.
    expect(css).toMatch(/THE ONE HATCH IN THIS STYLESHEET[\s\S]{0,1600}DATA ENCODING/i);
    expect(css).toMatch(/THE ONE HATCH IN THIS STYLESHEET[\s\S]{0,1600}Do not add a second one/i);
  });

  it('is still the only REPEATING one, now that the ground has three radial', () => {
    /*
     * §8 banned gradients outright and the founder's reversal retired that
     * ban: the luminous page ground is three `radial-gradient` blooms. The
     * distinction the console actually depends on survived it — the blooms
     * are CHROME and assert nothing, this hatch is a DATA ENCODING and
     * asserts that a period was never measured. So the count that matters is
     * the repeating one, and it is still exactly one.
     */
    expect((cssRules.match(/radial-gradient/g) ?? []).length).toBe(3);
    expect((cssRules.match(/repeating-linear-gradient/g) ?? []).length).toBe(1);
  });

  it('no component hand-rolls its own hatch', () => {
    const offenders = Object.keys(SOURCES).filter((path) =>
      code(path).includes('repeating-linear-gradient')
    );
    expect(offenders).toEqual([]);
  });
});

describe('no dark: utility survives anywhere (D1)', () => {
  /*
   * THIS IS NOT COSMETIC AND IT IS NOT DEFERRABLE.
   *
   * Deleting `@custom-variant dark` does NOT neutralise a leftover `dark:`
   * class — it hands it back to Tailwind v4's BUILT-IN dark variant, which is
   * `@media (prefers-color-scheme: dark)`. Six of them were left behind
   * mid-task and the compiled stylesheet grew a live OS-driven dark rule,
   * measured in dist. That is the exact rule CONTRACT.md §8 bans and the
   * exact bug the v2 console had.
   *
   * So the two halves of D1 are one change: the variant goes and every
   * utility that depended on it goes in the same commit. There is no
   * scheduled-for-later list here, because a scheduled list would have meant
   * shipping a console that repaints itself dark on a dark-themed laptop.
   */
  it('leaves no dark: class in any source file, and none in the stylesheet', () => {
    expect(Object.keys(SOURCES).filter((path) => code(path).includes('dark:'))).toEqual([]);
    expect(cssRules).not.toContain('dark:');
  });
});
