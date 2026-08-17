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
// ── PLAIN DOCUMENT, founder direction 2026-08-17 ────────────────────────────────────
// "remove icons as well, make it clean and make texts even smaller, clear a document
// like section wise text but fitted inside the mobile screen, no extra decorative UI
// element inside it."
//
// So this screen is now a PRINTED PAGE, not an app screen. Concretely, and these are
// constraints rather than styling preferences — each one is a thing that may not come
// back without another founder direction:
//   • NO ICONS. Not one glyph. `lucide-react` is not imported by this file any more,
//     and that absence is the enforcement: there is nothing to accidentally re-add.
//   • NO DECORATIVE CONTAINERS. No cards, tiles, panels, gradients, shadows, rings,
//     backdrop blurs, coloured section backgrounds, entry animation, or rules between
//     sections. A section is a heading followed by its text; the only thing separating
//     one section from the next is vertical space, which is how a document does it.
//   • NO LIST MARKERS. The <ul>/<li> semantics stay for screen readers; the discs are
//     suppressed, because a marker is a glyph and he asked for none.
//   • THE ONLY THREE INTERACTIVE CONTROLS are the language switch, the 18+ checkbox and
//     the accept button, and only those three carry enough styling to read as tappable.
//     A button has to look like a button or it is a trap.
//     (The Terms / Privacy references and the contact address render as plain inline
//     text links — a document names the papers it incorporates, and the CTA text itself
//     says he is accepting the Terms, so he has to be able to open them. They are
//     typography, not chrome: no box, no fill, no icon.)
//
// ── TYPE SCALE ─────────────────────────────────────────────────────────────────────
// Smaller again, on his instruction. Every size below is an existing token already in
// use in `src/clients/mobile-web/src` — nothing here is invented:
//   14px  title and CTA          11px    section headings, language switch
//   10.5px 18+ declaration       10px    purpose-entry terms
//   9.5px body                   9px     fine print (processors, withdrawal)
// Body is 9.5px, which is BELOW the 10.5px floor the previous revision used and below
// the smallest size on OnboardingPermissionsPage. It is not below the app's smallest
// token (8px exists). Flagged to the founder rather than silently taken.
//
// ── THE ONE THING THE LAYOUT MAY NOT LOSE ──────────────────────────────────────────
// The root element is the only scroller on the screen; header, notice and acceptance are
// siblings in one flow, with no docked or sticky bar. That is what keeps the 004c735e
// defect dead: that bug was content laid out taller than AppShell's fixed,
// `overflow-hidden` box with no scroller of its own, so the acceptance bar was simply
// cut off and the gate could not be passed on a short phone. With `h-full
// overflow-y-auto` at the root, every child is reachable by construction. A test pins
// that invariant structurally, because it is not a thing jsdom can measure.
//
// Rules this screen is built to, and the shape each one takes here:
//   • No dark patterns — the ONLY thing that enables the CTA is the 18+ declaration.
//     Not scrolling to the bottom, not opening anything, not a timer.
//   • No preselected optional toggles — there are no optional toggles on this screen at
//     all. Everything extra (audio retention, model improvement, promotions, partner
//     sharing) is default-off and lives in Settings, per wave-4.3.
//   • Red is reserved. The only red on the screen is the hint when acceptance is
//     missing, and the failure notice — both plain text now, not panels.
//   • Marathi headings 'Noto Serif Devanagari', body 'Noto Sans Devanagari', English and
//     numerals 'DM Sans'. Tailwind's `font-sans` stack is `DM Sans, Noto Sans Devanagari`
//     precisely so a mixed line resolves per-glyph: Latin and digits land on DM Sans,
//     Devanagari falls through to Noto Sans Devanagari. Headings switch face by language
//     because only Marathi headings are serif. No `system-ui`, no `Arial`, nowhere.
//   • The notice is not `select-none`: legal text a farmer cannot copy is worse consent.
//
// 🛑 This screen does not, and may not, claim DPDP compliance. What is still unknown —
// a grievance phone number, a named DPO, retention periods, the processor list, the
// under-18 policy — is OMITTED rather than shown as an empty bracket. The CIN and the
// registered office are a different case: they are KNOWN, they were taken off this
// screen on purpose, and they are owed to the full privacy notice. See
// `OWED_TO_FULL_PRIVACY_NOTICE` in `consentNotice.ts`.

