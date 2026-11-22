/**
 * FEEL-1 — the press-feedback CSS contract.
 *
 * The press shrink is plain CSS in `index.css`, which jsdom cannot paint, so this reads the stylesheet text and pins the
 * promises made about it: one token, inside the 80-120 ms and ~0.97 range, applied with the `scale` property (so it composes
 * with a control's own transform), switched off for reduced motion, and kept off disabled / hidden / opted-out controls.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const start = css.indexOf('FEEL-1 - press feedback');
const end = css.indexOf('/* Global Body Style Upgrade */');
const feel = stripComments(css.slice(start, end));

describe('press feedback CSS (index.css)', () => {
    it('the FEEL-1 block exists before the body styles', () => {
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
    });

    it('defines the token once: 97% over 100 ms', () => {
        expect(feel.match(/--press-scale:\s*0\.97;/g)).toHaveLength(1);
        const ms = feel.match(/--press-ms:\s*(\d+)ms;/);
        expect(ms).not.toBeNull();
        expect(Number(ms![1])).toBeGreaterThanOrEqual(80);
        expect(Number(ms![1])).toBeLessThanOrEqual(120);
    });

    it('moves the control with the scale property and never with transform', () => {
        expect(feel).toContain('scale: var(--press-scale)');
        expect(feel).not.toMatch(/(^|[;{\s])transform\s*:/);
    });

    it('gives every real button, tab and summary the press, and anything else via .press-feel', () => {
        expect(feel).toMatch(/:where\(button, \[role="button"\], \[role="tab"\], summary\)/);
        expect(feel).toContain('.press-feel');
    });

    it('keeps disabled, aria-disabled, aria-hidden, opted-out and own-Tailwind-active controls still', () => {
        for (const guard of [':disabled', '[aria-disabled="true"]', '[aria-hidden="true"]', '[data-press="off"]', '[class*="active:scale"]']) {
            expect(feel, `missing guard ${guard}`).toContain(guard);
        }
    });

    it('sits in the base layer so any Tailwind class on a control wins over it', () => {
        expect(feel).toMatch(/@layer base\s*\{[\s\S]*:where\(button/);
    });

    it('turns the shrink and its transition off for a person who prefers reduced motion', () => {
        const media = feel.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
        expect(media).not.toBeNull();
        expect(media![1]).toContain('.press-feel:active');
        expect(media![1]).toMatch(/scale:\s*none/);
        expect(media![1]).toMatch(/transition:\s*none/);
    });
});
