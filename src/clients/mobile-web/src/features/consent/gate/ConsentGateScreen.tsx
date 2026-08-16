// spec: dfes-companion-2026-07-11 (wave-4.1)
//
// THE FIRST-OPEN GATE. Founder decision 17 (2026-08-16).
//
// One visual acceptance button; TWO separate legal records behind it (wave-4.2 writes
// them). The two-record shape is not an implementation detail hidden from the farmer —
// `acceptanceMeaning` says on screen that one tap does two things and that either can be
// withdrawn on its own. A blanket "accept everything forever" is not valid consent under
// DPDP, and a button that silently bundles is the same thing wearing a nicer label.
//
// Rules this screen is built to, and the shape each one takes here:
//   • No dark patterns — the ONLY thing that enables the CTA is the 18+ declaration.
//     Not scrolling to the bottom, not expanding the cards, not a timer.
//   • No preselected optional toggles — there are no optional toggles on this screen at
//     all. Everything extra (audio retention, model improvement, promotions, partner
//     sharing) is default-off and lives in Settings, per wave-4.3.
//   • Red is reserved. The palette is warm cream + emerald; the only red on the screen is
//     the hint that appears when acceptance is missing, and the failure notice.
//   • Marathi headings 'Noto Serif Devanagari', body 'Noto Sans Devanagari', English and
//     numerals 'DM Sans'. Tailwind's `font-sans` stack is `DM Sans, Noto Sans Devanagari`
//     precisely so a mixed line resolves per-glyph: Latin and digits land on DM Sans,
//     Devanagari falls through to Noto Sans Devanagari. Headings switch face by language
//     because only Marathi headings are serif.
//   • Minimum 16px (`text-base`); spacing 20 / 16 / 24 (`p-5` / `gap-4` / `mb-6`);
//     CTA ≥ 48px.
//
// 🛑 This screen does not, and may not, claim DPDP compliance. Six disclosures the
// founder still owes are rendered as visible unfilled placeholders — see
// `pendingDisclosures` in `consentNotice.ts`.

import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import DataPurposeCard from './DataPurposeCard';
import {
    CONSENT_NOTICE,
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    canonicalNoticeText,
    type NoticeLanguage,
    type PurposeCard,
} from './consentNotice';
import type { CoreDataCategoryCode, CorePurposeCode } from '../../../domain/consent/CoreConsentScope';

/** Everything wave-4.2 needs to write the two records, captured at the moment of the tap. */
export interface ConsentGateAcceptance {
    /** The language the notice was DISPLAYED in — not the account's preference. */
    displayedLanguage: NoticeLanguage;
    noticeVersion: string;
    termsVersion: string;
    privacyPolicyVersion: string;
    purposeCodes: readonly CorePurposeCode[];
    dataCategoryCodes: readonly CoreDataCategoryCode[];
    /** The exact notice text that was on screen — the thing that gets hashed. */
    canonicalNotice: string;
    ageDeclaredAdult: true;
}

interface Props {
    onAccept: (acceptance: ConsentGateAcceptance) => void | Promise<void>;
    /** Test seam — pins the displayed language without touching the app preference. */
    forceLanguage?: NoticeLanguage;
}

const toNoticeLanguage = (lang: string): NoticeLanguage => (lang === 'mr' ? 'mr' : 'en');