import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import DataPurposeCard from './DataPurposeCard';
import {
    CONSENT_NOTICE,
    DATA_FIDUCIARY,
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    NOTICE_VERSION,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    canonicalNoticeText,
    type NoticeLanguage,
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

/** A section heading: one short line, no glyph, no rule. Nothing else marks a section. */
const SectionHeading: React.FC<{
    id: string; headingFont: string; children: React.ReactNode;
}> = ({ id, headingFont, children }) => (
    <h2 id={id} className={`${headingFont} mb-1.5 text-[11px] font-bold leading-snug text-stone-900`}>
        {children}
    </h2>
);

const ConsentGateScreen: React.FC<Props> = ({ onAccept, forceLanguage }) => {
    const { language, setLanguage, t } = useLanguage();
    const displayed: NoticeLanguage = forceLanguage ?? toNoticeLanguage(language);
    const copy = CONSENT_NOTICE[displayed];

    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [failed, setFailed] = useState(false);

    // Marathi headings are serif; English headings are not.
    const headingFont = displayed === 'mr' ? 'font-serif' : 'font-sans';

    const canonical = useMemo(() => canonicalNoticeText(displayed), [displayed]);

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
        // THE ONLY SCROLLER. AppShell hands this screen a fixed, overflow-hidden box, so
        // the scroll has to live here — and living here, rather than around an inner
        // region, is what makes every child reachable including the button at the end.
        <div
            data-testid="consent-scroll-root"
            className="h-full overflow-y-auto overscroll-contain bg-white font-sans text-stone-800"
        >
            <div className="mx-auto w-full max-w-[420px] px-4 pt-3 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]">

                {/* ── language switch — one of the three controls ──────────────── */}
                <div
                    role="group"
                    aria-label={t('consentGate.languageGroupLabel')}
                    className="mb-3 flex items-center justify-end gap-1"
                >
                    {(['mr', 'en'] as const).map((code) => {
                        const active = displayed === code;
                        return (
                            <button
                                key={code}
                                type="button"
                                onClick={() => setLanguage(code)}
                                aria-pressed={active}
                                className={`min-h-[32px] rounded border px-3 font-sans text-[11px] transition-colors ${
                                    active
                                        ? 'border-emerald-700 bg-emerald-700 font-bold text-white'
                                        : 'border-stone-300 font-semibold text-stone-600'
                                }`}
                            >
                                {code === 'mr' ? 'मराठी' : 'English'}
                            </button>
                        );
                    })}
                </div>

                {/* ── the document opens: title, what it is, who it is from ─────── */}
                <h1 className={`${headingFont} text-[14px] font-bold leading-tight text-stone-900`}>
                    {copy.title}
                </h1>
                <p className="mt-1 font-sans text-[9.5px] leading-relaxed text-stone-600">
                    {copy.intro}
                </p>
                <p
                    data-testid="consent-brand-line"
                    className="mt-1 font-sans text-[9.5px] leading-relaxed text-stone-600"
                >
                    {copy.brandLine}
                </p>

                {/* ── section: what we use, and why ─────────────────────────────── */}
                <section className="mt-4" aria-labelledby="consent-purposes-heading">
                    <SectionHeading id="consent-purposes-heading" headingFont={headingFont}>
                        {copy.purposeCardsHeading}
                    </SectionHeading>
                    <ul className="flex list-none flex-col gap-2">
                        {copy.cards.map((card) => (
                            <DataPurposeCard key={card.id} card={card} headingFont={headingFont} />
                        ))}
                    </ul>
                </section>

                {/* ── section: what we will not do, and who may process ─────────── */}
                <section className="mt-4" aria-labelledby="consent-willnot-heading" data-testid="consent-will-not-do">
                    <SectionHeading id="consent-willnot-heading" headingFont={headingFont}>
                        {copy.willNotDo.heading}
                    </SectionHeading>
                    <ul className="flex list-none flex-col gap-1">
                        {copy.willNotDo.items.map((line) => (
                            <li key={line} className="font-sans text-[9.5px] leading-relaxed text-stone-700">{line}</li>
                        ))}
                    </ul>
                    <p className="mt-1.5 font-sans text-[9px] leading-relaxed text-stone-500">{copy.processors}</p>
                </section>

                {/* ── section: rights ───────────────────────────────────────────── */}
                <section className="mt-4" aria-labelledby="consent-rights-heading" data-testid="consent-rights">
                    <SectionHeading id="consent-rights-heading" headingFont={headingFont}>
                        {copy.rights.heading}
                    </SectionHeading>
                    <p className="font-sans text-[9.5px] font-semibold leading-relaxed text-stone-700">{copy.rights.where}</p>
                    <ul className="mt-0.5 flex list-none flex-col gap-1">
                        {copy.rights.items.map((line) => (
                            <li key={line} className="font-sans text-[9.5px] leading-relaxed text-stone-700">{line}</li>
                        ))}
                    </ul>
                    <p className="mt-1.5 font-sans text-[9px] leading-relaxed text-stone-500">{copy.rights.withdrawal}</p>
                </section>

                {/* ── section: who runs this, and the two documents ─────────────── */}
                <section className="mt-4" aria-labelledby="consent-entity-heading" data-testid="consent-entity">
                    <SectionHeading id="consent-entity-heading" headingFont={headingFont}>
                        {copy.entity.heading}
                    </SectionHeading>
                    <p className="font-sans text-[9.5px] font-bold leading-relaxed text-stone-800">
                        {DATA_FIDUCIARY.legalName}
                    </p>
                    <p className="font-sans text-[9.5px] leading-relaxed text-stone-600">
                        {copy.entity.contactLabel}:{' '}
                        <a href={`mailto:${DATA_FIDUCIARY.contact}`} className="underline">
                            {DATA_FIDUCIARY.contact}
                        </a>
                    </p>
                    <p className="mt-1 font-sans text-[9.5px] leading-relaxed text-stone-600">
                        <a href="/legal/terms" className="underline">{copy.links.terms}</a>
                        {' · '}
                        <a href="/legal/privacy" className="underline">{copy.links.privacy}</a>
                    </p>
                </section>

                {/* ── the acceptance, at the end of the same column ─────────────── */}
                <section className="mt-4">
                    <p className="font-sans text-[9.5px] leading-relaxed text-stone-600">{copy.acceptanceMeaning}</p>

                    <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2.5">
                        <input
                            type="checkbox"
                            checked={ageConfirmed}
                            onChange={(e) => setAgeConfirmed(e.target.checked)}
                            className="h-5 w-5 shrink-0 rounded border-stone-400 accent-emerald-700"
                            data-testid="consent-age-checkbox"
                        />
                        <span className="font-sans text-[10.5px] font-semibold leading-snug text-stone-800">
                            {copy.ageDeclaration}
                        </span>
                    </label>

                    <button
                        type="button"
                        onClick={() => void handleAccept()}
                        disabled={!ageConfirmed || submitting}
                        data-testid="consent-accept-cta"
                        className="mt-1 flex min-h-[46px] w-full items-center justify-center rounded-lg bg-emerald-700 px-4 font-sans text-[14px] font-bold text-white transition-colors disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500"
                    >
                        {copy.cta}
                    </button>

                    {/* The only red on the screen: consent missing, or acceptance failed. */}
                    {!ageConfirmed && (
                        <p
                            className="mt-1.5 text-center font-sans text-[9.5px] font-semibold leading-snug text-rose-700"
                            data-testid="consent-cta-hint"
                        >
                            {copy.ctaDisabledHint}
                        </p>
                    )}
                    {failed && (
                        <p
                            className="mt-1.5 font-sans text-[9.5px] font-semibold leading-snug text-rose-700"
                            role="alert"
                            data-testid="consent-failed"
                        >
                            {t('consentGate.saveFailed')}
                        </p>
                    )}
                </section>
            </div>
        </div>
    );
};
export default ConsentGateScreen;
