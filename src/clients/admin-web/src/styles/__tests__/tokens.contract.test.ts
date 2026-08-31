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

describe('fonts follow the charter, not the prototype', () => {
  it('uses DM Sans for English and Noto Sans Devanagari for Marathi', () => {
    // Non-negotiable project rule. The v3 mock is drawn in IBM Plex; a mock
    // does not get to overrule the charter.
    expect(cssRules).toContain("--font-sans: 'DM Sans', 'Noto Sans Devanagari', sans-serif;");
    expect(htmlMarkup).toContain('family=DM+Sans');
    expect(htmlMarkup).toContain('family=Noto+Sans+Devanagari');
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

describe('SEQUENCING — the legacy glass layer stays until Task 27', () => {
  /*
   * 19 files still render these classes (25 references). Deleting them before
   * those files are ported gives a console that builds green and renders
   * unstyled, which no build gate catches. Task 27 deletes the block after
   * the last consumer moves; until then these assertions are the guard rail.
   */
  it.each([
    '.glass',
    '.glass-panel',
    '.glass-kpi',
    '.glass-sidebar',
    '.chip-fresh',
    '.chip-live',
    '.chip-mat',
    '.nav-active',
  ])('%s is still defined', (cls) => {
    expect(cssRules).toContain(`${cls} {`);
  });

  it('and is still referenced by unported screens', () => {
    const pattern =
      /\b(glass|glass-panel|glass-kpi|glass-sidebar|chip-fresh|chip-live|chip-mat|nav-active)\b/;
    const consumers = Object.keys(SOURCES).filter((path) => pattern.test(code(path)));
    // If this ever reaches zero the port is finished, and the block above
    // should be deleted rather than left behind as dead CSS.
    expect(consumers.length).toBeGreaterThan(0);
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
    expect(css).toMatch(/§A\.10[\s\S]{0,1200}data encoding/i);
    expect(css).toMatch(/§A\.10[\s\S]{0,1600}Do not add a second one/i);
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
