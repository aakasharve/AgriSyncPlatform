// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// The whole notice, opened from the tick's link. Founder decisions 2026-10-25: consent is
// one tick on the phone-number screen ("the link and only tick mark"), and the notice it
// links to must be READABLE — the old gate's 9.5 px body could not be read by the people
// it was written for. So: body 15 px and up, headings 18 px and up, sections as cards.
//
// Every statement comes from `CONSENT_NOTICE` — the same text `canonicalNoticeText` hashes —
// so what the record says he could read is exactly what this sheet shows. Nothing here
// navigates: it is an overlay over the screen he is on, his typed number survives it, and
// the Terms and the Privacy Notice open inside it.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ArrowLeft, ShieldCheck, X } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import LegalDocumentView, { type LegalDocument } from '../../legal/LegalDocumentView';
import { CONSENT_NOTICE, DATA_FIDUCIARY, type NoticeLanguage } from './consentNotice';

interface Props {
    open: boolean;
    onClose: () => void;
}

const toNoticeLanguage = (lang: string): NoticeLanguage => (lang === 'mr' ? 'mr' : 'en');

const Card: React.FC<{ heading: string; testId?: string; headingFont: string; children: React.ReactNode }> = ({
    heading, testId, headingFont, children,
}) => (
    <section data-testid={testId} className="mt-3 rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-emerald-900/10">
        <h3 className={`${headingFont} mb-2 text-[18px] font-bold leading-snug text-emerald-900`}>{heading}</h3>
        {children}
    </section>
);

/**
 * Android hardware Back while the sheet is open: back out of a document to the notice, then
 * close the notice — never leave the app. The signed-in Back handler
 * (`app/hooks/useAndroidBackButton.ts`) is only mounted inside the signed-in app, so on the
 * login and QR-join screens nothing else would catch it and Back would exit, losing the
 * number he typed.
 */
function useHardwareBackWhileOpen(open: boolean, onBack: () => void): void {
    const latest = useRef(onBack);
    latest.current = onBack;

    useEffect(() => {
        if (!open || !Capacitor.isNativePlatform()) return;
        let cancelled = false;
        let remove: (() => Promise<void>) | undefined;
        void App.addListener('backButton', () => latest.current()).then((handle) => {
            if (cancelled) void handle.remove();
            else remove = () => handle.remove();
        });
        return () => {
            cancelled = true;
            void remove?.();
        };
    }, [open]);
}