const ConsentGateScreen: React.FC<Props> = ({ onAccept, forceLanguage }) => {
    const { language, setLanguage, t } = useLanguage();
    const displayed: NoticeLanguage = forceLanguage ?? toNoticeLanguage(language);
    const copy = CONSENT_NOTICE[displayed];

    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [submitting, setSubmitting] = useState(false);
    const [failed, setFailed] = useState(false);

    // Marathi headings are serif; English headings are not.
    const headingFont = displayed === 'mr' ? 'font-serif' : 'font-sans';

    const canonical = useMemo(() => canonicalNoticeText(displayed), [displayed]);

    const toggleCard = (card: PurposeCard) =>
        setExpanded((prev) => ({ ...prev, [card.id]: !prev[card.id] }));

    const handleAccept = async () => {
        // Belt and braces: the button is disabled without the declaration, and the
        // handler refuses without it too. A consent record that cannot say the person
        // declared themselves an adult is worth nothing.
        if (!ageConfirmed || submitting) return;
        setSubmitting(true);
        setFailed(false);
        try {
            await onAccept({
                displayedLanguage: displayed,
                noticeVersion: NOTICE_VERSION,
                termsVersion: TERMS_VERSION,
                privacyPolicyVersion: PRIVACY_POLICY_VERSION,
                purposeCodes: NOTICE_PURPOSE_CODES,
                dataCategoryCodes: NOTICE_DATA_CATEGORY_CODES,
                canonicalNotice: canonical,
                ageDeclaredAdult: true,
            });
        } catch {
            // Never pretend a record landed. The farmer stays on the gate.
            setFailed(true);
            setSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen-safe flex-col bg-[#FBF7EF] font-sans text-stone-900">
            {/* ── language switcher — मराठी | English ─────────────────────────── */}
            <div className="flex justify-end p-5 pb-0">
                <div
                    role="group"
                    aria-label={t('consentGate.languageGroupLabel')}
                    className="flex items-center gap-1 rounded-full border border-stone-200 bg-white p-1"
                >
                    {(['mr', 'en'] as const).map((code) => {
                        const active = displayed === code;
                        return (
                            <button
                                key={code}
                                type="button"
                                onClick={() => setLanguage(code)}
                                aria-pressed={active}
                                className={`min-h-[40px] rounded-full px-4 text-base ${
                                    active
                                        ? 'bg-emerald-600 font-bold text-white'
                                        : 'text-stone-600'
                                }`}
                            >
                                {code === 'mr' ? 'मराठी' : 'English'}
                            </button>
                        );
                    })}
                </div>
            </div>

            <main className="flex flex-1 flex-col gap-6 p-5 pb-40">
                <header className="flex flex-col gap-4">
                    <h1 className={`${headingFont} text-2xl font-bold leading-snug`}>{copy.title}</h1>
                    <p className="text-base leading-relaxed text-stone-700">{copy.intro}</p>
                </header>

                {/* ── five data-purpose cards ─────────────────────────────────── */}
                <section className="flex flex-col gap-4" aria-labelledby="consent-purposes-heading">
                    <h2 id="consent-purposes-heading" className={`${headingFont} text-xl font-bold`}>
                        {copy.purposeCardsHeading}
                    </h2>
                    {copy.cards.map((card) => (
                        <DataPurposeCard
                            key={card.id}
                            card={card}
                            expanded={Boolean(expanded[card.id])}
                            onToggle={() => toggleCard(card)}
                            headingFont={headingFont}
                            expandLabel={t('consentGate.expand')}
                            collapseLabel={t('consentGate.collapse')}
                        />
                    ))}
                </section>

                {/* ── what we will not do ─────────────────────────────────────── */}
                <section
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
                    aria-labelledby="consent-willnot-heading"
                    data-testid="consent-will-not-do"
                >
                    <h2 id="consent-willnot-heading" className={`${headingFont} mb-4 text-xl font-bold text-emerald-900`}>
                        {copy.willNotDo.heading}
                    </h2>
                    <ul className="flex list-disc flex-col gap-4 pl-5">
                        {copy.willNotDo.items.map((line) => (
                            <li key={line} className="text-base leading-relaxed text-emerald-900">{line}</li>
                        ))}
                    </ul>
                </section>

                {/* ── rights summary ──────────────────────────────────────────── */}
                <section
                    className="rounded-2xl border border-stone-200 bg-white p-5"
                    aria-labelledby="consent-rights-heading"
                    data-testid="consent-rights"
                >
                    <h2 id="consent-rights-heading" className={`${headingFont} mb-4 text-xl font-bold`}>
                        {copy.rights.heading}
                    </h2>
                    <ul className="flex list-disc flex-col gap-4 pl-5">
                        {copy.rights.items.map((line) => (
                            <li key={line} className="text-base leading-relaxed text-stone-800">{line}</li>
                        ))}
                    </ul>
                    <p className="mt-4 text-base leading-relaxed text-stone-600">{copy.rights.where}</p>
                </section>

                {/* ── the six disclosures the founder still owes ──────────────── */}
                <section
                    className="rounded-2xl border border-stone-300 border-dashed bg-stone-50 p-5"
                    aria-labelledby="consent-pending-heading"
                    data-testid="consent-pending-disclosures"
                >
                    <h2 id="consent-pending-heading" className={`${headingFont} mb-4 text-lg font-bold text-stone-700`}>
                        {copy.pendingDisclosures.heading}
                    </h2>
                    <p className="mb-4 text-base leading-relaxed text-stone-600">{copy.pendingDisclosures.note}</p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        {copy.pendingDisclosures.items.map((line) => (
                            <li key={line} className="text-base leading-relaxed text-stone-600">{line}</li>
                        ))}
                    </ul>
                </section>

                {/* ── legal links ─────────────────────────────────────────────── */}
                <nav className="flex flex-wrap gap-4" aria-label={t('consentGate.legalLinksLabel')}>
                    <a
                        href="/legal/terms"
                        className="min-h-[48px] text-base font-medium text-emerald-700 underline underline-offset-4"
                    >
                        {copy.links.terms}
                    </a>
                    <a
                        href="/legal/privacy"
                        className="min-h-[48px] text-base font-medium text-emerald-700 underline underline-offset-4"
                    >
                        {copy.links.privacy}
                    </a>
                </nav>
            </main>

            {/* ── sticky acceptance bar ───────────────────────────────────────── */}
            <div className="sticky bottom-0 border-t border-stone-200 bg-[#FBF7EF] p-5 pb-safe-bottom">
                <p className="mb-4 text-base leading-relaxed text-stone-700">{copy.acceptanceMeaning}</p>

                <label className="mb-4 flex min-h-[48px] items-start gap-4">
                    <input
                        type="checkbox"
                        checked={ageConfirmed}
                        onChange={(e) => setAgeConfirmed(e.target.checked)}
                        className="mt-1 h-6 w-6 shrink-0 accent-emerald-600"
                        data-testid="consent-age-checkbox"
                    />
                    <span className="text-base leading-relaxed text-stone-900">{copy.ageDeclaration}</span>
                </label>

                <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={!ageConfirmed || submitting}
                    data-testid="consent-accept-cta"
                    className={`min-h-[48px] w-full rounded-2xl px-5 text-base font-bold ${
                        ageConfirmed && !submitting
                            ? 'bg-emerald-600 text-white'
                            : 'cursor-not-allowed bg-stone-200 text-stone-500'
                    }`}
                >
                    {copy.cta}
                </button>

                {/* The only red on the screen: consent missing, or acceptance failed. */}
                {!ageConfirmed && (
                    <p className="mt-4 text-base text-red-700" data-testid="consent-cta-hint">
                        {copy.ctaDisabledHint}
                    </p>
                )}
                {failed && (
                    <p className="mt-4 text-base text-red-700" role="alert" data-testid="consent-failed">
                        {t('consentGate.saveFailed')}
                    </p>
                )}
            </div>
        </div>
    );
};
export default ConsentGateScreen;
