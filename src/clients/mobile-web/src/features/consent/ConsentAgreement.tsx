// spec: data-principle-spine-2026-05-05/06.4
//
// Fetches and renders the locale-appropriate consent agreement markdown
// (`/consent/agreement_{mr|hi|en}.md`). The agreement copy itself is
// tagged per OQ-7 markdown convention — HTML comments above each
// section let counsel grep `LEGAL_REVIEW_PENDING` and find every
// string awaiting review.
//
// **No new dependency.** We render markdown with a tiny manual parser
// (headings + lists + bold + paragraphs + `---` rules) because the
// agreement copy is intentionally simple and adding `react-markdown`
// to satisfy 4 documents was rejected by the envelope hard rules.

import React, { useEffect, useState } from 'react';
import type { ConsentLocale } from '../../i18n/consentTranslations';

interface Props {
    locale: ConsentLocale;
}

function localeToFileSuffix(locale: ConsentLocale): 'mr' | 'hi' | 'en' {
    if (locale === 'mr-IN') return 'mr';
    if (locale === 'hi-IN') return 'hi';
    return 'en';
}

/** Strip HTML comments — they are LEGAL_REVIEW_PENDING anchors counsel needs in source, not in UI. */
function stripHtmlComments(s: string): string {
    return s.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Tiny markdown-to-React renderer. Supports the subset our agreement
 * files actually use:
 *   # H1, ## H2
 *   - bullet list item
 *   **bold inline**
 *   ---  hr
 *   blank line  paragraph break
 *
 * Production-equivalent fidelity is NOT a goal here — the agreement is
 * counsel-controlled copy and any future need for richer markup should
 * trigger the addition of `react-markdown` in its own PR.
 */
function renderMarkdown(md: string): React.ReactNode {
    const cleaned = stripHtmlComments(md);
    const lines = cleaned.split(/\r?\n/);
    const nodes: React.ReactNode[] = [];
    let paragraph: string[] = [];
    let listItems: string[] = [];

    const flushParagraph = () => {
        if (paragraph.length > 0) {
            nodes.push(
                <p key={`p-${nodes.length}`} className="text-sm text-stone-700 leading-relaxed mb-3">
                    {renderInline(paragraph.join(' '))}
                </p>,
            );
            paragraph = [];
        }
    };
    const flushList = () => {
        if (listItems.length > 0) {
            const items = listItems.slice();
            nodes.push(
                <ul key={`ul-${nodes.length}`} className="list-disc pl-6 mb-3 space-y-1">
                    {items.map((li, idx) => (
                        <li key={idx} className="text-sm text-stone-700">
                            {renderInline(li)}
                        </li>
                    ))}
                </ul>,
            );
            listItems = [];
        }
    };

    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0) {
            flushParagraph();
            flushList();
            continue;
        }
        if (line === '---') {
            flushParagraph();
            flushList();
            nodes.push(<hr key={`hr-${nodes.length}`} className="my-4 border-stone-200" />);
            continue;
        }
        if (line.startsWith('## ')) {
            flushParagraph();
            flushList();
            nodes.push(
                <h2 key={`h2-${nodes.length}`} className="font-bold text-base text-stone-800 mt-4 mb-2">
                    {renderInline(line.slice(3))}
                </h2>,
            );
            continue;
        }
        if (line.startsWith('# ')) {
            flushParagraph();
            flushList();
            nodes.push(
                <h1 key={`h1-${nodes.length}`} className="font-display font-black text-xl text-stone-900 mb-3">
                    {renderInline(line.slice(2))}
                </h1>,
            );
            continue;
        }
        if (line.startsWith('- ')) {
            flushParagraph();
            listItems.push(line.slice(2));
            continue;
        }
        flushList();
        paragraph.push(line);
    }
    flushParagraph();
    flushList();

    return nodes;
}

/** Inline: **bold** only. Everything else passes through as text. */
function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return (
                <strong key={idx} className="font-bold text-stone-900">
                    {part.slice(2, -2)}
                </strong>
            );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
}

const ConsentAgreement: React.FC<Props> = ({ locale }) => {
    const [text, setText] = useState<string>('');
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const url = `/consent/agreement_${localeToFileSuffix(locale)}.md`;
        fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then((body) => {
                if (!cancelled) setText(body);
            })
            .catch((err: Error) => {
                if (!cancelled) setLoadError(err.message);
            });
        return () => {
            cancelled = true;
        };
    }, [locale]);

    if (loadError) {
        return (
            <div className="text-sm text-red-600" data-testid="consent-agreement-error">
                {loadError}
            </div>
        );
    }
    if (!text) {
        return (
            <div className="text-sm text-stone-400" data-testid="consent-agreement-loading">
                ...
            </div>
        );
    }
    return (
        <div className="prose prose-sm max-w-none" data-testid="consent-agreement-content">
            {renderMarkdown(text)}
        </div>
    );
};

export default ConsentAgreement;
