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
//   • Red is reserved. The palette is the onboarding mint + emerald; the only red on the
//     screen is `rose` — the hint when acceptance is missing, and the failure notice.
//   • Marathi headings 'Noto Serif Devanagari', body 'Noto Sans Devanagari', English and
//     numerals 'DM Sans'. Tailwind's `font-sans` stack is `DM Sans, Noto Sans Devanagari`
//     precisely so a mixed line resolves per-glyph: Latin and digits land on DM Sans,
//     Devanagari falls through to Noto Sans Devanagari. Headings switch face by language
//     because only Marathi headings are serif.
//   • Minimum 16px (`text-base`); spacing 20 / 16 / 24 (`p-5` / `gap-4` / `mb-6`);
//     CTA ≥ 48px.
//
// VISUAL ALIGNMENT (wave-4.1 restyle) — this screen was first built to the written spec
// alone, so it looked like nothing else in the app. It now speaks the onboarding flow's
// vocabulary, taken from OnboardingPermissionsPage (the screen the founder named) and
// LoginPage (the screen this gate stands directly in front of):
//   • the login/dawn mint gradient base, not a warm cream
//   • a 440px content column at px-6, an emerald icon-tile + serif title lockup header
//   • white/85 cards, `rounded-3xl`, stone-200/70 hairline, the emerald-tinted lift
//     shadow `0_6px_18px_-12px_rgba(6,78,59,0.25)`
//   • the pill CTA: rounded-full emerald gradient, font-black, ring-1 ring-white/25,
//     `active:scale-[0.98]`, dimmed via the app's `disabled:opacity-50` idiom
//   • a scrolling body between a fixed header and a docked CTA with the from-[#F5FCF8]
//     scrim — the same three-part frame as the permissions screen. This also fixes a
//     real defect: the old `min-h-screen-safe` + `sticky bottom-0` shape put the
//     acceptance bar below AppShell's `overflow-hidden` cut, unreachable.
// Body text stays ≥16px even where the permissions screen goes smaller — that rule is an
// accessibility guarantee of THIS screen and is not traded away for visual parity. The
// notice is not `select-none` either: legal text a farmer cannot copy is worse consent.
//
// 🛑 This screen does not, and may not, claim DPDP compliance. Six disclosures the
// founder still owes are rendered as visible unfilled placeholders — see
// `pendingDisclosures` in `consentNotice.ts`.

import React, { useMemo, useState } from 'react';
import {
    Ban, ChevronRight, Clock, FileText, KeyRound, Lock, MapPin, Mic,
    ShieldCheck, Smartphone, Sprout, UserCheck,
} from 'lucide-react';
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

/**
 * Decorative only — one lucide glyph per purpose, in the same emerald tile the
 * permissions screen uses for location / microphone / camera / storage. Purely visual;
 * the card's own words carry every disclosure, and nothing here is hashed.
 */
const CARD_ICONS: Record<PurposeCard['id'], React.ReactNode> = {
    account: <UserCheck size={19} />,
    farmWork: <Sprout size={19} />,
    voiceUploads: <Mic size={19} />,
    farmLocation: <MapPin size={19} />,
    technical: <Smartphone size={19} />,
};

