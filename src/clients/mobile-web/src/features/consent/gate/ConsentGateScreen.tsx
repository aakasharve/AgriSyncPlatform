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
// ── REBUILD, founder direction 2026-08-17 ───────────────────────────────────────────
// He read the previous version and said: one section, not a separate scrollable box;
// much smaller text; the acceptance easy to reach at the bottom; far less text that
// still means all of it; and no visible "still to be filled in" section.
//
// So the shape is now literally ONE COLUMN THAT SCROLLS:
//   • The root element is the only scroller on the screen. There is no inner scroll
//     region and no docked/sticky bar — the header, the notice and the acceptance are
//     siblings in one flow, and he reaches the button by scrolling to the end of the
//     thing he was already reading.
//   • This is also what keeps the 004c735e-era defect dead. That bug was content laid
//     out taller than AppShell's fixed, `overflow-hidden` box with no scroller of its
//     own, so the acceptance bar was simply cut off and the gate could not be passed on
//     a short phone. With `h-full overflow-y-auto` at the root, every child is reachable
//     by construction — there is nothing left that can be clipped. A test pins that
//     invariant structurally, because it is not a thing jsdom can measure.
//   • The scale is the app's own small scale, taken from OnboardingPermissionsPage:
//     17 / 12 / 11.5 / 11 / 10.5 / 10 px, CTA at 15px. The founder explicitly retired
//     this screen's old 16px floor. No size here is invented.
//
// Rules this screen is built to, and the shape each one takes here:
//   • No dark patterns — the ONLY thing that enables the CTA is the 18+ declaration.
//     Not scrolling to the bottom, not opening anything, not a timer.
//   • No preselected optional toggles — there are no optional toggles on this screen at
//     all. Everything extra (audio retention, model improvement, promotions, partner
//     sharing) is default-off and lives in Settings, per wave-4.3.
//   • Red is reserved. The palette is the onboarding mint + emerald; the only red on the
//     screen is `rose` — the hint when acceptance is missing, and the failure notice.
//   • Marathi headings 'Noto Serif Devanagari', body 'Noto Sans Devanagari', English and
//     numerals 'DM Sans'. Tailwind's `font-sans` stack is `DM Sans, Noto Sans Devanagari`
//     precisely so a mixed line resolves per-glyph: Latin and digits land on DM Sans,
//     Devanagari falls through to Noto Sans Devanagari. Headings switch face by language
//     because only Marathi headings are serif.
//   • The notice is not `select-none`: legal text a farmer cannot copy is worse consent.
//
// 🛑 This screen does not, and may not, claim DPDP compliance. What is still unknown —
// a grievance phone number, a named DPO, retention periods, the processor list, the
// under-18 policy — is OMITTED rather than shown as an empty bracket. See the header of
// `consentNotice.ts`.

import React, { useMemo, useState } from 'react';
import {
    Ban, Building2, FileText, KeyRound, Lock, MapPin, Mic,
    ShieldCheck, Smartphone, Sprout, UserCheck,
} from 'lucide-react';
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

/**
 * Decorative only — one lucide glyph per purpose, in the same emerald tile the
 * permissions screen uses for location / microphone / camera / storage. Purely visual;
 * the row's own words carry the disclosure, and nothing here is hashed.
 */
const CARD_ICONS: Record<PurposeCard['id'], React.ReactNode> = {
    account: <UserCheck size={14} />,
    farmWork: <Sprout size={14} />,
    voiceUploads: <Mic size={14} />,
    farmLocation: <MapPin size={14} />,
    technical: <Smartphone size={14} />,
};

