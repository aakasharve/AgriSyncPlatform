/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PersonName } from '@/components/ui/PersonName';
import { REDACTED } from '@/components/state/redaction';

/**
 * THE FONT RULE, WITH TEETH — and the redaction rule with it.
 *
 * The v3 prototype is drawn in English with Latin sample names, so a port that
 * drops the Devanagari script check reviews as perfect and ships wrong: a
 * farmer's name renders in a face never designed for the script. Nothing in a
 * mockup can catch that, so this file does.
 */

/* Read from DISK, not through an import. `vitest.config.ts` sets `css: false`,
   which stubs every css request — `?raw` included — to an empty string, so the
   import form would silently yield '' and every assertion below would pass
   against nothing. The length checks are what make the rest of this file mean
   something; they are not decoration. */
const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf-8');
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

it('read the real stylesheet and the real index.html — not empty stubs', () => {
  expect(css.length).toBeGreaterThan(2000);
  expect(css).toContain('@theme');
  expect(html.length).toBeGreaterThan(500);
  expect(html).toContain('<html');
});

/** jsdom is free to re-quote a font stack, so compare on the names, not the
 *  punctuation. `'DM Sans', sans-serif` -> `DM Sans, sans-serif`. */
const faces = (s: string) => s.replace(/["']/g, '').replace(/\s+/g, ' ').trim();

/** The value of a `--font-*` token as the token layer declares it. */
function fontToken(name: string): string {
  const match = new RegExp(`--font-${name}:\\s*([^;]+);`).exec(css);
  expect(match, `--font-${name} is missing from globals.css`).not.toBeNull();
  return match![1].trim();
}

describe('STEP 3 — the Devanagari face is actually LOADED, not merely asked for', () => {
  /**
   * The component asking for 'Noto Sans Devanagari' proves nothing on its own.
   * If index.html does not fetch the face, the browser falls back to a Latin
   * face and every other test in this file still passes — the exact shape of a
   * gate that cannot fail.
   *
   * Task 3 already set the chrome face to DM Sans (a deliberate deviation from
   * the prototype's IBM Plex, per the project font rule) and loaded Noto Sans
   * Devanagari alongside it. This locks that in.
   */
  it('index.html requests the Noto Sans Devanagari webfont', () => {
    expect(html).toContain('family=Noto+Sans+Devanagari');
  });

  it('index.html requests DM Sans for English, brand and numbers', () => {
    expect(html).toContain('family=DM+Sans');
  });

  it('loads both faces from a real stylesheet link, not a bare preconnect', () => {
    // A `preconnect` opens a socket and fetches nothing. Only a
    // `rel="stylesheet"` link actually brings the face down.
    const fontLink = (html.match(/<link\b[^>]*>/g) ?? []).find((l) =>
      l.includes('fonts.googleapis.com/css2')
    );

    expect(fontLink, 'no fonts.googleapis.com css2 link in index.html').toBeDefined();
    expect(fontLink!).toContain('rel="stylesheet"');
    expect(fontLink!).toContain('Noto+Sans+Devanagari');
    expect(fontLink!).toContain('DM+Sans');
  });

  it('requests the weights PersonName can render at', () => {
    // font-semibold (600) is what all four call sites this replaces use for a
    // name. A weight that is not fetched is synthesised by the browser, which
    // is the same silent-wrong-face failure one step down.
    const link = /family=Noto\+Sans\+Devanagari:wght@([0-9;]+)/.exec(html);
    expect(link, 'Noto Sans Devanagari is loaded without explicit weights').not.toBeNull();
    expect(link![1].split(';')).toEqual(expect.arrayContaining(['400', '600']));
  });
});

describe('a name renders in the face its script was designed for', () => {
  it('renders a Devanagari name in the Devanagari face', () => {
    render(<PersonName name="कांबळे" />);
    const el = screen.getByText('कांबळे');

    expect(el).toHaveAttribute('data-script', 'devanagari');
    expect(faces(el.style.fontFamily)).toBe(faces(fontToken('devanagari')));
    expect(faces(el.style.fontFamily).startsWith('Noto Sans Devanagari')).toBe(true);
  });

  it('renders a Latin name in DM Sans', () => {
    render(<PersonName name="Ramesh Patil" />);
    const el = screen.getByText('Ramesh Patil');

    expect(el).toHaveAttribute('data-script', 'latin');
    expect(faces(el.style.fontFamily).startsWith('DM Sans')).toBe(true);
  });

  it('treats a mixed name as Devanagari — one such character decides it', () => {
    render(<PersonName name="Farm 12 कांबळे" />);
    expect(screen.getByText('Farm 12 कांबळे')).toHaveAttribute('data-script', 'devanagari');
  });

  it.each([['कांबळे'], ['Ramesh Patil'], ['']])(
    'never falls back to system-ui, Arial or a bare generic for %s',
    (name) => {
      const { container } = render(<PersonName name={name} fallback="FARM-42" />);
      const stack = faces((container.querySelector('[data-script]') as HTMLElement).style.fontFamily);

      expect(stack).not.toContain('system-ui');
      expect(stack).not.toContain('Arial');
      // A named face must come FIRST; sans-serif is only the tail.
      expect(stack.startsWith('sans-serif')).toBe(false);
      expect(stack).toMatch(/^(Noto Sans Devanagari|DM Sans),/);
    }
  );

  it('uses the same literals the token layer declares — no drift', () => {
    // If someone edits --font-devanagari in globals.css and forgets this
    // component, that is a split font rule and this test is where it surfaces.
    render(<PersonName name="वाघ" />);
    expect(faces(screen.getByText('वाघ').style.fontFamily)).toBe(faces(fontToken('devanagari')));
    // --font-sans leads with DM Sans; PersonName's Latin stack is that head.
    expect(faces(fontToken('sans')).startsWith('DM Sans')).toBe(true);
  });
});

describe('a withheld name goes through Masked — the marker is never printed', () => {
  it('shows the fallback instead of the literal redaction marker', () => {
    const { container } = render(<PersonName name={REDACTED} fallback="FARM-42" />);

    expect(screen.getByText('FARM-42')).toBeInTheDocument();
    expect(container.textContent).not.toContain(REDACTED);
    expect(container.textContent).not.toContain('redacted');
  });

  it('routes through Masked rather than re-implementing it', () => {
    // `data-masked` is Masked's own contract (Task 5). Asserting on it proves
    // the component delegates instead of carrying a second copy of the rule.
    const { container } = render(<PersonName name={REDACTED} fallback="FARM-42" />);
    expect(container.querySelector('[data-masked="redacted"]')).not.toBeNull();
  });

  it('says the value is HIDDEN, not missing, when there is no fallback', () => {
    /**
     * The distinction this protects: "there is no name" and "you may not see
     * this name" are different facts and must not become the same character.
     *
     * `PersonName` therefore does NOT default `fallback` to an em dash — a
     * truthy fallback makes Masked print it and this affordance unreachable.
     * The plan's sketch had that default; it is the one thing changed from it.
     */
    const { container } = render(<PersonName name={REDACTED} />);

    expect(screen.getByText('hidden')).toBeInTheDocument();
    expect(container.textContent).not.toContain(REDACTED);
  });

  it('does not confuse a hidden name with an absent one', () => {
    const hidden = render(<PersonName name={REDACTED} />).container.textContent;
    const absent = render(<PersonName name={null} />).container.textContent;

    expect(hidden).not.toBe(absent);
  });

  it('shows a PARTLY masked name as sent — it is still usable on a call', () => {
    // Only the exact marker is a full redaction. `98******12` keeps its last
    // two digits, which an operator can match against a farmer on the phone.
    render(<PersonName name="98******12" />);
    expect(screen.getByText('98******12')).toBeInTheDocument();
  });
});

describe('an absent name falls back without inventing one', () => {
  it.each([[null], [undefined], [''], ['   ']])('%s renders the fallback', (name) => {
    render(<PersonName name={name} fallback="FARM-42" />);
    expect(screen.getByText('FARM-42')).toBeInTheDocument();
  });

  it('defaults to an em dash when the caller gives no fallback', () => {
    const { container } = render(<PersonName name={null} />);
    expect(container.textContent).toBe('—');
  });

  it('passes className through so a caller can size and weight the name', () => {
    render(<PersonName name="कांबळे" className="font-semibold" />);
    expect(screen.getByText('कांबळे')).toHaveClass('font-semibold');
  });
});
