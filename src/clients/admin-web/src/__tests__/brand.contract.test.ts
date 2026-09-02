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
  it.each(SURFACES)('%s carries the name, not the platform name', (_where, file) => {
    const src = read(file);
    // The wordmark is two-tone, so the name is two spans rather than one string.
    expect(src).toContain('>Shram</span>');
    expect(src).toContain('>Safal</span>');
    expect(src).not.toMatch(/AgriSync Admin|>AgriSync</);
  });

  it.each(SURFACES)('%s tints the wordmark green-then-blue', (_where, file) => {
    const src = read(file);
    expect(src).toContain('text-word-shram');
    expect(src).toContain('text-word-safal');
  });

  it('the browser tab says it too', () => {
    expect(read('index.html')).toContain('<title>Shram Safal Admin</title>');
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
  it.each(SURFACES)('%s puts the mark on the cream disc, not straight on the plane', (_where, file) => {
    const src = read(file);
    expect(src).toContain('/brand/logo-mark.webp');
    expect(src).toContain('var(--color-mark-disc)');
    expect(src).toContain('var(--color-mark-ring)');
  });

  /**
   * THE BLUE IS THE DARKEST ONE A READER CAN READ, AND THAT IS THE POINT.
   *
   * The founder asked for the brand's blue and green. The brand blue is
   * #0EA5E9 (marketing `--farm-sky`) — and measured against the two backdrops
   * this wordmark actually sits on it reads **2.27:1** on the frosted mint
   * plane and **2.73:1** on a glass panel. AA wants 4.5:1 for text. At that
   * ratio it is a graphic, not a word.
   *
   * #0369A1 is the next step down the same sky ramp: 4.86:1 and 5.85:1. Same
   * blue, legible. This test exists so nobody "restores the real brand blue"
   * and quietly makes the product's own name unreadable.
   */
  it('the wordmark blue is the legible step of the sky ramp, not the bright one', () => {
    const css = read('src/styles/globals.css');
    expect(css).toMatch(/--color-word-shram:\s*#0f3d22/i);
    expect(css).toMatch(/--color-word-safal:\s*#0369a1/i);
    expect(css).not.toMatch(/--color-word-safal:\s*#0ea5e9/i);
  });

  it('both disc tokens are declared, so no surface hand-rolls the colour', () => {
    const css = read('src/styles/globals.css');
    expect(css).toMatch(/--color-mark-disc:\s*#fbf5ec/i);
    expect(css).toMatch(/--color-mark-ring:\s*#d9b45b/i);
  });

  it('the mark is decorative in markup — the name beside it is what is read aloud', () => {
    // A screen reader hearing "logo" twice is noise; the visible text is the
    // accessible name. Every img carrying the mark is aria-hidden with an
    // empty alt, and the name sits beside it as real text.
    for (const [, file] of SURFACES) {
      const src = read(file);
      const marks = src.split('/brand/logo-mark.webp').length - 1;
      expect(marks, `${file} should render the mark`).toBeGreaterThan(0);
      expect(src).toContain('aria-hidden="true"');
    }
  });
});
