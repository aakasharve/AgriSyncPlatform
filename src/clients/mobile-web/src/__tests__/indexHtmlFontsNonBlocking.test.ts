// @vitest-environment jsdom
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
// Parse as HTML (comments are comment nodes; <noscript> content only applies when JS is
// off, so it cannot block a JS app and is excluded via closest()).
const doc = new DOMParser().parseFromString(html, 'text/html');

const remoteSheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).filter(link => {
    if (link.closest('noscript')) return false;
    const href = link.getAttribute('href') ?? '';
    try {
        const url = new URL(href);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
});

describe('index.html remote fonts', () => {
    it('still loads the Google Fonts stylesheet', () => {
        const hosts = remoteSheets.map(link => new URL(link.getAttribute('href') ?? '').hostname);
        expect(hosts).toContain('fonts.googleapis.com');
    });

    it('no remote stylesheet is render-blocking', () => {
        for (const link of remoteSheets) {
            expect(link.getAttribute('media')).toBe('print');
            expect(link.getAttribute('onload')).toMatch(/this\.media\s*=\s*['"]all['"]/);
        }
    });

    it('uses font-display: swap', () => {
        const hrefs = remoteSheets.map(link => new URL(link.getAttribute('href') ?? ''));
        expect(hrefs.some(url => url.searchParams.get('display') === 'swap')).toBe(true);
    });

    it('keeps the Marathi family and a Devanagari fallback stack', () => {
        const theme = fs.readFileSync(path.resolve(__dirname, '../styles/global-theme.css'), 'utf8');
        const families = remoteSheets.flatMap(link => new URL(link.getAttribute('href') ?? '').searchParams.getAll('family'));
        expect(families.some(f => f.startsWith('Noto Sans Devanagari'))).toBe(true);
        expect(theme).toMatch(/--font-sans:[^;]*'Noto Sans Devanagari'[^;]*sans-serif/);
        expect(theme).toMatch(/--font-serif:[^;]*'Noto Serif Devanagari'[^;]*serif/);
    });
});