/** Section heading — one small glyph, one short line. Repeated at every block. */
const SectionHeading: React.FC<{
    id: string; icon: React.ReactNode; headingFont: string; children: React.ReactNode;
}> = ({ id, icon, headingFont, children }) => (
    <h2 id={id} className={`${headingFont} mb-2.5 flex items-center gap-1.5 text-[12px] font-bold text-stone-800`}>
        <span aria-hidden="true" className="text-emerald-600">{icon}</span>
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
            className="h-full overflow-y-auto overscroll-contain bg-gradient-to-b from-emerald-50/60 via-white to-emerald-50/40 font-sans text-stone-800"
        >
            <style>{`
                @keyframes cg-up { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }
                @media (prefers-reduced-motion:reduce){ [data-cg-anim]{animation-duration:.01ms!important;animation-delay:0ms!important} }
            `}</style>

            <div
                data-cg-anim
                className="mx-auto w-full max-w-[440px] px-5 pt-4 pb-[calc(1.25rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
                style={{ animation: 'cg-up .45s cubic-bezier(.16,1,.3,1) .05s both' }}
            >
                {/* ── language switcher ─────────────────────────────────────────── */}
                <div className="mb-3 flex justify-end">
                    <div
                        role="group"
                        aria-label={t('consentGate.languageGroupLabel')}
                        className="flex items-center gap-1 rounded-full border border-stone-200/70 bg-white/80 p-0.5 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
                    >
                        {(['mr', 'en'] as const).map((code) => {
                            const active = displayed === code;
                            return (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => setLanguage(code)}
                                    aria-pressed={active}
                                    className={`min-h-[34px] rounded-full px-3.5 font-sans text-[12px] transition-colors ${
                                        active
                                            ? 'bg-emerald-600 font-bold text-white shadow-sm'
                                            : 'font-semibold text-stone-500 hover:text-stone-700'
                                    }`}
                                >
                                    {code === 'mr' ? 'मराठी' : 'English'}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── title lockup ──────────────────────────────────────────────── */}
                <div className="flex items-center gap-2.5">
                    <span
                        aria-hidden="true"
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15"
                    >
                        <ShieldCheck size={19} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                        <h1 className={`${headingFont} text-[17px] font-bold leading-tight text-stone-800`}>
                            {copy.title}
                        </h1>
                        <p className="mt-0.5 font-sans text-[11px] font-medium leading-snug text-stone-500">
                            {copy.intro}
                        </p>
                    </div>
                </div>

                {/* ── the three names, in one line: product · platform · company ── */}
                <p
                    data-testid="consent-brand-line"
                    className="mt-3 border-l-2 border-emerald-300 pl-2.5 font-sans text-[11px] font-medium leading-snug text-stone-600"
                >
                    {copy.brandLine}
                </p>

                {/* ── ONE panel. Every disclosure, then the acceptance at its foot. ── */}
                <div className="mt-3 divide-y divide-stone-200/70 overflow-hidden rounded-3xl border border-stone-200/70 bg-white/85 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm">

                    {/* what we take, and what for */}
                    <section className="p-4" aria-labelledby="consent-purposes-heading">
                        <SectionHeading id="consent-purposes-heading" icon={<Sprout size={13} />} headingFont={headingFont}>
                            {copy.purposeCardsHeading}
                        </SectionHeading>
                        <ul className="flex flex-col gap-2.5">
                            {copy.cards.map((card) => (
                                <DataPurposeCard
                                    key={card.id}
                                    card={card}
                                    headingFont={headingFont}
                                    icon={CARD_ICONS[card.id]}
                                />
                            ))}
                        </ul>
                    </section>

                    {/* what we will not do — plus who may process, and for what */}
                    <section className="p-4" aria-labelledby="consent-willnot-heading" data-testid="consent-will-not-do">
                        <SectionHeading id="consent-willnot-heading" icon={<Ban size={13} />} headingFont={headingFont}>
                            {copy.willNotDo.heading}
                        </SectionHeading>
                        <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-emerald-500">
                            {copy.willNotDo.items.map((line) => (
                                <li key={line} className="font-sans text-[10.5px] leading-snug text-stone-700">{line}</li>
                            ))}
                        </ul>
                        <p className="mt-2.5 font-sans text-[10px] leading-snug text-stone-500">{copy.processors}</p>
                    </section>

                    {/* rights */}
                    <section className="p-4" aria-labelledby="consent-rights-heading" data-testid="consent-rights">
                        <SectionHeading id="consent-rights-heading" icon={<KeyRound size={13} />} headingFont={headingFont}>
                            {copy.rights.heading}
                        </SectionHeading>
                        <p className="mb-1.5 font-sans text-[10.5px] font-semibold leading-snug text-stone-700">{copy.rights.where}</p>
                        <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-emerald-500">
                            {copy.rights.items.map((line) => (
                                <li key={line} className="font-sans text-[10.5px] leading-snug text-stone-700">{line}</li>
                            ))}
                        </ul>
                        <p className="mt-2.5 font-sans text-[10px] leading-snug text-stone-500">{copy.rights.withdrawal}</p>
                    </section>

                    {/* who the farmer is actually dealing with, and the two documents */}
                    <section className="p-4" aria-labelledby="consent-entity-heading" data-testid="consent-entity">
                        <SectionHeading id="consent-entity-heading" icon={<Building2 size={13} />} headingFont={headingFont}>
                            {copy.entity.heading}
                        </SectionHeading>
                        <p className="font-sans text-[10.5px] font-bold leading-snug text-stone-800">
                            {DATA_FIDUCIARY.legalName}
                        </p>
                        <p className="mt-0.5 font-sans text-[10px] leading-snug text-stone-500">
                            {copy.entity.cinLabel}: {DATA_FIDUCIARY.cin}
                        </p>
                        <p className="mt-0.5 font-sans text-[10px] leading-snug text-stone-500">
                            {copy.entity.officeLabel}: {DATA_FIDUCIARY.registeredOffice}
                        </p>
                        <p className="mt-0.5 font-sans text-[10px] leading-snug text-stone-500">
                            {copy.entity.contactLabel}:{' '}
                            <a href={`mailto:${DATA_FIDUCIARY.contact}`} className="font-semibold text-emerald-700 underline">
                                {DATA_FIDUCIARY.contact}
                            </a>
                        </p>

                        <nav className="mt-3 grid grid-cols-2 gap-2" aria-label={t('consentGate.legalLinksLabel')}>
                            {[
                                { href: '/legal/terms', label: copy.links.terms, icon: <FileText size={13} /> },
                                { href: '/legal/privacy', label: copy.links.privacy, icon: <Lock size={13} /> },
                            ].map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-2 text-center font-sans text-[11px] font-bold leading-snug text-emerald-700 transition-colors hover:bg-emerald-50"
                                >
                                    {link.icon}
                                    <span className="min-w-0">{link.label}</span>
                                </a>
                            ))}
                        </nav>
                    </section>

                    {/* ── the acceptance, at the foot of the same panel ──────────── */}
                    <section className="bg-emerald-50/50 p-4">
                        <p className="font-sans text-[10.5px] leading-snug text-stone-600">{copy.acceptanceMeaning}</p>

                        <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl border border-stone-200/70 bg-white px-3 py-2">
                            <input
                                type="checkbox"
                                checked={ageConfirmed}
                                onChange={(e) => setAgeConfirmed(e.target.checked)}
                                className="h-5 w-5 shrink-0 rounded border-stone-300 accent-emerald-600"
                                data-testid="consent-age-checkbox"
                            />
                            <span className="font-sans text-[11.5px] font-semibold leading-snug text-stone-800">
                                {copy.ageDeclaration}
                            </span>
                        </label>

                        <button
                            type="button"
                            onClick={() => void handleAccept()}
                            disabled={!ageConfirmed || submitting}
                            data-testid="consent-accept-cta"
                            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 px-4 font-sans text-[15px] font-black text-white shadow-[0_16px_34px_-10px_rgba(4,120,87,0.55)] ring-1 ring-white/25 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
                        >
                            <ShieldCheck size={16} aria-hidden="true" /> {copy.cta}
                        </button>

                        {/* The only red on the screen: consent missing, or acceptance failed. */}
                        {!ageConfirmed && (
                            <p
                                className="mt-2 text-center font-sans text-[10.5px] font-semibold leading-snug text-rose-700"
                                data-testid="consent-cta-hint"
                            >
                                {copy.ctaDisabledHint}
                            </p>
                        )}
                        {failed && (
                            <p
                                className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-sans text-[10.5px] font-semibold leading-snug text-rose-700"
                                role="alert"
                                data-testid="consent-failed"
                            >
                                {t('consentGate.saveFailed')}
                            </p>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};
export default ConsentGateScreen;