/** Section-heading tile — the header lockup idiom, reused at every section. */
const SectionTile: React.FC<{ children: React.ReactNode; tone?: 'emerald' | 'stone' }> = ({
    children, tone = 'emerald',
}) => (
    <span
        aria-hidden="true"
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] ring-1 ${
            tone === 'emerald'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
                : 'bg-stone-100 text-stone-500 ring-stone-400/20'
        }`}
    >
        {children}
    </span>
);

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
        // h-full, not min-h-screen: AppShell hands this screen a fixed, overflow-hidden
        // box, so the scroll has to live INSIDE — same contract LoginPage honours.
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-emerald-50/60 via-white to-emerald-50/40 font-sans text-stone-800">
            <style>{`
                @keyframes cg-up { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
                @media (prefers-reduced-motion:reduce){ [data-cg-anim]{animation-duration:.01ms!important;animation-delay:0ms!important} }
            `}</style>

            {/* ── header: language switcher + icon-tile lockup ─────────────────── */}
            <div
                data-cg-anim
                className="relative z-10 mx-auto w-full max-w-[440px] flex-none px-6 pt-5"
                style={{ animation: 'cg-up .5s cubic-bezier(.16,1,.3,1) .05s both' }}
            >
                <div className="mb-4 flex justify-end">
                    <div
                        role="group"
                        aria-label={t('consentGate.languageGroupLabel')}
                        className="flex items-center gap-1 rounded-full border border-stone-200/70 bg-white/80 p-1 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
                    >
                        {(['mr', 'en'] as const).map((code) => {
                            const active = displayed === code;
                            return (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => setLanguage(code)}
                                    aria-pressed={active}
                                    className={`min-h-[40px] rounded-full px-4 font-sans text-base transition-colors ${
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

                <div className="flex items-center gap-3">
                    <span
                        aria-hidden="true"
                        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15"
                    >
                        <ShieldCheck size={22} strokeWidth={2} />
                    </span>
                    <h1 className={`${headingFont} text-[21px] font-bold leading-tight text-stone-800`}>
                        {copy.title}
                    </h1>
                </div>
            </div>

            {/* ── the notice itself — the only scrolling region ─────────────────── */}
            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto scrollbar-hide">
                <main className="mx-auto flex w-full max-w-[440px] flex-col gap-6 px-6 py-5 pb-8">
                    <p className="font-sans text-base leading-relaxed text-stone-600">{copy.intro}</p>

                    {/* ── five data-purpose cards ─────────────────────────────── */}
                    <section className="flex flex-col gap-4" aria-labelledby="consent-purposes-heading">
                        <h2
                            id="consent-purposes-heading"
                            className={`${headingFont} text-lg font-bold text-stone-800`}
                        >
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
                                icon={CARD_ICONS[card.id]}
                            />
                        ))}
                    </section>

                    {/* ── what we will not do ─────────────────────────────────── */}
                    <section
                        className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-5 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)]"
                        aria-labelledby="consent-willnot-heading"
                        data-testid="consent-will-not-do"
                    >
                        <div className="mb-4 flex items-center gap-3">
                            <SectionTile><Ban size={18} /></SectionTile>
                            <h2
                                id="consent-willnot-heading"
                                className={`${headingFont} text-lg font-bold text-emerald-900`}
                            >
                                {copy.willNotDo.heading}
                            </h2>
                        </div>
                        <ul className="flex list-disc flex-col gap-4 pl-5 marker:text-emerald-500">
                            {copy.willNotDo.items.map((line) => (
                                <li key={line} className="font-sans text-base leading-relaxed text-emerald-900">{line}</li>
                            ))}
                        </ul>
                    </section>

                    {/* ── rights summary ──────────────────────────────────────── */}
                    <section
                        className="rounded-3xl border border-stone-200/70 bg-white/85 p-5 shadow-[0_6px_18px_-12px_rgba(6,78,59,0.25)] backdrop-blur-sm"
                        aria-labelledby="consent-rights-heading"
                        data-testid="consent-rights"
                    >
                        <div className="mb-4 flex items-center gap-3">
                            <SectionTile><KeyRound size={18} /></SectionTile>
                            <h2
                                id="consent-rights-heading"
                                className={`${headingFont} text-lg font-bold text-stone-800`}
                            >
                                {copy.rights.heading}
                            </h2>
                        </div>
                        <ul className="flex list-disc flex-col gap-4 pl-5 marker:text-emerald-500">
                            {copy.rights.items.map((line) => (
                                <li key={line} className="font-sans text-base leading-relaxed text-stone-800">{line}</li>
                            ))}
                        </ul>
                        <p className="mt-4 font-sans text-base leading-relaxed text-stone-600">{copy.rights.where}</p>
                    </section>

                    {/* ── the six disclosures the founder still owes ───────────── */}
                    <section
                        className="rounded-3xl border-2 border-dashed border-stone-300 bg-stone-50/80 p-5"
                        aria-labelledby="consent-pending-heading"
                        data-testid="consent-pending-disclosures"
                    >
                        <div className="mb-4 flex items-center gap-3">
                            <SectionTile tone="stone"><Clock size={18} /></SectionTile>
                            <h2
                                id="consent-pending-heading"
                                className={`${headingFont} text-lg font-bold text-stone-700`}
                            >
                                {copy.pendingDisclosures.heading}
                            </h2>
                        </div>
                        <p className="mb-4 font-sans text-base leading-relaxed text-stone-600">{copy.pendingDisclosures.note}</p>
                        <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-stone-400">
                            {copy.pendingDisclosures.items.map((line) => (
                                <li key={line} className="font-sans text-base leading-relaxed text-stone-600">{line}</li>
                            ))}
                        </ul>
                    </section>

                    {/* ── legal links ─────────────────────────────────────────── */}
                    <nav className="flex flex-col gap-3" aria-label={t('consentGate.legalLinksLabel')}>
                        {[
                            { href: '/legal/terms', label: copy.links.terms, icon: <FileText size={17} /> },
                            { href: '/legal/privacy', label: copy.links.privacy, icon: <Lock size={17} /> },
                        ].map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="flex min-h-[48px] w-full items-center gap-2.5 rounded-2xl border border-emerald-200 bg-white px-4 py-3.5 font-sans text-base font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
                            >
                                {link.icon}
                                <span className="flex-1">{link.label}</span>
                                <ChevronRight size={18} className="text-emerald-400" aria-hidden="true" />
                            </a>
                        ))}
                    </nav>
                </main>
            </div>

            {/* ── docked acceptance bar ───────────────────────────────────────── */}
            {/* Docked, not `sticky`: AppShell gives this screen a fixed box, so the bar
                has to be a flex sibling of the scroller or it falls past the clip. */}
            <div
                data-cg-anim
                className="relative z-20 w-full flex-none border-t border-stone-200/70 bg-white/85 backdrop-blur-sm"
                style={{ animation: 'cg-up .5s cubic-bezier(.16,1,.3,1) .12s both' }}
            >
                {/* the notice fades out under the bar — same soft hand-off the Welcome
                    and permissions screens use above their CTA docks. */}
                <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-white/90 to-transparent" />
                <div className="mx-auto w-full max-w-[440px] px-6 pt-4 pb-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]">
                    <p className="mb-4 font-sans text-base leading-relaxed text-stone-600">{copy.acceptanceMeaning}</p>

                    <label className="mb-4 flex min-h-[48px] cursor-pointer items-start gap-3.5 rounded-2xl border border-stone-200/70 bg-white p-3.5">
                        <input
                            type="checkbox"
                            checked={ageConfirmed}
                            onChange={(e) => setAgeConfirmed(e.target.checked)}
                            className="mt-0.5 h-6 w-6 shrink-0 rounded border-stone-300 accent-emerald-600"
                            data-testid="consent-age-checkbox"
                        />
                        <span className="font-sans text-base leading-relaxed text-stone-800">{copy.ageDeclaration}</span>
                    </label>

                    <button
                        type="button"
                        onClick={() => void handleAccept()}
                        disabled={!ageConfirmed || submitting}
                        data-testid="consent-accept-cta"
                        className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-500 py-[16px] font-sans text-base font-black text-white shadow-[0_16px_34px_-10px_rgba(4,120,87,0.55)] ring-1 ring-white/25 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
                    >
                        <ShieldCheck size={18} aria-hidden="true" /> {copy.cta}
                    </button>

                    {/* The only red on the screen: consent missing, or acceptance failed. */}
                    {!ageConfirmed && (
                        <p
                            className="mt-4 text-center font-sans text-base font-semibold leading-snug text-rose-700"
                            data-testid="consent-cta-hint"
                        >
                            {copy.ctaDisabledHint}
                        </p>
                    )}
                    {failed && (
                        <p
                            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-sans text-base font-semibold leading-snug text-rose-700"
                            role="alert"
                            data-testid="consent-failed"
                        >
                            {t('consentGate.saveFailed')}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};
export default ConsentGateScreen;