const ConsentNoticeSheet: React.FC<Props> = ({ open, onClose }) => {
    const { language, setLanguage, t } = useLanguage();
    const [view, setView] = useState<'notice' | LegalDocument>('notice');

    useHardwareBackWhileOpen(open, () => {
        if (view !== 'notice') {
            setView('notice');
            return;
        }
        onClose();
    });

    if (!open) return null;

    const lang = toNoticeLanguage(language);
    const n = CONSENT_NOTICE[lang];
    const headingFont = lang === 'mr' ? 'font-serif' : 'font-sans';
    const body = 'text-[15px] leading-relaxed text-stone-800';
    const fine = 'text-[14px] leading-relaxed text-stone-600';

    const close = () => {
        setView('notice');
        onClose();
    };

    // Portalled to <body>: the login card is a `glass-panel` with a backdrop filter, and a
    // filtered ancestor becomes the containing block for `position: fixed` — the sheet
    // would otherwise be clipped to the card instead of covering the screen.
    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-notice-title"
            data-testid="consent-notice-sheet"
            className="fixed inset-0 z-[70] flex flex-col bg-gradient-to-b from-emerald-50 via-white to-emerald-50 font-sans"
        >
            <header className="flex items-center gap-2 border-b border-emerald-900/10 bg-white/80 px-4 pb-2 pt-[calc(0.5rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] backdrop-blur">
                <ShieldCheck size={22} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <h2 id="consent-notice-title" className={`${headingFont} min-w-0 flex-1 truncate text-[18px] font-bold text-stone-900`}>
                    {view === 'terms' ? n.links.terms : view === 'privacy' ? n.links.privacy : n.title}
                </h2>
                <div role="group" aria-label={t('consentGate.languageGroupLabel')} className="flex gap-1">
                    {(['mr', 'en'] as const).map((code) => (
                        <button
                            key={code}
                            type="button"
                            onClick={() => setLanguage(code)}
                            aria-pressed={lang === code}
                            className={`min-h-[40px] rounded-full px-3 text-[13px] font-bold ${
                                lang === code ? 'bg-emerald-700 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'
                            }`}
                        >
                            {code === 'mr' ? 'मराठी' : 'English'}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={close}
                    aria-label={t('consentGate.noticeClose')}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-600 hover:bg-stone-100"
                >
                    <X size={22} aria-hidden="true" />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
                <div className="mx-auto max-w-[560px]">
                    {view === 'notice' ? (
                        <>
                            <p className={`${body} mt-4`}>{n.intro}</p>
                            <p className={`${fine} mt-1`}>{n.brandLine}</p>

                            <Card heading={n.purposeCardsHeading} headingFont={headingFont}>
                                <ul className="space-y-3">
                                    {n.cards.map((card) => (
                                        <li key={card.id} data-testid={`consent-notice-card-${card.id}`}>
                                            <p className="text-[16px] font-bold text-stone-900">{card.title}</p>
                                            <p className={body}>{card.data} — {card.purpose}</p>
                                        </li>
                                    ))}
                                </ul>
                            </Card>

                            <Card heading={n.willNotDo.heading} headingFont={headingFont} testId="consent-notice-will-not">
                                <ul className="list-disc space-y-1.5 pl-5">
                                    {n.willNotDo.items.map((line) => <li key={line} className={body}>{line}</li>)}
                                </ul>
                                <p className={`${fine} mt-3`}>{n.processors}</p>
                            </Card>

                            <Card heading={n.rights.heading} headingFont={headingFont} testId="consent-notice-rights">
                                <p className={`${body} font-semibold`}>{n.rights.where}</p>
                                <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                                    {n.rights.items.map((line) => <li key={line} className={body}>{line}</li>)}
                                </ul>
                                <p className={`${fine} mt-3`}>{n.rights.withdrawal}</p>
                                <p className={`${fine} mt-2`}>{n.rights.boardComplaint}</p>
                            </Card>

                            <Card heading={n.entity.heading} headingFont={headingFont} testId="consent-notice-entity">
                                <p className="text-[16px] font-bold text-stone-900">{DATA_FIDUCIARY.legalName}</p>
                                <p className={body}>
                                    {n.entity.contactLabel}:{' '}
                                    <a href={`mailto:${DATA_FIDUCIARY.contact}`} className="font-semibold text-emerald-800 underline">
                                        {DATA_FIDUCIARY.contact}
                                    </a>
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        data-testid="consent-open-terms"
                                        onClick={() => setView('terms')}
                                        className="min-h-[44px] rounded-full bg-white px-4 text-[15px] font-bold text-emerald-800 ring-1 ring-emerald-300"
                                    >
                                        {n.links.terms}
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="consent-open-privacy"
                                        onClick={() => setView('privacy')}
                                        className="min-h-[44px] rounded-full bg-white px-4 text-[15px] font-bold text-emerald-800 ring-1 ring-emerald-300"
                                    >
                                        {n.links.privacy}
                                    </button>
                                </div>
                            </Card>

                            <p className={`${body} mt-4`}>{n.acceptanceMeaning}</p>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setView('notice')}
                                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[15px] font-bold text-emerald-800"
                            >
                                <ArrowLeft size={18} aria-hidden="true" />
                                {t('consentGate.noticeBack')}
                            </button>
                            <LegalDocumentView doc={view} language={lang} />
                        </>
                    )}
                </div>
            </div>

            <footer className="border-t border-emerald-900/10 bg-white/90 px-4 pt-3 pb-[calc(0.75rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]">
                <button
                    type="button"
                    data-testid="consent-notice-close"
                    onClick={close}
                    className="mx-auto flex min-h-[52px] w-full max-w-[560px] items-center justify-center rounded-full bg-emerald-700 text-[17px] font-bold text-white"
                >
                    {t('consentGate.noticeClose')}
                </button>
            </footer>
        </div>,
        document.body,
    );
};

export default ConsentNoticeSheet;
