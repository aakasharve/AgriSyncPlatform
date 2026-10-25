// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// The Terms of Use or the Privacy Notice, opened INSIDE the consent sheet. The files are
// bundled with the app (`public/legal/`), so this works offline in the APK and never
// leaves the screen the farmer is consenting on. A failed open says so and offers a
// retry — a blank page under "you accept the Terms" would be the worst outcome here.

import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { parseLegalMarkdown, type LegalBlock } from './legalMarkdown';

export type LegalDocument = 'terms' | 'privacy';

interface Props {
    doc: LegalDocument;
    language: 'mr' | 'en';
}

type LoadState =
    | { status: 'loading' }
    | { status: 'ready'; blocks: LegalBlock[] }
    | { status: 'failed' };

/** A dev server or a host with an SPA fallback answers a missing file with the app's own page. */
const looksLikeHtml = (body: string): boolean => /^\s*<!doctype html|^\s*<html/i.test(body);

const Block: React.FC<{ block: LegalBlock }> = ({ block }) => {
    switch (block.kind) {
        case 'h1':
            return <h2 className="mt-1 font-serif text-[22px] font-bold leading-snug text-emerald-950">{block.text}</h2>;
        case 'h2':
            return <h3 className="mt-5 font-serif text-[19px] font-bold leading-snug text-emerald-900">{block.text}</h3>;
        case 'h3':
            return <h4 className="mt-4 text-[17px] font-bold leading-snug text-stone-900">{block.text}</h4>;
        case 'quote':
            return (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[15px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-200">
                    {block.text}
                </p>
            );
        case 'list':
            return (
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-stone-800">
                    {block.items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
            );
        case 'table':
            return (
                <div className="mt-3 space-y-2">
                    {block.rows.map((row, i) => (
                        <p
                            key={i}
                            className={`rounded-lg px-3 py-2 text-[15px] leading-relaxed ${
                                i === 0 ? 'bg-emerald-50 font-bold text-emerald-900' : 'bg-white text-stone-800 ring-1 ring-stone-200'
                            }`}
                        >
                            {row.filter(Boolean).join(' — ')}
                        </p>
                    ))}
                </div>
            );
        case 'rule':
            return <hr className="my-4 border-stone-200" />;
        default:
            return <p className="mt-2 text-[15px] leading-relaxed text-stone-800">{block.text}</p>;
    }
};

const LegalDocumentView: React.FC<Props> = ({ doc, language }) => {
    const { t } = useLanguage();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setState({ status: 'loading' });
        fetch(`/legal/${doc}_${language}.md`)
            .then(async (res) => {
                const body = await res.text();
                if (!res.ok || !body.trim() || looksLikeHtml(body)) throw new Error('legal document unavailable');
                return body;
            })
            .then((body) => { if (!cancelled) setState({ status: 'ready', blocks: parseLegalMarkdown(body) }); })
            .catch(() => { if (!cancelled) setState({ status: 'failed' }); });
        return () => { cancelled = true; };
    }, [doc, language, attempt]);

    if (state.status === 'loading') {
        return <p className="py-8 text-center text-[15px] font-semibold text-stone-500">{t('consentGate.documentLoading')}</p>;
    }

    if (state.status === 'failed') {
        return (
            <div data-testid="legal-document-failed" className="py-8 text-center">
                <p className="text-[15px] font-semibold text-rose-700">{t('consentGate.documentFailed')}</p>
                <button
                    type="button"
                    data-testid="legal-document-retry"
                    onClick={() => setAttempt((n) => n + 1)}
                    className="mt-3 min-h-[48px] rounded-full bg-emerald-700 px-6 text-[16px] font-bold text-white"
                >
                    {t('consentGate.retry')}
                </button>
            </div>
        );
    }

    return (
        <article data-testid="legal-document" className="pb-4">
            {state.blocks.map((block, i) => <Block key={i} block={block} />)}
        </article>
    );
};

export default LegalDocumentView;
