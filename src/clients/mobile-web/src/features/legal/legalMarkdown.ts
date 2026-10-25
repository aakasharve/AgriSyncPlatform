// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// Just enough markdown to show the four bundled legal documents
// (`public/legal/{terms,privacy}_{mr,en}.md`) inside the app. The tick says he accepts the
// Terms, so he has to be able to open them without leaving the screen he is on — a hard
// link to a raw .md file would unload the page mid-consent.
//
// Deliberately small: headings, paragraphs, quotes, lists, tables and rules are all these
// documents use. Authoring comments (`<!-- … -->`) are notes to the next writer, not to the
// farmer, and are dropped. Inline emphasis and code marks are dropped rather than
// rendered — every word stays, only the decoration goes.

export type LegalBlock =
    | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'quote'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'table'; rows: string[][] }
    | { kind: 'rule' };

const cleanInline = (s: string): string =>
    s
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .trim();

const HEADING = /^(#{1,3})\s+(.*)$/;
const LIST_ITEM = /^(?:[-*]|\d+\.)\s+(.*)$/;
const TABLE_SEPARATOR = /^\|[\s|:-]+\|?$/;

export function parseLegalMarkdown(md: string): LegalBlock[] {
    const text = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    const blocks: LegalBlock[] = [];
    let para: string[] = [];
    let quote: string[] = [];
    let list: string[] = [];
    let table: string[][] = [];

    const flush = () => {
        if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
        if (quote.length) blocks.push({ kind: 'quote', text: quote.join(' ') });
        if (list.length) blocks.push({ kind: 'list', items: list });
        if (table.length) blocks.push({ kind: 'table', rows: table });
        para = [];
        quote = [];
        list = [];
        table = [];
    };

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) { flush(); continue; }

        if (/^-{3,}$/.test(line)) { flush(); blocks.push({ kind: 'rule' }); continue; }

        const heading = HEADING.exec(line);
        if (heading) {
            flush();
            const kind = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
            blocks.push({ kind, text: cleanInline(heading[2]) });
            continue;
        }

        if (line.startsWith('|')) {
            if (!table.length) flush();
            if (TABLE_SEPARATOR.test(line)) continue;
            table.push(line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanInline));
            continue;
        }

        if (line.startsWith('>')) {
            if (!quote.length) flush();
            const body = cleanInline(line.replace(/^>\s?/, ''));
            if (body) quote.push(body);
            continue;
        }

        const item = LIST_ITEM.exec(line);
        if (item) {
            if (!list.length) flush();
            list.push(cleanInline(item[1]));
            continue;
        }

        // An indented line straight after a list item continues that item.
        if (list.length && /^\s/.test(raw)) {
            list[list.length - 1] = `${list[list.length - 1]} ${cleanInline(line)}`;
            continue;
        }

        if (!para.length) flush();
        para.push(cleanInline(line));
    }
    flush();
    return blocks;
}
