import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE PRODUCT IS SHRAM SAFAL.
 *
 * This console lives at admin.shramsafal.in and it named itself "AgriSync" —
 * the platform behind the product — until 2026-09-02, when the founder asked
 * for the real name and mark.
 *
 * Two things are pinned here, and the second is the one that matters.
 */

const root = resolve(__dirname, '../..');
const read = (rel: string) => {
  const text = readFileSync(resolve(root, rel), 'utf8');
  // vitest runs with `css: false`, and a `?raw` import of anything it decides is
  // an asset comes back as an empty string. Task 3 lost ~20 assertions to that
  // before anyone noticed, so every disk read on this branch opens with a
  // length check rather than trusting the read.
  expect(text.length, `${rel} read back empty`).toBeGreaterThan(200);
  return text;
};

const SURFACES = [
  ['the sidebar, on every screen', 'src/app/AdminShell.tsx'],
  ['the sign-in screen', 'src/pages/LoginPage.tsx'],
  ['the Home masthead', 'src/pages/HomePage.tsx'],
] as const;

describe('the console names itself Shram Safal', () => {
  /**
   * THE WORDMARK IS THE ARTWORK, NOT TYPED TEXT.
   *
   * This briefly shipped as two coloured spans — a typed approximation of the
   * logo. The founder asked for it exactly as the asset draws it, and the real
   * mark is italic, gradient-filled and kerned as artwork. Two flat hexes
   * cannot reproduce that, and an approximation of a logo is worse than none.
   *
   * The consequence a test has to hold: an IMAGE of a name is silent. The
   * `alt` is the only thing a screen reader gets, so it is the accessible name
   * and it must be the name — never empty, never "logo".
   */
  it.each(SURFACES)('%s draws the wordmark from the asset', (_where, file) => {
    const src = read(file);
    expect(src).toMatch(/\/brand\/logo-(text|full)\.webp/);
    expect(src).not.toMatch(/AgriSync Admin|>AgriSync</);
  });

  it.each(SURFACES)('%s gives the wordmark image the name as its alt', (_where, file) => {
    const src = read(file);
    const block = src.slice(src.search(/\/brand\/logo-(text|full)\.webp/));
    expect(block.slice(0, 400)).toContain('alt="Shram Safal"');
  });

  it('no surface types the name where the artwork belongs', () => {
    for (const [, file] of SURFACES) {
      const src = read(file);
      expect(src, `${file} still types the wordmark`).not.toContain('text-word-shram');
    }
    // The declaration, not the word: the comment explaining why the token
    // was retired names it on purpose, and that comment is the point.
    expect(read('src/styles/globals.css')).not.toMatch(/--color-word-shram:\s*#/);
  });

  it('the browser tab says it too', () => {
    expect(read('index.html')).toContain('<title>Shram Safal Admin</title>');
  });
});

describe('the hero moves, and stops moving when asked to', () => {
  /**
   * A console an operator reads all day must not tug at the eye. The hero is
   * allowed to move for one reason only: the global reduced-motion block
   * flattens it. If that block is ever narrowed, the animation stops being
   * acceptable and this test is what says so.
   */
  it('flattens every animation under prefers-reduced-motion', () => {
    const css = read('src/styles/globals.css');
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at, 'the reduced-motion block is gone').toBeGreaterThan(-1);
    const block = css.slice(at, at + 400);
    // It must reach EVERY element, not a named list — an animation added later
    // would otherwise keep running for someone who asked for stillness.
    expect(block).toMatch(/\*,/);
    expect(block).toContain('animation-duration: 0.001ms !important');
  });

  it('the halo sits under the mark and behind no text', () => {
    // The one property that keeps a decorative tint from becoming a contrast
    // problem: nothing readable is drawn on top of it.
    const src = read('src/pages/HomePage.tsx');
    expect(src).toContain('brand-hero-halo');
    expect(src).toContain('aria-hidden="true"');
    expect(src).toMatch(/-z-10/);
  });

  it('the float is gentle — a hero that travels far is a distraction', () => {
    const css = read('src/styles/globals.css');
    const at = css.indexOf('@keyframes brand-float');
    expect(at).toBeGreaterThan(-1);
    const frames = css.slice(at, at + 220);
    const px = Number(/translateY\(-(\d+)px\)/.exec(frames)?.[1] ?? 999);
    expect(px, 'the hero should drift, not bounce').toBeLessThanOrEqual(14);
  });
});

describe('the mark keeps the ground that makes it legible', () => {
  /**
   * `logo-mark.webp` is a GREEN shield with a DARK GREEN outline.
   *
   * mobile-web's FarmNameBoard records what happens without a disc behind it:
   * on a green ground the outline vanished and the farmer saw a smudge. The
   * founder caught that on the built screen, and the fix was a cream disc with
   * a brass ring.
   *
   * Every plane this console puts the mark on is greenish — the frosted mint
   * sidebar, the mint login hero, the mint page bloom behind Home. So the
   * hazard is identical and the disc travels with the mark.
   *
   * This test exists because the disc looks like decoration in a diff. It is
   * not. Deleting it does not break a layout or a type-check; it just makes
   * the logo disappear, on the three surfaces a reader sees most.
   */
  // Only the surfaces that draw the BARE shield need the disc. Home uses
  // `logo-full.webp`, whose own lockup already separates the shield from the
  // ground — and boxing the full lockup would crop the wordmark.
  const BARE_MARK = SURFACES.filter(([, f]) => f !== 'src/pages/HomePage.tsx');

  it.each(BARE_MARK)('%s puts the bare mark on the cream disc, not straight on the plane', (_where, file) => {
    const src = read(file);
    expect(src).toContain('/brand/logo-mark.webp');
    expect(src).toContain('var(--color-mark-disc)');
    expect(src).toContain('var(--color-mark-ring)');
  });

  it('both disc tokens are declared, so no surface hand-rolls the colour', () => {
    const css = read('src/styles/globals.css');
    expect(css).toMatch(/--color-mark-disc:\s*#fbf5ec/i);
    expect(css).toMatch(/--color-mark-ring:\s*#d9b45b/i);
  });

  it('the bare shield is decorative — the wordmark beside it carries the name', () => {
    // A screen reader hearing the brand twice is noise. Where both images sit
    // together, the shield is aria-hidden with an empty alt and the WORDMARK
    // holds `alt="Shram Safal"`. Home draws one combined lockup instead, so it
    // has no bare shield to hide.
    for (const [, file] of BARE_MARK) {
      const src = read(file);
      const marks = src.split('/brand/logo-mark.webp').length - 1;
      expect(marks, `${file} should render the bare shield`).toBeGreaterThan(0);
      expect(src).toContain('aria-hidden="true"');
    }
  });
});
