// spec: 2026-08-25-prod-cutover-waves
//
// Remote fonts must never be able to block the first paint of an offline-first app.
// SUSPECTED (not proven) cause of slow/blank cold starts offline: a render-blocking
// <link rel="stylesheet"> to fonts.googleapis.com in <head>. This pins the fix:
// every remote stylesheet in index.html is non-blocking (media="print" + onload swap)
// and the font stacks keep a Devanagari-capable fallback.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
// Ignore comments and <noscript> (only parsed when JS is off, so it cannot block a JS app).
const live = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');

describe('index.html remote fonts', () => {
    const remoteSheets = [...live.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]
        .map(m => m[0])
        .filter(tag => /href=["']https?:\/\//i.test(tag));

    it('still loads the Google Fonts stylesheet', () => {
        expect(remoteSheets.some(t => t.includes('fonts.googleapis.com'))).toBe(true);
    });

    it('no remote stylesheet is render-blocking', () => {
        for (const tag of remoteSheets) {
            expect(tag).toMatch(/media=["']print["']/);
            expect(tag).toMatch(/onload=["']this\.media=['"]all['"]["']/);
        }
    });

    it('uses font-display: swap', () => {
        expect(html).toContain('display=swap');
    });

    it('keeps the Marathi family and a Devanagari fallback stack', () => {
        const theme = fs.readFileSync(path.resolve(__dirname, '../styles/global-theme.css'), 'utf8');
        expect(html).toContain('Noto+Sans+Devanagari');
        expect(theme).toMatch(/--font-sans:[^;]*'Noto Sans Devanagari'[^;]*sans-serif/);
        expect(theme).toMatch(/--font-serif:[^;]*'Noto Serif Devanagari'[^;]*serif/);
    });
});
