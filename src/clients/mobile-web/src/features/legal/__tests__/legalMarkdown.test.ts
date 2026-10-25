// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 (AC8)
//
// Authored by test-writer from the spec alone.
//
// The Terms and the Privacy Notice open INSIDE the consent sheet, from the markdown files
// bundled in the APK, so they work offline and never unload the page (which would drop the
// pre-registration session). Two things are pinned:
//   • parseLegalMarkdown turns those files into plain blocks — no HTML comment, no `**`,
//     no backtick and no table separator row ever reaches a farmer's screen;
//   • LegalDocumentView never shows a blank: it shows the document, or says it could not
//     load and offers a retry that actually refetches.
//
// This file is `.ts` (as named in the hand-off), so the component is rendered with
// React.createElement rather than JSX.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LegalDocumentView may use the app's `t` for its chrome (loading / failed / retry).
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t: translate } = await import('../../../i18n/translations');
    const value = {
        language: 'mr' as const,
        setLanguage: () => undefined,
        t: (key: string) => translate(key, 'mr'),
    };
    return {
        useLanguage: () => value,
        useOptionalLanguage: () => value,
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

import { parseLegalMarkdown, type LegalBlock } from '../legalMarkdown';
import * as LegalDocumentViewModule from '../LegalDocumentView';

type ViewProps = { doc: 'terms' | 'privacy'; language: 'mr' | 'en' };
type ViewComponent = React.FC<ViewProps>;
// The spec names the component, not the export form; accept either.
const viewExports = LegalDocumentViewModule as unknown as { default?: ViewComponent; LegalDocumentView?: ViewComponent };
const LegalDocumentView = (viewExports.default ?? viewExports.LegalDocumentView) as ViewComponent;

const LEGAL_DIR = resolve(__dirname, '../../../../public/legal');
const readDoc = (name: string): string => readFileSync(resolve(LEGAL_DIR, name), 'utf8');

/** Every piece of text a block would put on screen. */
function blockTexts(blocks: LegalBlock[]): string[] {
    return blocks.flatMap((b): string[] => {
        switch (b.kind) {
            case 'list': return b.items;
            case 'table': return b.rows.flat();
            case 'rule': return [];
            default: return [b.text];
        }
    });
}

const textOf = (b: LegalBlock | undefined): string | undefined =>
    b && 'text' in b ? b.text : undefined;

// ─────────────────────────────────────────────────────────────────────────────────────
describe('parseLegalMarkdown — block shapes', () => {
    it('returns no blocks for an empty document', () => {
        expect(parseLegalMarkdown('')).toEqual([]);
        expect(parseLegalMarkdown('\n\n   \n')).toEqual([]);
    });

    it('reads h1 / h2 / h3', () => {
        expect(parseLegalMarkdown('# One\n\n## Two\n\n### Three')).toEqual([
            { kind: 'h1', text: 'One' },
            { kind: 'h2', text: 'Two' },
            { kind: 'h3', text: 'Three' },
        ]);
    });

    it('reads a paragraph', () => {
        expect(parseLegalMarkdown('Just a sentence.')).toEqual([{ kind: 'p', text: 'Just a sentence.' }]);
    });

    it('joins wrapped lines into one paragraph and splits paragraphs on a blank line', () => {
        const blocks = parseLegalMarkdown('line one\nline two\n\nsecond para');
        expect(blocks.map((b) => b.kind)).toEqual(['p', 'p']);
        expect(textOf(blocks[0])).toMatch(/^line one\s+line two$/);
        expect(textOf(blocks[1])).toBe('second para');
    });

    it('reads a block quote', () => {
        expect(parseLegalMarkdown('> quoted words')).toEqual([{ kind: 'quote', text: 'quoted words' }]);
    });

    it('reads a bullet list into one list block', () => {
        expect(parseLegalMarkdown('- first\n- second\n- third')).toEqual([
            { kind: 'list', items: ['first', 'second', 'third'] },
        ]);
    });

    it('reads a horizontal rule', () => {
        expect(parseLegalMarkdown('above\n\n---\n\nbelow')).toEqual([
            { kind: 'p', text: 'above' },
            { kind: 'rule' },
            { kind: 'p', text: 'below' },
        ]);
    });

    it('reads a table, trims cells and drops the separator row', () => {
        const md = '| What | Why |\n|---|---|\n| Account | Sign in |\n| Farm | Records |';
        expect(parseLegalMarkdown(md)).toEqual([
            { kind: 'table', rows: [['What', 'Why'], ['Account', 'Sign in'], ['Farm', 'Records']] },
        ]);
    });

    it('drops an aligned separator row too', () => {
        const md = '| A | B |\n| :--- | ---: |\n| 1 | 2 |';
        expect(parseLegalMarkdown(md)).toEqual([{ kind: 'table', rows: [['A', 'B'], ['1', '2']] }]);
    });
});

describe('parseLegalMarkdown — what never reaches the screen', () => {
    it('strips a one-line HTML comment', () => {
        const blocks = parseLegalMarkdown('<!-- spec: internal -->\n\n# Title');
        expect(blocks).toEqual([{ kind: 'h1', text: 'Title' }]);
    });

    it('strips a multi-line HTML comment entirely', () => {
        const blocks = parseLegalMarkdown('<!--\n  note to the lawyer\n  do not fill in\n-->\n\nVisible text.');
        expect(blocks).toEqual([{ kind: 'p', text: 'Visible text.' }]);
    });

    it('strips ** and backticks inside paragraphs, headings, quotes, list items and table cells', () => {
        const md = [
            '# **Bold** heading',
            '',
            '**Version `terms-2026-08-17.1` · from today**',
            '',
            '> **Draft.** Not yet `reviewed`.',
            '',
            '- **one** item',
            '',
            '| **Your account** | `code` cell |',
            '|---|---|',
            '| a | b |',
        ].join('\n');
        const blocks = parseLegalMarkdown(md);

        expect(blocks[0]).toEqual({ kind: 'h1', text: 'Bold heading' });
        expect(blocks[1]).toEqual({ kind: 'p', text: 'Version terms-2026-08-17.1 · from today' });
        expect(blocks[2]).toEqual({ kind: 'quote', text: 'Draft. Not yet reviewed.' });
        expect(blocks[3]).toEqual({ kind: 'list', items: ['one item'] });
        expect(blocks[4]).toEqual({ kind: 'table', rows: [['Your account', 'code cell'], ['a', 'b']] });
        for (const text of blockTexts(blocks)) {
            expect(text).not.toContain('**');
            expect(text).not.toContain('`');
        }
    });
});

describe('parseLegalMarkdown — the real documents bundled in the APK', () => {
    const FILES = ['terms_mr.md', 'terms_en.md', 'privacy_mr.md', 'privacy_en.md'] as const;

    it('terms_mr.md opens with its h1 and carries no comment, ** or backtick', () => {
        const blocks = parseLegalMarkdown(readDoc('terms_mr.md'));
        const first = blocks.find((b) => b.kind === 'h1');
        expect(textOf(first)).toBe('वापराच्या अटी — श्रम सफल');
        expect(blocks.some((b) => b.kind === 'h2')).toBe(true);

        const all = blockTexts(blocks).join('\n');
        expect(all).not.toContain('<!--');
        expect(all).not.toContain('-->');
        expect(all).not.toContain('**');
        expect(all).not.toContain('`');
        // A sentence that only exists inside the file's leading HTML comment.
        expect(all).not.toContain('वकिलाला सांगा');
    });

    it.each(FILES)('%s parses to non-empty blocks with an h1 and no markup residue', (name) => {
        const blocks = parseLegalMarkdown(readDoc(name));
        expect(blocks.length).toBeGreaterThan(5);
        expect(blocks.some((b) => b.kind === 'h1')).toBe(true);
        const all = blockTexts(blocks).join('\n');
        expect(all).not.toContain('<!--');
        expect(all).not.toContain('**');
        expect(all).not.toContain('`');
    });

    it('privacy_en.md tables keep their header row and lose their separator row', () => {
        const tables = parseLegalMarkdown(readDoc('privacy_en.md'))
            .filter((b): b is Extract<LegalBlock, { kind: 'table' }> => b.kind === 'table');
        expect(tables.length).toBeGreaterThan(0);
        expect(tables[0].rows[0]).toEqual(['What', 'Specifically', 'Why']);
        for (const table of tables) {
            for (const row of table.rows) {
                expect(row.every((cell) => /^:?-{3,}:?$/.test(cell))).toBe(false);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('LegalDocumentView — the document, or an honest failure with a retry', () => {
    const TERMS_MR = readDoc('terms_mr.md');
    const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
    const fetchMock = vi.fn();

    const renderView = (props: ViewProps) => render(React.createElement(LegalDocumentView, props));
    const fetchedUrls = () => fetchMock.mock.calls.map(([u]) => String(u));

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('fetches /legal/{doc}_{language}.md and renders it as text', async () => {
        fetchMock.mockResolvedValue(ok(TERMS_MR));
        renderView({ doc: 'terms', language: 'mr' });

        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('वापराच्या अटी — श्रम सफल'));
        expect(fetchedUrls().some((u) => /\/legal\/terms_mr\.md$/.test(u))).toBe(true);

        const shown = screen.getByTestId('legal-document').textContent ?? '';
        expect(shown).not.toContain('<!--');
        expect(shown).not.toContain('**');
        expect(shown).not.toContain('वकिलाला सांगा');
        expect(screen.queryByTestId('legal-document-failed')).toBeNull();
    });

    it.each([
        ['privacy', 'en', /\/legal\/privacy_en\.md$/],
        ['privacy', 'mr', /\/legal\/privacy_mr\.md$/],
        ['terms', 'en', /\/legal\/terms_en\.md$/],
    ] as const)('asks for the %s document in %s', async (doc, language, pattern) => {
        fetchMock.mockResolvedValue(ok('# Heading\n\nBody.'));
        renderView({ doc, language });
        await waitFor(() => expect(fetchedUrls().some((u) => pattern.test(u))).toBe(true));
    });

    it('is never blank while loading', async () => {
        fetchMock.mockImplementation(() => new Promise(() => undefined));
        const { container } = renderView({ doc: 'terms', language: 'mr' });
        await act(async () => { await Promise.resolve(); });
        expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
    });

    it('shows a failure with a retry when the network fails — never a blank', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        renderView({ doc: 'terms', language: 'mr' });

        const failed = await screen.findByTestId('legal-document-failed');
        expect((failed.textContent ?? '').trim().length).toBeGreaterThan(0);
        expect(screen.getByTestId('legal-document-retry')).toBeInTheDocument();
    });

    it('treats a non-OK response as a failure too', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' });
        renderView({ doc: 'privacy', language: 'en' });

        expect(await screen.findByTestId('legal-document-failed')).toBeInTheDocument();
        expect(screen.getByTestId('legal-document-retry')).toBeInTheDocument();
    });

    it('retry refetches and then shows the document', async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(ok(TERMS_MR));
        renderView({ doc: 'terms', language: 'mr' });

        fireEvent.click(await screen.findByTestId('legal-document-retry'));

        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('वापराच्या अटी — श्रम सफल'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchedUrls().every((u) => /\/legal\/terms_mr\.md$/.test(u))).toBe(true);
        expect(screen.queryByTestId('legal-document-failed')).toBeNull();
    });

    it('renders no link that would navigate away from the sheet', async () => {
        fetchMock.mockResolvedValue(ok(TERMS_MR));
        const { container } = renderView({ doc: 'terms', language: 'mr' });
        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('वापराच्या अटी — श्रम सफल'));

        const docLinks = Array.from(container.querySelectorAll('a[href]'))
            .map((a) => a.getAttribute('href') ?? '')
            .filter((href) => href.includes('/legal/') || href.endsWith('.md'));
        expect(docLinks).toEqual([]);
    });
});
